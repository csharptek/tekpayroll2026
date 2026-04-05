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
      noticePeriosDays:  calc.salaryDays,
      salaryDays:        calc.salaryDays,
      salaryAmount:      calc.proratedSalary,
      reimbursements:    calc.pendingReimbursements,
      pfAmount:          calc.pfAmount,
      esiAmount:         calc.esiAmount,
      ptAmount:          calc.ptAmount,
      tdsAmount:         calc.tdsAmount,
      incentiveRecovery: 0, // handled in F&F separately if needed
      loanOutstanding:   calc.loanOutstanding,
      otherDeductions:   0,
      netPayable:        calc.netPayable,
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

  res.status(201).json({ success: true, data: { settlement, calculation: calc } })
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

  res.json({ success: true, data: updated })
})

fnfRouter.put('/:id', async (req, res) => {
  const settlement = await prisma.fnfSettlement.findUnique({ where: { id: req.params.id } })
  if (!settlement) throw new AppError('Settlement not found', 404)
  if (settlement.status !== 'INITIATED') throw new AppError('Can only edit INITIATED settlements', 400)

  const newTds   = req.body.tdsAmount       ?? Number(settlement.tdsAmount)
  const newOther = req.body.otherDeductions ?? Number(settlement.otherDeductions)
  const totalDed = Number(settlement.pfAmount) + Number(settlement.esiAmount) + Number(settlement.ptAmount) +
    newTds + Number(settlement.incentiveRecovery) + Number(settlement.loanOutstanding) + newOther
  const netPayable = Math.max(0, Number(settlement.salaryAmount) + Number(settlement.reimbursements) - totalDed)

  const updated = await prisma.fnfSettlement.update({
    where: { id: req.params.id },
    data: { tdsAmount: newTds, otherDeductions: newOther, netPayable, notes: req.body.notes },
  })

  res.json({ success: true, data: updated })
})
