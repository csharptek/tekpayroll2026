import { Router } from 'express'
import { authenticate, requireSuperAdmin } from '../middleware/auth'
import { prisma } from '../utils/prisma'
import { AppError } from '../middleware/errorHandler'
import { createAuditLog } from '../middleware/audit'
import { AuditAction } from '@prisma/client'
import { generateAndDeliverPayslips } from '../services/payslipService'

export const payslipRouter = Router()
payslipRouter.use(authenticate)

// GET payslips for a specific employee (self-service + HR)
payslipRouter.get('/employee/:employeeId', async (req, res) => {
  // Employees can only view their own
  if (req.user!.role === 'EMPLOYEE' && req.user!.id !== req.params.employeeId) {
    throw new AppError('Access denied', 403)
  }

  const payslips = await prisma.payslip.findMany({
    where: { employeeId: req.params.employeeId },
    include: {
      cycle: { select: { payrollMonth: true, status: true } },
    },
    orderBy: { createdAt: 'desc' },
  })

  res.json({ success: true, data: payslips })
})

// GET single payslip
payslipRouter.get('/:id', async (req, res) => {
  const payslip = await prisma.payslip.findUnique({
    where: { id: req.params.id },
    include: { employee: true, cycle: true },
  })
  if (!payslip) throw new AppError('Payslip not found', 404)

  // Employees can only access their own
  if (req.user!.role === 'EMPLOYEE' && req.user!.id !== payslip.employeeId) {
    throw new AppError('Access denied', 403)
  }

  res.json({ success: true, data: payslip })
})

// POST generate payslips for a cycle (HR only)
payslipRouter.post('/generate/:cycleId', requireSuperAdmin, async (req, res) => {
  const { cycleId } = req.params
  const { employeeIds } = req.body // optional — generate for specific employees only

  const cycle = await prisma.payrollCycle.findUnique({ where: { id: cycleId } })
  if (!cycle) throw new AppError('Payroll cycle not found', 404)

  if (!['CALCULATED', 'LOCKED', 'DISBURSED'].includes(cycle.status)) {
    throw new AppError('Payroll must be calculated before generating payslips', 400)
  }

  // Run generation (async — responds immediately with job started)
  // For small teams we do it synchronously; for large teams queue it
  const result = await generateAndDeliverPayslips(cycleId, employeeIds)

  await createAuditLog({
    user: req.user!,
    action: AuditAction.PAYSLIP_GENERATE,
    recordId: cycleId,
    description: `Payslip generation for ${cycle.payrollMonth}: ${result.success} success, ${result.failed} failed`,
  })

  res.json({
    success: true,
    data: {
      cycleId,
      payrollMonth: cycle.payrollMonth,
      ...result,
    },
  })
})

// POST regenerate single payslip (HR only)
payslipRouter.post('/regenerate/:entryId', requireSuperAdmin, async (req, res) => {
  const entry = await prisma.payrollEntry.findUnique({ where: { id: req.params.entryId } })
  if (!entry) throw new AppError('Payroll entry not found', 404)

  const result = await generateAndDeliverPayslips(entry.cycleId, [entry.employeeId])

  res.json({
    success: true,
    data: result,
    message: result.failed > 0 ? 'Regeneration failed' : 'Payslip regenerated and emailed',
  })
})
