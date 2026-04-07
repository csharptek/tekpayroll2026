import { Router } from 'express'
import { authenticate, requireSuperAdmin } from '../middleware/auth'
import { prisma } from '../utils/prisma'
import { AppError } from '../middleware/errorHandler'
import { createAuditLog } from '../middleware/audit'
import { AuditAction, PayrollStatus } from '@prisma/client'
import { calculatePayrollForEmployee, isBonusMonth, getEsiConfig, getSalaryInputForDate } from '../services/payrollEngine'

export const payrollRouter = Router()
payrollRouter.use(authenticate)

// ─── GET ALL CYCLES ──────────────────────────────────────────────────────────

payrollRouter.get('/cycles', async (_req, res) => {
  const cycles = await prisma.payrollCycle.findMany({
    orderBy: { cycleStart: 'desc' },
    take: 24,
  })
  res.json({ success: true, data: cycles })
})

// ─── GET CYCLE DETAIL ────────────────────────────────────────────────────────

payrollRouter.get("/cycles/:id", requireSuperAdmin, async (req, res) => {
  const cycle = await prisma.payrollCycle.findUnique({
    where: { id: req.params.id },
    include: {
      entries: {
        include: {
          employee: { select: { id: true, name: true, employeeCode: true, department: true } },
          payslip: { select: { status: true } },
        },
      },
    },
  })
  if (!cycle) throw new AppError('Payroll cycle not found', 404)
  res.json({ success: true, data: cycle })
})

// ─── CREATE CYCLE ─────────────────────────────────────────────────────────────

payrollRouter.post('/cycles', requireSuperAdmin, async (req, res) => {
  const { cycleStart, cycleEnd, payrollMonth } = req.body
  const existing = await prisma.payrollCycle.findFirst({ where: { payrollMonth } })
  if (existing) throw new AppError(`Payroll cycle for ${payrollMonth} already exists`, 409)

  const start = new Date(cycleStart)
  const end   = new Date(cycleEnd)
  const cycle = await prisma.payrollCycle.create({
    data: {
      cycleStart: start,
      cycleEnd:   end,
      payrollMonth,
      payrollDate: new Date(end.getFullYear(), end.getMonth(), 27),
      payslipDate: new Date(end.getFullYear(), end.getMonth() + 1, 5),
      salaryDate:  new Date(end.getFullYear(), end.getMonth() + 1, 0),
    },
  })
  res.status(201).json({ success: true, data: cycle })
})

// ─── HELPER: build salaryInput from employee record ───────────────────────────

function buildSalaryInput(emp: any) {
  return {
    annualCtc:        Number(emp.annualCtc),
    basicPercent:     Number(emp.basicPercent    ?? 45),
    hraPercent:       Number(emp.hraPercent      ?? 35),
    transportMonthly: emp.transportMonthly != null ? Number(emp.transportMonthly) : null,
    fbpMonthly:       emp.fbpMonthly       != null ? Number(emp.fbpMonthly)       : null,
    mediclaim:        Number(emp.mediclaim        ?? 0),
    hasIncentive:     Boolean(emp.hasIncentive),
    incentivePercent: Number(emp.incentivePercent ?? 12),
  }
}

// ─── RUN PAYROLL ─────────────────────────────────────────────────────────────

payrollRouter.post('/cycles/:id/run', requireSuperAdmin, async (req, res) => {
  const cycle = await prisma.payrollCycle.findUnique({ where: { id: req.params.id } })
  if (!cycle) throw new AppError('Payroll cycle not found', 404)
  if (cycle.status === PayrollStatus.LOCKED || cycle.status === PayrollStatus.DISBURSED) {
    throw new AppError('Cannot run payroll on a locked or disbursed cycle', 400)
  }

  const employees = await prisma.employee.findMany({
    where: { status: { in: ['ACTIVE', 'ON_NOTICE'] } },
  })

  const results = []
  let totalGross = 0, totalNet = 0, totalPf = 0, totalEsi = 0

  for (const emp of employees) {
    try {
      const lopEntry = await prisma.lopEntry.findUnique({
        where: { cycleId_employeeId: { cycleId: cycle.id, employeeId: emp.id } },
      })

      const reimbs = await prisma.reimbursement.aggregate({
        where: { cycleId: cycle.id, employeeId: emp.id },
        _sum: { amount: true },
      })

      const revisionInput = await getSalaryInputForDate(emp.id, cycle.cycleStart)

      const calc = await calculatePayrollForEmployee({
        employeeId:      emp.id,
        salaryInput:     revisionInput,
        state:           emp.state || '',
        joiningDate:     emp.joiningDate,
        lastWorkingDay:  emp.lastWorkingDay,
        resignationDate: emp.resignationDate,
        cycleStart:      cycle.cycleStart,
        cycleEnd:        cycle.cycleEnd,
        payrollMonth:    cycle.payrollMonth,
        lopDays:         lopEntry?.lopDays || 0,
        tdsMonthly:      revisionInput.tdsMonthly,
        reimbursements:  Number(reimbs._sum.amount || 0),
        employeeStatus:  emp.status,
      })

      const s = calc.salary
      const bonusThisCycle = isBonusMonth(cycle.payrollMonth)

      await prisma.payrollEntry.upsert({
        where:  { cycleId_employeeId: { cycleId: cycle.id, employeeId: emp.id } },
        create: {
          cycleId:           cycle.id,
          employeeId:        emp.id,
          annualCtc:         s.annualCtc,
          monthlyCtc:        s.grandTotalMonthly,
          basic:             s.basicMonthly,
          hra:               s.hraMonthly,
          transport:         s.transportMonthly,
          fbp:               s.fbpMonthly,
          hyi:               s.hyiMonthly,
          grossSalary:       s.grandTotalMonthly,
          annualBonus:       bonusThisCycle ? s.annualBonus : 0,
          isBolusMonth:      bonusThisCycle,
          totalDays:         calc.proration.totalDays,
          payableDays:       calc.proration.payableDays,
          isProrated:        calc.proration.isProrated,
          proratedGross:     calc.proration.proratedGross,
          incentive:         0,
          reimbursementTotal: calc.reimbursements,
          lopDays:           lopEntry?.lopDays || 0,
          lopAmount:         calc.deductions.lop,
          pfAmount:          calc.deductions.pf,
          esiAmount:         calc.deductions.esi,
          ptAmount:          calc.deductions.pt,
          tdsAmount:         calc.deductions.tds,
          incentiveRecovery: calc.deductions.incentiveRecovery,
          loanDeduction:     calc.deductions.loanDeduction,
          netSalary:         calc.netSalary,
          status:            'CALCULATED',
        },
        update: {
          annualCtc:         s.annualCtc,
          monthlyCtc:        s.grandTotalMonthly,
          basic:             s.basicMonthly,
          hra:               s.hraMonthly,
          transport:         s.transportMonthly,
          fbp:               s.fbpMonthly,
          hyi:               s.hyiMonthly,
          grossSalary:       s.grandTotalMonthly,
          annualBonus:       bonusThisCycle ? s.annualBonus : 0,
          isBolusMonth:      bonusThisCycle,
          totalDays:         calc.proration.totalDays,
          payableDays:       calc.proration.payableDays,
          isProrated:        calc.proration.isProrated,
          proratedGross:     calc.proration.proratedGross,
          reimbursementTotal: calc.reimbursements,
          lopDays:           lopEntry?.lopDays || 0,
          lopAmount:         calc.deductions.lop,
          pfAmount:          calc.deductions.pf,
          esiAmount:         calc.deductions.esi,
          ptAmount:          calc.deductions.pt,
          tdsAmount:         calc.deductions.tds,
          incentiveRecovery: calc.deductions.incentiveRecovery,
          loanDeduction:     calc.deductions.loanDeduction,
          netSalary:         calc.netSalary,
          status:            'CALCULATED',
        },
      })

      totalGross += s.grandTotalMonthly
      totalNet   += calc.netSalary
      totalPf    += calc.deductions.pf
      totalEsi   += calc.deductions.esi
      results.push({ employeeId: emp.id, name: emp.name, netSalary: calc.netSalary, status: 'ok' })
    } catch (err: any) {
      results.push({ employeeId: emp.id, name: emp.name, status: 'error', error: err.message })
    }
  }

  await prisma.payrollCycle.update({
    where: { id: cycle.id },
    data: {
      status: PayrollStatus.CALCULATED,
      runAt: new Date(),
      runBy: req.user!.id,
      totalGross,
      totalNet,
      totalPf,
      totalEsi,
      employeeCount: employees.length,
    },
  })

  await createAuditLog({
    user: req.user!,
    action: AuditAction.PAYROLL_RUN,
    recordId: cycle.id,
    description: `Payroll run for ${cycle.payrollMonth} — ${employees.length} employees`,
  })

  // Leave module hooks — auto-approve pending leaves + take monthly balance snapshot
  try {
    const { autoApprovePendingLeaves, takeMonthlySnapshot } = await import('../services/leaveService')
    await autoApprovePendingLeaves()
    await takeMonthlySnapshot(cycle.id, cycle.payrollMonth)
  } catch (err) {
    console.error('[LEAVE] Leave hooks failed on payroll run:', err)
  }

  res.json({ success: true, data: { cycle: cycle.payrollMonth, results, totalGross, totalNet } })
})


// ─── DRY RUN (no DB writes) ───────────────────────────────────────────────────

payrollRouter.post('/dry-run', requireSuperAdmin, async (req, res) => {
  const { cycleStart, cycleEnd, payrollMonth, overrides = {} } = req.body
  if (!cycleStart || !cycleEnd || !payrollMonth) {
    throw new AppError('cycleStart, cycleEnd and payrollMonth are required', 400)
  }

  const start = new Date(cycleStart)
  const end   = new Date(cycleEnd)

  // Fetch shared data once upfront
  const [employees, esiConfig] = await Promise.all([
    prisma.employee.findMany({
      where: { status: { in: ['ACTIVE', 'ON_NOTICE'] } },
      orderBy: { name: 'asc' },
    }),
    getEsiConfig(),
  ])

  const bonusMonth = isBonusMonth(payrollMonth)

  // Process all employees in parallel
  const settled = await Promise.allSettled(
    employees.map(async (emp) => {
      const override = overrides[emp.id] || {}
      let lopDays     = override.lopDays      !== undefined ? Number(override.lopDays)       : 0
      let reimbAmount = override.reimbursements !== undefined ? Number(override.reimbursements) : 0

      if (override.lopDays === undefined || override.reimbursements === undefined) {
        const [lopEntry, reimbs] = await Promise.all([
          prisma.lopEntry.findFirst({ where: { employeeId: emp.id, cycle: { payrollMonth } } }),
          prisma.reimbursement.aggregate({ where: { employeeId: emp.id, cycle: { payrollMonth } }, _sum: { amount: true } }),
        ])
        if (override.lopDays === undefined)        lopDays     = lopEntry?.lopDays || 0
        if (override.reimbursements === undefined)  reimbAmount = Number(reimbs._sum.amount || 0)
      }

      const revisionInput = await getSalaryInputForDate(emp.id, start)

      const calc = await calculatePayrollForEmployee({
        employeeId:      emp.id,
        salaryInput:     revisionInput,
        state:           emp.state || '',
        joiningDate:     emp.joiningDate,
        lastWorkingDay:  emp.lastWorkingDay,
        resignationDate: emp.resignationDate,
        cycleStart:      start,
        cycleEnd:        end,
        payrollMonth,
        lopDays,
        tdsMonthly:      revisionInput.tdsMonthly,
        reimbursements:  reimbAmount,
        employeeStatus:  emp.status,
        esiConfig,
      })

      return { emp, calc, lopDays, reimbAmount }
    })
  )

  const results: any[] = []
  let totalGross = 0, totalNet = 0, totalPf = 0, totalEsi = 0, totalTds = 0, totalLoan = 0

  settled.forEach((result, i) => {
    const emp = employees[i]
    if (result.status === 'rejected') {
      results.push({
        employeeId: emp.id, employeeCode: emp.employeeCode,
        name: emp.name, department: emp.department,
        status: 'error', error: result.reason?.message || 'Unknown error', netSalary: 0,
      })
      return
    }
    const { calc, lopDays, reimbAmount } = result.value
    const s = calc.salary
    totalGross += calc.proration.proratedGross
    totalNet   += calc.netSalary
    totalPf    += calc.deductions.pf
    totalEsi   += calc.deductions.esi
    totalTds   += calc.deductions.tds
    totalLoan  += calc.deductions.loanDeduction
    results.push({
      employeeId:    emp.id,
      employeeCode:  emp.employeeCode,
      name:          emp.name,
      department:    emp.department,
      designation:   emp.jobTitle,
      annualCtc:     s.annualCtc,
      grossMonthly:  s.grandTotalMonthly,
      basic:         s.basicMonthly,
      hra:           s.hraMonthly,
      transport:     s.transportMonthly,
      fbp:           s.fbpMonthly,
      hyi:           s.hyiMonthly,
      annualBonus:   bonusMonth ? s.annualBonus : 0,
      isBonusMonth:  bonusMonth,
      totalDays:     calc.proration.totalDays,
      payableDays:   calc.proration.payableDays,
      isProrated:    calc.proration.isProrated,
      proratedGross: calc.proration.proratedGross,
      reimbursements:reimbAmount,
      lopDays,
      lopAmount:     calc.deductions.lop,
      pfAmount:      calc.deductions.pf,
      esiAmount:     calc.deductions.esi,
      ptAmount:      calc.deductions.pt,
      tdsAmount:     calc.deductions.tds,
      loanDeduction: calc.deductions.loanDeduction,
      netSalary:     calc.netSalary,
      status:        'ok',
    })
  })

  res.json({
    success: true,
    data: {
      payrollMonth, cycleStart, cycleEnd,
      isBonusMonth: bonusMonth,
      employeeCount: employees.length,
      summary: {
        totalGross: Math.round(totalGross * 100) / 100,
        totalNet:   Math.round(totalNet   * 100) / 100,
        totalPf:    Math.round(totalPf    * 100) / 100,
        totalEsi:   Math.round(totalEsi   * 100) / 100,
        totalTds:   Math.round(totalTds   * 100) / 100,
        totalLoan:  Math.round(totalLoan  * 100) / 100,
      },
      results,
    },
  })
})

// ─── LOCK CYCLE ───────────────────────────────────────────────────────────────

payrollRouter.post('/cycles/:id/lock', requireSuperAdmin, async (req, res) => {
  const cycle = await prisma.payrollCycle.findUnique({ where: { id: req.params.id } })
  if (!cycle) throw new AppError('Payroll cycle not found', 404)
  if (cycle.status !== PayrollStatus.CALCULATED) throw new AppError('Only calculated cycles can be locked', 400)

  const updated = await prisma.payrollCycle.update({
    where: { id: req.params.id },
    data: { status: PayrollStatus.LOCKED, lockedAt: new Date(), lockedBy: req.user!.id },
  })

  await createAuditLog({ user: req.user!, action: AuditAction.PAYROLL_LOCK, recordId: cycle.id, description: `Locked ${cycle.payrollMonth}` })
  res.json({ success: true, data: updated })
})

// ─── UNLOCK CYCLE ─────────────────────────────────────────────────────────────

payrollRouter.post('/cycles/:id/unlock', requireSuperAdmin, async (req, res) => {
  const cycle = await prisma.payrollCycle.findUnique({ where: { id: req.params.id } })
  if (!cycle) throw new AppError('Payroll cycle not found', 404)
  if (cycle.status !== PayrollStatus.LOCKED) throw new AppError('Only locked cycles can be unlocked', 400)

  const updated = await prisma.payrollCycle.update({
    where: { id: req.params.id },
    data: {
      status: PayrollStatus.CALCULATED,
      unlockedAt: new Date(),
      unlockedBy: req.user!.id,
      unlockReason: req.body.reason,
    },
  })

  await createAuditLog({ user: req.user!, action: AuditAction.PAYROLL_UNLOCK, recordId: cycle.id, description: `Unlocked ${cycle.payrollMonth}: ${req.body.reason}` })
  res.json({ success: true, data: updated })
})

// ─── DISBURSE ─────────────────────────────────────────────────────────────────

payrollRouter.post('/cycles/:id/disburse', requireSuperAdmin, async (req, res) => {
  const cycle = await prisma.payrollCycle.findUnique({ where: { id: req.params.id } })
  if (!cycle) throw new AppError('Payroll cycle not found', 404)
  if (cycle.status !== PayrollStatus.LOCKED) throw new AppError('Only locked cycles can be disbursed', 400)

  const updated = await prisma.payrollCycle.update({
    where: { id: req.params.id },
    data: { status: PayrollStatus.DISBURSED, disbursedAt: new Date(), disbursedBy: req.user!.id },
  })

  res.json({ success: true, data: updated })
})

// ─── UPDATE SINGLE ENTRY (TDS override etc) ───────────────────────────────────

payrollRouter.put('/entries/:id', requireSuperAdmin, async (req, res) => {
  const entry = await prisma.payrollEntry.findUnique({ where: { id: req.params.id } })
  if (!entry) throw new AppError('Entry not found', 404)

  const { tdsAmount, adjustmentNote } = req.body
  const updated = await prisma.payrollEntry.update({
    where: { id: req.params.id },
    data: {
      tdsAmount:     tdsAmount ?? entry.tdsAmount,
      adjustmentNote,
      adjustedBy:    req.user!.id,
      status:        'ADJUSTED',
    },
  })
  res.json({ success: true, data: updated })
})

// ─── GET EMPLOYEE ENTRIES ─────────────────────────────────────────────────────

payrollRouter.get('/employee/:employeeId', async (req, res) => {
  const entries = await prisma.payrollEntry.findMany({
    where: { employeeId: req.params.employeeId },
    include: { cycle: { select: { payrollMonth: true, status: true } } },
    orderBy: { createdAt: 'desc' },
    take: 24,
  })
  res.json({ success: true, data: entries })
})

// ─── REPORTS ─────────────────────────────────────────────────────────────────

payrollRouter.get('/cycles/:id/summary', requireSuperAdmin, async (req, res) => {
  const entries = await prisma.payrollEntry.findMany({
    where: { cycleId: req.params.id },
    include: { employee: { select: { name: true, employeeCode: true, department: true } } },
    orderBy: { employee: { name: 'asc' } },
  })
  res.json({ success: true, data: entries })
})
