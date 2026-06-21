import { Router } from 'express'
import { authenticate, requireSuperAdmin } from '../middleware/auth'
import { prisma } from '../utils/prisma'
import { AppError } from '../middleware/errorHandler'
import { createAuditLog } from '../middleware/audit'
import { AuditAction } from '@prisma/client'
import { calculateFnf } from '../services/fnfService'

export const fnfRouter = Router()
fnfRouter.use(authenticate, requireSuperAdmin)

fnfRouter.get('/', async (_req, res) => {
  const settlements = await prisma.fnfSettlement.findMany({
    include: { employee: { select: { id: true, name: true, employeeCode: true, department: true } } },
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
  const calc = await calculateFnf(req.params.employeeId)
  res.json({ success: true, data: calc })
})

// Preview with optional custom LWD — does NOT save anything
fnfRouter.post('/preview/:employeeId', async (req, res) => {
  const overrideLwd = req.body.lastWorkingDay ? new Date(req.body.lastWorkingDay) : undefined
  const calc = await calculateFnf(req.params.employeeId, overrideLwd)
  res.json({ success: true, data: calc })
})

fnfRouter.post('/initiate/:employeeId', async (req, res) => {
  const { employeeId } = req.params
  const existing = await prisma.fnfSettlement.findUnique({ where: { employeeId } })
  if (existing) throw new AppError('F&F already initiated for this employee', 409)

  const calc = await calculateFnf(employeeId)
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
      status:            'INITIATED',
    },
    include: { employee: true },
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
    include: { employee: true },
  })
  if (!settlement) throw new AppError('Settlement not found', 404)

  const calc = await calculateFnf(settlement.employeeId, settlement.lastWorkingDay)
  const { generateFnfStatementPdf } = await import('../services/fnfPdfService')
  const { pdfUrl, pdfKey } = await generateFnfStatementPdf(calc, settlement.employee)

  const updated = await prisma.fnfSettlement.update({
    where: { id: settlement.id },
    data:  { pdfUrl, pdfKey },
    include: { employee: true },
  })

  res.json({ success: true, data: updated })
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
  const netPayable = Math.max(0, Number(settlement.salaryAmount) + Number(settlement.reimbursements) - totalDed)

  const updated = await prisma.fnfSettlement.update({
    where: { id: req.params.id },
    data: { tdsAmount: newTds, otherDeductions: newOther, netPayable, notes: req.body.notes },
  })

  res.json({ success: true, data: updated })
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
