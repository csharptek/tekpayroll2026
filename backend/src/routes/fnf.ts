import { Router } from 'express'
import { authenticate, requireSuperAdmin } from '../middleware/auth'
import { prisma } from '../utils/prisma'
import { AppError } from '../middleware/errorHandler'
import { createAuditLog } from '../middleware/audit'
import { AuditAction } from '@prisma/client'
import { calculateFnf, buildCalcFromSettlement } from '../services/fnfService'

export const fnfRouter = Router()
fnfRouter.use(authenticate, requireSuperAdmin)

fnfRouter.get('/', async (_req, res) => {
  const settlements = await prisma.fnfSettlement.findMany({
    include: {
      employee: {
        select: {
          id: true, name: true, employeeCode: true, department: true, email: true,
          profile: { select: { personalEmail: true } },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  })
  res.json({ success: true, data: settlements })
})

fnfRouter.get('/eligible', async (_req, res) => {
  const employees = await prisma.employee.findMany({
    where: {
      status: { in: ['ON_NOTICE', 'SEPARATED'] },
      resignationDate: { not: null },
      fnfSettlement: null,
    },
    select: {
      id: true, name: true, employeeCode: true, department: true,
      resignationDate: true, lastWorkingDay: true, status: true,
    },
  })
  res.json({ success: true, data: employees })
})

fnfRouter.get('/employee/:employeeId', async (req, res) => {
  const fnf = await prisma.fnfSettlement.findUnique({
    where: { employeeId: req.params.employeeId },
    include: { employee: true },
  })
  res.json({ success: true, data: fnf || null })
})

fnfRouter.get('/:id', async (req, res) => {
  const fnf = await prisma.fnfSettlement.findUnique({
    where: { id: req.params.id },
    include: { employee: true },
  })
  if (!fnf) throw new AppError('F&F settlement not found', 404)
  res.json({ success: true, data: fnf })
})

fnfRouter.post('/calculate/:employeeId', async (req, res) => {
  const calc = await calculateFnf(req.params.employeeId, undefined, req.body.hyiOverrides)
  res.json({ success: true, data: calc })
})

// Preview with optional custom LWD and HYI overrides — does NOT save anything
fnfRouter.post('/preview/:employeeId', async (req, res) => {
  const overrideLwd = req.body.lastWorkingDay ? new Date(req.body.lastWorkingDay) : undefined
  const calc = await calculateFnf(req.params.employeeId, overrideLwd, req.body.hyiOverrides)
  res.json({ success: true, data: calc })
})

fnfRouter.post('/initiate/:employeeId', async (req, res) => {
  const { employeeId } = req.params
  const existing = await prisma.fnfSettlement.findUnique({ where: { employeeId } })
  if (existing) throw new AppError('F&F already initiated for this employee', 409)

  const hyiOverrides: Record<string, number> | undefined = req.body.hyiOverrides
  const calc = await calculateFnf(employeeId, undefined, hyiOverrides)
  const settlement = await prisma.fnfSettlement.create({
    data: {
      employeeId,
      resignationDate:   calc.resignationDate,
      lastWorkingDay:    calc.lastWorkingDay,
      noticePeriosDays:  calc.cycles?.length ? calc.cycles.reduce((s: number, c: any) => s + c.salaryDays, 0) : calc.salaryDays,
      salaryDays:        calc.salaryDays,
      salaryAmount:      calc.proratedSalary,
      reimbursements:    calc.pendingReimbursements,
      pfAmount:          calc.pfAmount,
      esiAmount:         calc.esiAmount,
      ptAmount:          calc.ptAmount,
      tdsAmount:         calc.tdsAmount,
      incentiveRecovery: calc.hyiRecovery,
      loanOutstanding:   calc.loanOutstanding,
      otherDeductions:   0,
      netPayable:        calc.netPayable,
      breakdownJson:     JSON.stringify(calc.breakdown),
      cyclesJson:        JSON.stringify(calc.cycles || []),
      hyiOverridesJson:  hyiOverrides ? JSON.stringify(hyiOverrides) : null,
      hyiRecoveryDetailJson: JSON.stringify(calc.hyiRecoveryDetail || []),
      excessLeaveDetailJson: JSON.stringify(calc.excessLeaveDetail || []),
      status:            'INITIATED',
    },
    include: { employee: { include: { bankDetail: true } } },
  })

  await createAuditLog({
    user: req.user!,
    action: AuditAction.FNF_APPROVE,
    tableName: 'fnf_settlements',
    recordId: settlement.id,
    targetEmployeeId: employeeId,
    description: `F&F initiated for ${calc.employeeName} — Net payable ₹${calc.netPayable}`,
  })

  // Generate the F&F settlement statement PDF. Non-blocking — a PDF failure
  // (e.g. Azure not configured) must not block F&F initiation itself.
  let finalSettlement = settlement
  try {
    const { generateFnfStatementPdf } = await import('../services/fnfPdfService')
    const { pdfUrl, pdfKey } = await generateFnfStatementPdf(calc, settlement.employee)
    finalSettlement = await prisma.fnfSettlement.update({
      where: { id: settlement.id },
      data:  { pdfUrl, pdfKey },
      include: { employee: true },
    })
  } catch (e: any) {
    console.error('[FNF PDF] Generation failed:', e.message)
  }

  res.status(201).json({ success: true, data: { settlement: finalSettlement, calculation: calc } })
})

// Regenerate the F&F statement PDF (after PUT edits, or if generation failed earlier)
fnfRouter.post('/:id/generate-pdf', async (req, res) => {
  const settlement = await prisma.fnfSettlement.findUnique({
    where: { id: req.params.id },
    include: { employee: { include: { bankDetail: true } } },
  })
  if (!settlement) throw new AppError('Settlement not found', 404)

  // Build the statement from the settlement's own saved data (breakdown/cycles/
  // netPayable) — this is what the wizard confirmed, including manual PF/ESI/PT/TDS
  // overrides and notice/bonus recovery. Re-running calculateFnf() here would drop
  // all of that and could generate a statement that doesn't match the wizard's total.
  const calc = buildCalcFromSettlement(settlement)
  const { generateFnfStatementPdf } = await import('../services/fnfPdfService')
  const { pdfUrl, pdfKey } = await generateFnfStatementPdf(calc, settlement.employee)

  const updated = await prisma.fnfSettlement.update({
    where: { id: settlement.id },
    data:  { pdfUrl, pdfKey },
    include: { employee: true },
  })

  res.json({ success: true, data: updated })
})

// Send the F&F statement PDF to the configured HR/Finance notification list
// (Notifications settings → "F&F Statement — Send to HR"). Manual button next to
// "Generate Statement" — generates the PDF first if it hasn't been generated yet.
fnfRouter.post('/:id/email-hr', async (req, res) => {
  const settlement = await prisma.fnfSettlement.findUnique({
    where: { id: req.params.id },
    include: { employee: { include: { bankDetail: true } } },
  })
  if (!settlement) throw new AppError('Settlement not found', 404)

  const { getNotifConfig, renderTemplate } = await import('../services/notificationService')
  const cfg = await getNotifConfig('FNF_STATEMENT_TO_HR')
  if (cfg.to.length === 0) {
    throw new AppError('No recipients configured — set them under Notifications → F&F Statement — Send to HR', 400)
  }

  let pdfKey = settlement.pdfKey
  let pdfUrl = settlement.pdfUrl
  if (!pdfKey) {
    const calc = buildCalcFromSettlement(settlement)
    const { generateFnfStatementPdf } = await import('../services/fnfPdfService')
    const generated = await generateFnfStatementPdf(calc, settlement.employee)
    pdfUrl = generated.pdfUrl
    pdfKey = generated.pdfKey
    await prisma.fnfSettlement.update({ where: { id: settlement.id }, data: { pdfUrl, pdfKey } })
  }

  const { downloadPayslipPdf } = await import('../utils/payslipBlob')
  const { sendEmailWithAttachment, emailWrap } = await import('../services/emailService')

  const buffer   = await downloadPayslipPdf(pdfKey)
  const filename = pdfKey.split('/').pop() || `FNF-${settlement.employee.employeeCode}.pdf`

  const netPayable = Number(settlement.netPayable)
  const vars = {
    employeeName: settlement.employee.name,
    employeeCode: settlement.employee.employeeCode,
    lwd:          settlement.lastWorkingDay.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }),
    amount:       `₹${Math.abs(netPayable).toLocaleString('en-IN')}${netPayable < 0 ? ' (Recoverable)' : ''}`,
  }
  const subject = cfg.subject ? renderTemplate(cfg.subject, vars) : `F&F Statement — ${vars.employeeName} (${vars.employeeCode})`
  const html = emailWrap(`
    <h2 style="color:#1f4e79;margin:0 0 16px">Full &amp; Final Settlement Statement</h2>
    <p style="color:#475569">F&amp;F statement for <strong>${vars.employeeName}</strong> (${vars.employeeCode}) is attached.</p>
    <table style="width:100%;border-collapse:collapse;margin:16px 0">
      <tr><td style="padding:8px 0;color:#64748b;width:160px">Last Working Day</td><td style="color:#1e293b;font-weight:600">${vars.lwd}</td></tr>
      <tr><td style="padding:8px 0;color:#64748b">${netPayable < 0 ? 'Recoverable from Employee' : 'Net Payable'}</td><td style="color:#1e293b;font-weight:600">${vars.amount}</td></tr>
    </table>`)

  await sendEmailWithAttachment(cfg.to, subject, html, filename, buffer.toString('base64'), 'application/pdf', cfg.cc)

  await createAuditLog({
    user: req.user!,
    action: AuditAction.FNF_APPROVE,
    recordId: settlement.id,
    targetEmployeeId: settlement.employeeId,
    description: `F&F statement emailed to HR (${cfg.to.join(', ')}) for ${settlement.employee.name}`,
  })

  res.json({ success: true, data: { sentTo: cfg.to, cc: cfg.cc } })
})

fnfRouter.post('/:id/approve', async (req, res) => {
  const settlement = await prisma.fnfSettlement.findUnique({ where: { id: req.params.id } })
  if (!settlement) throw new AppError('Settlement not found', 404)
  if (settlement.status === 'SETTLED') throw new AppError('Already settled', 400)

  const updated = await prisma.fnfSettlement.update({
    where: { id: req.params.id },
    data: {
      status:         'APPROVED',
      approvedBy:     req.user!.id,
      approvedByName: req.user!.name,
      approvedAt:     new Date(),
      notes:          req.body.notes,
    },
    include: { employee: true },
  })

  await prisma.employee.update({
    where: { id: settlement.employeeId },
    data: { status: 'SEPARATED' },
  })

  await createAuditLog({
    user: req.user!,
    action: AuditAction.FNF_APPROVE,
    recordId: settlement.id,
    targetEmployeeId: settlement.employeeId,
    description: `F&F approved for ${updated.employee.name}`,
  })

  try {
    const { sendFnfReadyEmail } = await import('../services/employeeNotifications')
    sendFnfReadyEmail(settlement.employeeId, Number(settlement.netPayable), new Date()).catch(e => console.error('[FNF EMAIL]', e))
  } catch {}

  res.json({ success: true, data: updated })
})

fnfRouter.put('/:id', async (req, res) => {
  const settlement = await prisma.fnfSettlement.findUnique({ where: { id: req.params.id } })
  if (!settlement) throw new AppError('Settlement not found', 404)
  if (settlement.status !== 'INITIATED') throw new AppError('Can only edit INITIATED settlements', 400)

  const newTds   = req.body.tdsAmount       != null ? Number(req.body.tdsAmount)       : Number(settlement.tdsAmount)
  const newOther = req.body.otherDeductions != null ? Number(req.body.otherDeductions) : Number(settlement.otherDeductions)
  const totalDed = Number(settlement.pfAmount) + Number(settlement.esiAmount) + Number(settlement.ptAmount) +
    newTds + Number(settlement.incentiveRecovery) + Number(settlement.loanOutstanding) + newOther
  const netPayable = Math.round((Number(settlement.salaryAmount) + Number(settlement.reimbursements) - totalDed) * 100) / 100

  const updated = await prisma.fnfSettlement.update({
    where: { id: req.params.id },
    data: { tdsAmount: newTds, otherDeductions: newOther, netPayable, notes: req.body.notes },
  })

  res.json({ success: true, data: updated })
})

// Email F&F statement PDF to employee — official / personal / custom address
fnfRouter.post('/:id/email', async (req, res) => {
  const settlement = await prisma.fnfSettlement.findUnique({
    where: { id: req.params.id },
    include: { employee: true },
  })
  if (!settlement) throw new AppError('Settlement not found', 404)
  if (!['APPROVED', 'SETTLED'].includes(settlement.status)) {
    throw new AppError('Settlement must be APPROVED before emailing', 400)
  }
  if (!settlement.pdfKey) throw new AppError('Statement PDF not generated yet', 400)

  const to = (req.body.email || '').trim()
  if (!to || !/^\S+@\S+\.\S+$/.test(to)) throw new AppError('Valid email is required', 400)

  const { downloadPayslipPdf } = await import('../utils/payslipBlob')
  const { sendEmailWithAttachment } = await import('../services/emailService')

  const buffer   = await downloadPayslipPdf(settlement.pdfKey)
  const filename = settlement.pdfKey.split('/').pop() || `FNF-${settlement.employee.employeeCode}.pdf`

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:540px;margin:0 auto;padding:24px;">
      <div style="border-bottom:2px solid #1f4e79;padding-bottom:16px;margin-bottom:24px;">
        <h2 style="color:#1f4e79;margin:0;">TEKONE</h2>
      </div>
      <p style="color:#374151;">Dear <strong>${settlement.employee.name}</strong>,</p>
      <p style="color:#374151;">Please find attached your Full &amp; Final Settlement statement.</p>
      <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;" />
      <p style="color:#9ca3af;font-size:12px;margin:0;">Automated email — please do not reply. TEKONE System.</p>
    </div>`

  await sendEmailWithAttachment(
    to,
    `Full & Final Settlement Statement — ${settlement.employee.name}`,
    html,
    filename,
    buffer.toString('base64'),
  )

  await createAuditLog({
    user: req.user!,
    action: AuditAction.FNF_APPROVE,
    recordId: settlement.id,
    targetEmployeeId: settlement.employeeId,
    description: `F&F statement emailed to ${to}`,
  })

  res.json({ success: true, data: { sentTo: to } })
})

// Mark as SETTLED (payment done)
fnfRouter.post('/:id/settle', async (req, res) => {
  const settlement = await prisma.fnfSettlement.findUnique({ where: { id: req.params.id }, include: { employee: true } })
  if (!settlement) throw new AppError('Settlement not found', 404)
  if (settlement.status !== 'APPROVED') throw new AppError('Only APPROVED settlements can be marked settled', 400)

  const updated = await prisma.fnfSettlement.update({
    where: { id: req.params.id },
    data:  { status: 'SETTLED', notes: req.body.notes || settlement.notes },
  })

  res.json({ success: true, data: updated })
})
