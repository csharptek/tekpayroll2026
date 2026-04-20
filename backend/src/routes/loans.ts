import { Router } from 'express';
import { authenticate, requireSuperAdmin } from '../middleware/auth';
import { prisma } from '../utils/prisma';
import { AppError } from '../middleware/errorHandler';
import { createAuditLog } from '../middleware/audit';
import { AuditAction } from '@prisma/client';

export const loanRouter = Router();
loanRouter.use(authenticate);

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function toCycleMonth(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  return `${y}-${m}`
}

function addMonths(cm: string, n: number): string {
  const [y, m] = cm.split('-').map(Number)
  const d = new Date(y, m - 1 + n, 1)
  return toCycleMonth(d)
}

async function generateSchedule(loanId: string, startMonth: string, tenure: number, emi: number) {
  const rows: any[] = []
  for (let i = 0; i < tenure; i++) {
    rows.push({
      loanId,
      sequenceNo:    i + 1,
      cycleMonth:    addMonths(startMonth, i),
      plannedAmount: emi,
      status:        'PENDING',
    })
  }
  await prisma.loanSchedule.createMany({ data: rows, skipDuplicates: true })
}

// ─── EMPLOYEE: SELF-REQUEST ──────────────────────────────────────────────────

loanRouter.post('/request', async (req, res) => {
  const { type, principalAmount, tenureMonths, suggestedEmiAmount, purpose } = req.body
  if (!principalAmount || !tenureMonths) throw new AppError('Amount and tenure required', 400)
  if (!['LOAN', 'SALARY_ADVANCE'].includes(type)) throw new AppError('Invalid loan type', 400)

  const loan = await prisma.loan.create({
    data: {
      employeeId:         req.user!.id,
      type,
      principalAmount,
      tenureMonths,
      emiAmount:          suggestedEmiAmount ?? Math.ceil(Number(principalAmount) / Number(tenureMonths)),
      outstandingBalance: principalAmount,
      purpose,
      status:             'PENDING_APPROVAL',
      requestedAt:        new Date(),
      requestedBy:        req.user!.id,
    },
  })

  await createAuditLog({
    user: req.user!,
    action: AuditAction.CREATE,
    recordId: loan.id,
    targetEmployeeId: req.user!.id,
    description: `Requested ${type.toLowerCase().replace('_', ' ')} of ₹${principalAmount}`,
  })

  res.status(201).json({ success: true, data: loan })
})

loanRouter.get('/my', async (req, res) => {
  const loans = await prisma.loan.findMany({
    where: { employeeId: req.user!.id },
    include: {
      schedule:   { orderBy: { sequenceNo: 'asc' } },
      repayments: { orderBy: { paidOn: 'desc' } },
    },
    orderBy: { createdAt: 'desc' },
  })
  res.json({ success: true, data: loans })
})

// ─── SUPER ADMIN: MANAGEMENT ─────────────────────────────────────────────────

loanRouter.get('/', requireSuperAdmin, async (req, res) => {
  const status = (req.query.status as string) || undefined
  const loans = await prisma.loan.findMany({
    where: status ? { status: status as any } : {},
    include: { employee: { select: { name: true, employeeCode: true } } },
    orderBy: { createdAt: 'desc' },
  })
  res.json({ success: true, data: loans })
})

loanRouter.get('/pending', requireSuperAdmin, async (_req, res) => {
  const loans = await prisma.loan.findMany({
    where: { status: 'PENDING_APPROVAL' },
    include: { employee: { select: { name: true, employeeCode: true, email: true } } },
    orderBy: { requestedAt: 'asc' },
  })
  res.json({ success: true, data: loans })
})

loanRouter.get('/employee/:employeeId', async (req, res) => {
  if (req.user!.role === 'EMPLOYEE' && req.user!.id !== req.params.employeeId) {
    throw new AppError('Access denied', 403)
  }
  const loans = await prisma.loan.findMany({
    where: { employeeId: req.params.employeeId },
    include: {
      schedule:   { orderBy: { sequenceNo: 'asc' } },
      repayments: { orderBy: { paidOn: 'desc' } },
    },
    orderBy: { createdAt: 'desc' },
  })
  res.json({ success: true, data: loans })
})

loanRouter.get('/:id', requireSuperAdmin, async (req, res) => {
  const loan = await prisma.loan.findUnique({
    where: { id: req.params.id },
    include: {
      employee:   { select: { name: true, employeeCode: true, email: true } },
      schedule:   { orderBy: { sequenceNo: 'asc' } },
      repayments: { orderBy: { paidOn: 'desc' } },
    },
  })
  if (!loan) throw new AppError('Loan not found', 404)
  res.json({ success: true, data: loan })
})

/**
 * Direct creation by SA (historical / imported loans). Auto-approved & active.
 */
loanRouter.post('/', requireSuperAdmin, async (req, res) => {
  const { employeeId, type, principalAmount, disbursedOn, tenureMonths, emiAmount, purpose } = req.body
  const disbursed = disbursedOn ? new Date(disbursedOn) : new Date()

  const loan = await prisma.loan.create({
    data: {
      employeeId,
      type:               type || 'LOAN',
      principalAmount,
      disbursedOn:        disbursed,
      tenureMonths,
      emiAmount,
      outstandingBalance: principalAmount,
      purpose,
      status:             'ACTIVE',
      approvedAt:         new Date(),
      approvedBy:         req.user!.id,
      approvedByName:     req.user!.name,
    },
  })

  const startMonth = toCycleMonth(disbursed)
  await generateSchedule(loan.id, startMonth, tenureMonths, Number(emiAmount))

  await createAuditLog({
    user: req.user!,
    action: AuditAction.LOAN_CREATE,
    recordId: loan.id,
    targetEmployeeId: employeeId,
    description: `Created ${loan.type.toLowerCase()} of ₹${principalAmount} for employee`,
  })

  try {
    const { sendLoanCreatedEmail } = await import('../services/employeeNotifications')
    sendLoanCreatedEmail(loan.id).catch(e => console.error('[LOAN EMAIL]', e))
  } catch {}

  res.status(201).json({ success: true, data: loan })
})

loanRouter.post('/:id/approve', requireSuperAdmin, async (req, res) => {
  const loan = await prisma.loan.findUnique({ where: { id: req.params.id } })
  if (!loan) throw new AppError('Loan not found', 404)
  if (loan.status !== 'PENDING_APPROVAL') throw new AppError('Loan is not pending approval', 400)

  const { emiAmount, tenureMonths, disbursedOn } = req.body
  if (!emiAmount || !tenureMonths || !disbursedOn) {
    throw new AppError('emiAmount, tenureMonths, disbursedOn required', 400)
  }

  const disbursed  = new Date(disbursedOn)
  const startMonth = toCycleMonth(disbursed)

  const updated = await prisma.loan.update({
    where: { id: loan.id },
    data: {
      status:         'ACTIVE',
      emiAmount,
      tenureMonths,
      disbursedOn:    disbursed,
      approvedAt:     new Date(),
      approvedBy:     req.user!.id,
      approvedByName: req.user!.name,
    },
  })

  await generateSchedule(loan.id, startMonth, Number(tenureMonths), Number(emiAmount))

  await createAuditLog({
    user: req.user!,
    action: AuditAction.LOAN_CREATE,
    recordId: loan.id,
    targetEmployeeId: loan.employeeId,
    description: `Approved ${loan.type.toLowerCase()} of ₹${loan.principalAmount} (EMI ₹${emiAmount} × ${tenureMonths}m)`,
  })

  try {
    const { sendLoanCreatedEmail } = await import('../services/employeeNotifications')
    sendLoanCreatedEmail(loan.id).catch(e => console.error('[LOAN EMAIL]', e))
  } catch {}

  res.json({ success: true, data: updated })
})

loanRouter.post('/:id/reject', requireSuperAdmin, async (req, res) => {
  const loan = await prisma.loan.findUnique({ where: { id: req.params.id } })
  if (!loan) throw new AppError('Loan not found', 404)
  if (loan.status !== 'PENDING_APPROVAL') throw new AppError('Loan is not pending approval', 400)

  const { reason } = req.body
  const updated = await prisma.loan.update({
    where: { id: loan.id },
    data: {
      status:          'REJECTED',
      rejectedAt:      new Date(),
      rejectedBy:      req.user!.id,
      rejectionReason: reason || null,
    },
  })

  await createAuditLog({
    user: req.user!,
    action: AuditAction.UPDATE,
    recordId: loan.id,
    targetEmployeeId: loan.employeeId,
    description: `Rejected loan request — ${reason || 'no reason'}`,
  })

  res.json({ success: true, data: updated })
})

/**
 * Edit EMI/tenure on ACTIVE loan. Regenerates PENDING rows, keeps DEDUCTED history.
 */
loanRouter.patch('/:id', requireSuperAdmin, async (req, res) => {
  const loan = await prisma.loan.findUnique({
    where: { id: req.params.id },
    include: { schedule: { orderBy: { sequenceNo: 'asc' } } },
  })
  if (!loan) throw new AppError('Loan not found', 404)
  if (loan.status !== 'ACTIVE') throw new AppError('Only ACTIVE loans can be edited', 400)

  const { emiAmount, tenureMonths } = req.body
  if (!emiAmount || !tenureMonths) throw new AppError('emiAmount and tenureMonths required', 400)

  const deductedCount  = loan.schedule.filter(s => s.status === 'DEDUCTED').length
  const newPendingCount = Number(tenureMonths) - deductedCount
  if (newPendingCount < 0) {
    throw new AppError(`Tenure cannot be less than already-deducted months (${deductedCount})`, 400)
  }

  const firstPending = loan.schedule.find(s => s.status !== 'DEDUCTED')
  const startMonth   = firstPending
    ? firstPending.cycleMonth
    : addMonths(toCycleMonth(loan.disbursedOn || new Date()), deductedCount)

  await prisma.loanSchedule.deleteMany({
    where: { loanId: loan.id, status: { not: 'DEDUCTED' } },
  })

  if (newPendingCount > 0) {
    const rows: any[] = []
    for (let i = 0; i < newPendingCount; i++) {
      rows.push({
        loanId:        loan.id,
        sequenceNo:    deductedCount + i + 1,
        cycleMonth:    addMonths(startMonth, i),
        plannedAmount: emiAmount,
        status:        'PENDING',
      })
    }
    await prisma.loanSchedule.createMany({ data: rows, skipDuplicates: true })
  }

  const updated = await prisma.loan.update({
    where: { id: loan.id },
    data:  { emiAmount, tenureMonths },
  })

  await createAuditLog({
    user: req.user!,
    action: AuditAction.UPDATE,
    recordId: loan.id,
    targetEmployeeId: loan.employeeId,
    description: `Updated loan terms — EMI ₹${emiAmount}, tenure ${tenureMonths}m`,
  })

  res.json({ success: true, data: updated })
})

/** Pause specific month. Extends tenure by 1. */
loanRouter.post('/:id/schedule/:scheduleId/pause', requireSuperAdmin, async (req, res) => {
  const { reason } = req.body
  const entry = await prisma.loanSchedule.findUnique({ where: { id: req.params.scheduleId } })
  if (!entry || entry.loanId !== req.params.id) throw new AppError('Schedule entry not found', 404)
  if (entry.status !== 'PENDING') throw new AppError('Only PENDING entries can be paused', 400)

  const loan = await prisma.loan.findUnique({
    where: { id: req.params.id },
    include: { schedule: { orderBy: { sequenceNo: 'desc' }, take: 1 } },
  })
  if (!loan) throw new AppError('Loan not found', 404)

  await prisma.$transaction(async (tx) => {
    await tx.loanSchedule.update({
      where: { id: entry.id },
      data: {
        status:       'PAUSED',
        pauseReason:  reason || null,
        pausedBy:     req.user!.id,
        pausedByName: req.user!.name,
        pausedAt:     new Date(),
      },
    })

    const lastEntry = loan.schedule[0]
    const nextMonth = addMonths(lastEntry.cycleMonth, 1)
    await tx.loanSchedule.create({
      data: {
        loanId:        loan.id,
        sequenceNo:    lastEntry.sequenceNo + 1,
        cycleMonth:    nextMonth,
        plannedAmount: entry.plannedAmount,
        status:        'PENDING',
      },
    })

    await tx.loan.update({
      where: { id: loan.id },
      data:  { tenureMonths: { increment: 1 } },
    })
  })

  await createAuditLog({
    user: req.user!,
    action: AuditAction.UPDATE,
    recordId: loan.id,
    targetEmployeeId: loan.employeeId,
    description: `Paused ${entry.cycleMonth} EMI — ${reason || 'no reason'}`,
  })

  res.json({ success: true })
})

loanRouter.post('/:id/schedule/:scheduleId/resume', requireSuperAdmin, async (req, res) => {
  const entry = await prisma.loanSchedule.findUnique({ where: { id: req.params.scheduleId } })
  if (!entry || entry.loanId !== req.params.id) throw new AppError('Schedule entry not found', 404)
  if (entry.status !== 'PAUSED') throw new AppError('Only PAUSED entries can be resumed', 400)

  await prisma.loanSchedule.update({
    where: { id: entry.id },
    data: { status: 'PENDING', pauseReason: null, pausedBy: null, pausedByName: null, pausedAt: null },
  })

  const loan = await prisma.loan.findUnique({ where: { id: req.params.id } })
  await createAuditLog({
    user: req.user!,
    action: AuditAction.UPDATE,
    recordId: req.params.id,
    targetEmployeeId: loan?.employeeId,
    description: `Resumed ${entry.cycleMonth} EMI`,
  })

  res.json({ success: true })
})

loanRouter.post('/:id/close', requireSuperAdmin, async (req, res) => {
  const loan = await prisma.loan.findUnique({ where: { id: req.params.id } })
  if (!loan) throw new AppError('Loan not found', 404)

  const updated = await prisma.loan.update({
    where: { id: req.params.id },
    data: {
      status:      'CLOSED',
      closedAt:    new Date(),
      closedBy:    req.user!.id,
      closureNote: req.body.note,
    },
  })

  await createAuditLog({
    user: req.user!,
    action: AuditAction.LOAN_CLOSE,
    recordId: loan.id,
    targetEmployeeId: loan.employeeId,
    description: `Closed loan ${loan.id}`,
  })

  res.json({ success: true, data: updated })
})

/**
 * One-time backfill: generate schedule rows for ACTIVE loans that don't have any.
 * Safe to run multiple times — skips loans that already have schedule entries.
 */
loanRouter.post('/backfill-schedules', requireSuperAdmin, async (_req, res) => {
  const loans = await prisma.loan.findMany({
    where: { status: 'ACTIVE' },
    include: { _count: { select: { schedule: true } } },
  })

  let created = 0
  for (const loan of loans) {
    if (loan._count.schedule > 0) continue
    const disbursed = loan.disbursedOn || loan.createdAt
    const now       = new Date()
    const elapsed   = Math.max(0,
      (now.getFullYear() - disbursed.getFullYear()) * 12 +
      (now.getMonth()    - disbursed.getMonth())
    )
    const remaining = Math.max(0, loan.tenureMonths - elapsed)
    if (remaining === 0) continue

    const startMonth = toCycleMonth(now)
    const rows: any[] = []
    for (let i = 0; i < remaining; i++) {
      rows.push({
        loanId:        loan.id,
        sequenceNo:    elapsed + i + 1,
        cycleMonth:    addMonths(startMonth, i),
        plannedAmount: loan.emiAmount,
        status:        'PENDING',
      })
    }
    await prisma.loanSchedule.createMany({ data: rows, skipDuplicates: true })
    created += rows.length
  }

  res.json({ success: true, data: { loansProcessed: loans.length, schedulesCreated: created } })
})
