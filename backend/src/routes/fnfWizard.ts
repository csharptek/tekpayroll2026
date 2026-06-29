import { Router } from 'express'
import { authenticate, requireSuperAdmin } from '../middleware/auth'
import { prisma } from '../utils/prisma'
import { AppError } from '../middleware/errorHandler'
import { calculateFnf } from '../services/fnfService'
import { computeSalaryStructure, getSalaryInputForDate } from '../services/payrollEngine'

export const fnfWizardRouter = Router()
fnfWizardRouter.use(authenticate, requireSuperAdmin)

const WIZARD_STEPS = [
  { key: 'BASE_SALARY',     number: 1,  label: 'Base Salary' },
  { key: 'LEAVES_LOP',      number: 2,  label: 'Leaves & LOP' },
  { key: 'PRORATED_SALARY', number: 3,  label: 'Pro-rated Salary' },
  { key: 'REIMBURSEMENTS',  number: 4,  label: 'Reimbursements' },
  { key: 'LOANS',           number: 5,  label: 'Loan Deductions' },
  { key: 'PF_ESI_PT',       number: 6,  label: 'PF / ESI / PT' },
  { key: 'ASSETS',          number: 7,  label: 'Asset Clearance' },
  { key: 'NOTICE_RECOVERY', number: 8,  label: 'Notice Recovery' },
  { key: 'SALARY_PAID',     number: 9,  label: 'Salary Already Paid' },
  { key: 'HYI',             number: 10, label: 'HYI Adjustment' },
  { key: 'BONUS_PRORATION', number: 11, label: 'Bonus Pro-ration' },
  { key: 'TDS',             number: 12, label: 'TDS' },
  { key: 'FINAL_SUMMARY',   number: 13, label: 'Final Summary' },
]

// ─── GET / CREATE SESSION ─────────────────────────────────────────────────────
fnfWizardRouter.get('/:employeeId', async (req, res) => {
  const { employeeId } = req.params

  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: { id: true, name: true, employeeCode: true, department: true, resignationDate: true, lastWorkingDay: true, status: true },
  })
  if (!employee) throw new AppError('Employee not found', 404)
  if (!employee.resignationDate) throw new AppError('No resignation date set', 400)

  let session = await prisma.fnfWizardSession.findUnique({
    where: { employeeId },
    include: { steps: { orderBy: { stepNumber: 'asc' } } },
  })

  if (!session) {
    session = await prisma.fnfWizardSession.create({
      data: { employeeId, createdBy: req.user!.id },
      include: { steps: true },
    })
  }

  res.json({
    success: true,
    data: {
      session,
      employee,
      steps: WIZARD_STEPS,
    },
  })
})

// ─── GET STEP DATA (fresh computed from system) ───────────────────────────────
fnfWizardRouter.get('/:employeeId/step-data', async (req, res) => {
  const { employeeId } = req.params
  const hyiOverridesParam = req.query.hyiOverrides
  const hyiOverrides: Record<string, number> | undefined = hyiOverridesParam
    ? JSON.parse(hyiOverridesParam as string)
    : undefined

  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
    include: { loans: { where: { status: 'ACTIVE' } } },
  })
  if (!employee) throw new AppError('Employee not found', 404)
  if (!employee.resignationDate) throw new AppError('No resignation date', 400)

  // Core FnF calculation
  const calc = await calculateFnf(employeeId, undefined, hyiOverrides)

  // Latest salary snapshot
  const salarySnap = await prisma.salaryStructureSnapshot.findFirst({
    where: { employeeId, isActive: true },
    orderBy: { effectiveDate: 'desc' },
  })

  // Leave applications during FnF period
  const resignationDate = employee.resignationDate
  const fnfStartMonth = new Date(resignationDate.getFullYear(), resignationDate.getMonth() + 1, 1)
  const lwd = employee.lastWorkingDay || employee.expectedLwd!
  const lwdMonthEnd = new Date(lwd.getFullYear(), lwd.getMonth() + 1, 0)

  const fnfLeaves = await prisma.lvApplication.findMany({
    where: {
      employeeId,
      status: { in: ['APPROVED', 'AUTO_APPROVED'] },
      startDate: { gte: fnfStartMonth, lte: lwdMonthEnd },
    },
    orderBy: { startDate: 'asc' },
  })

  // Reimbursements pending (APPROVED/unpaid)
  const pendingReimbs = await prisma.reimbursement.findMany({
    where: {
      employeeId,
      status: { in: ['APPROVED'] },
    },
    orderBy: { approvedAt: 'desc' },
  })

  // Active loans
  const loans = await prisma.loan.findMany({
    where: { employeeId, status: 'ACTIVE' },
    orderBy: { createdAt: 'asc' },
  })

  // Unreturned assets
  const unreturnedAssets = await prisma.assetAssignment.findMany({
    where: { employeeId, isActive: true, returnedDate: null },
    include: { asset: { include: { category: { select: { name: true } } } } },
    orderBy: { assignedDate: 'desc' },
  })

  // Notice recovery calculation
  const requiredNoticeDays = employee.noticePeriodDays || 0
  const actualNoticeDays = calc.noticePeriodDays
  const shortfallDays = Math.max(0, requiredNoticeDays - actualNoticeDays)
  let noticeRecoveryAmount = 0
  if (shortfallDays > 0 && salarySnap) {
    const grossMonthly = Number(salarySnap.grandTotalMonthly)
    const daysInMonth = new Date(lwd.getFullYear(), lwd.getMonth() + 1, 0).getDate()
    noticeRecoveryAmount = Math.round((grossMonthly / daysInMonth) * shortfallDays * 100) / 100
  }

  // Salary already paid via payroll cycles post-resignation
  const resignMonthStart = new Date(resignationDate.getFullYear(), resignationDate.getMonth(), 1)
  const paidCycleEntries = await prisma.payrollEntry.findMany({
    where: {
      employeeId,
      cycle: {
        cycleStart: { gte: resignMonthStart },
        status: { in: ['LOCKED', 'DISBURSED'] },
      },
    },
    include: {
      cycle: { select: { payrollMonth: true, cycleStart: true, status: true } },
    },
    orderBy: { createdAt: 'asc' },
  })

  // Bonus proration
  const annualBonus = salarySnap ? Number(salarySnap.annualBonus) : 0
  const resignMonth = resignationDate.getMonth() // 0-indexed
  const currentYear = resignationDate.getFullYear()
  // Bonus paid in March (month index 2). If resigned before March, check if earned
  const bonusPeriodStart = new Date(currentYear, 3, 1) // April = start of HYI year
  const bonusPeriodEnd = new Date(currentYear + 1, 2, 31) // March next year
  const monthsInBonusPeriod = 12
  const monthsWorked = Math.max(0,
    (resignationDate.getFullYear() * 12 + resignationDate.getMonth()) -
    (bonusPeriodStart.getFullYear() * 12 + bonusPeriodStart.getMonth()) + 1
  )
  const proratedBonus = annualBonus > 0
    ? Math.round((annualBonus / monthsInBonusPeriod) * Math.min(monthsWorked, monthsInBonusPeriod) * 100) / 100
    : 0

  // Check if bonus was already paid in this period via payroll
  const bonusAlreadyPaid = paidCycleEntries
    .filter(e => e.isBolusMonth)
    .reduce((s, e) => s + Number(e.annualBonus), 0)

  const bonusRecovery = Math.max(0, bonusAlreadyPaid - proratedBonus)
  const bonusDue = Math.max(0, proratedBonus - bonusAlreadyPaid)

  res.json({
    success: true,
    data: {
      baseSalary: {
        annualCtc:        salarySnap ? Number(salarySnap.annualCtc) : Number(employee.annualCtc),
        basicMonthly:     salarySnap ? Number(salarySnap.basicMonthly) : 0,
        hraMonthly:       salarySnap ? Number(salarySnap.hraMonthly) : 0,
        transportMonthly: salarySnap ? Number(salarySnap.transportMonthly) : 0,
        fbpMonthly:       salarySnap ? Number(salarySnap.fbpMonthly) : 0,
        hyiMonthly:       salarySnap ? Number(salarySnap.hyiMonthly) : 0,
        grandTotalMonthly:salarySnap ? Number(salarySnap.grandTotalMonthly) : 0,
        effectiveDate:    salarySnap?.effectiveDate,
      },
      leavesLop: {
        leaves: fnfLeaves.map(l => ({
          id:         l.id,
          leaveKind:  l.leaveKind,
          startDate:  l.startDate,
          endDate:    l.endDate,
          totalDays:  Number(l.totalDays),
          isLop:      l.isLop,
          lopDays:    Number(l.lopDays || 0),
          isHalfDay:  l.isHalfDay,
          appliedAfterResignation: l.createdAt >= resignationDate,
        })),
        totalLopDays:   calc.lopDays,
        totalLopAmount: calc.lopAmount,
        excessLeaveDetail:  calc.excessLeaveDetail,
        excessLeaveDays:    calc.excessLeaveDays,
        excessLeaveAmount:  calc.excessLeaveAmount,
      },
      proratedSalary: {
        cycles:              calc.cycles,
        totalSalaryDays:     calc.salaryDays,
        totalProratedSalary: calc.proratedSalary,
        resignationDate:     calc.resignationDate,
        lastWorkingDay:      calc.lastWorkingDay,
        noticePeriodDays:    calc.noticePeriodDays,
        noticePeriodMonths:  calc.noticePeriodMonths,
      },
      reimbursements: {
        items: pendingReimbs.map(r => ({
          id:          r.id,
          category:    r.category,
          amount:      Number(r.amount),
          expenseDate: r.expenseDate,
          description: r.description,
          status:      r.status,
          payslipLabel:r.payslipLabel,
        })),
        total: pendingReimbs.reduce((s, r) => s + Number(r.amount), 0),
        fnfServiceTotal: calc.pendingReimbursements,
      },
      loans: {
        items: loans.map(l => ({
          id:                 l.id,
          type:               l.type,
          principalAmount:    Number(l.principalAmount),
          outstandingBalance: Number(l.outstandingBalance),
          emiAmount:          Number(l.emiAmount),
          purpose:            l.purpose,
        })),
        total: loans.reduce((s, l) => s + Number(l.outstandingBalance), 0),
      },
      pfEsiPt: {
        cycles: calc.cycles.map(c => ({
          cycleLabel: c.cycleLabel,
          pfAmount:   c.pfAmount,
          esiAmount:  c.esiAmount,
          ptAmount:   c.ptAmount,
        })),
        totalPf:  calc.pfAmount,
        totalEsi: calc.esiAmount,
        totalPt:  calc.ptAmount,
      },
      assets: {
        items: unreturnedAssets.map(a => ({
          id:           a.id,
          assetCode:    a.asset.assetCode,
          assetName:    a.asset.name,
          category:     a.asset.category.name,
          assignedDate: a.assignedDate,
          condition:    a.condition,
        })),
        count:    unreturnedAssets.length,
        hasBlock: unreturnedAssets.length > 0,
      },
      noticeRecovery: {
        requiredNoticeDays:   requiredNoticeDays,
        actualNoticeDays:     actualNoticeDays,
        shortfallDays:        shortfallDays,
        recoveryAmount:       noticeRecoveryAmount,
        buyoutAmount:         Number(employee.buyoutAmount || 0),
        noticePeriodServed:   employee.noticePeriodServed,
      },
      salaryPaid: {
        entries: paidCycleEntries.map(e => ({
          cycleMonth:    e.cycle.payrollMonth,
          cycleStatus:   e.cycle.status,
          grossSalary:   Number(e.grossSalary),
          proratedGross: Number(e.proratedGross),
          isProrated:    e.isProrated,
          payableDays:   e.payableDays,
          totalDays:     e.totalDays,
          netSalary:     Number(e.netSalary),
          pfAmount:      Number(e.pfAmount),
          esiAmount:     Number(e.esiAmount),
          tdsAmount:     Number(e.tdsAmount),
          lopDays:       e.lopDays,
          lopAmount:     Number(e.lopAmount),
        })),
        totalPaid: paidCycleEntries.reduce((s, e) => s + Number(e.netSalary), 0),
        totalGross: paidCycleEntries.reduce((s, e) => s + Number(e.proratedGross), 0),
      },
      hyi: {
        hyiRecovery:       calc.hyiRecovery,
        hyiRecoveryDetail: calc.hyiRecoveryDetail,
      },
      bonusProration: {
        annualBonus,
        proratedBonus,
        bonusAlreadyPaid,
        bonusRecovery,
        bonusDue,
        monthsWorked: Math.min(monthsWorked, monthsInBonusPeriod),
        monthsInPeriod: monthsInBonusPeriod,
      },
      tds: {
        cycles: calc.cycles.map(c => ({
          cycleLabel: c.cycleLabel,
          tdsAmount:  c.tdsAmount,
        })),
        total: calc.tdsAmount,
      },
      summary: {
        totalAdditions:  calc.totalAdditions,
        totalDeductions: calc.totalDeductions,
        netPayable:      calc.netPayable,
        isNegative:      calc.isNegative,
        breakdown:       calc.breakdown,
      },
    },
  })
})

// ─── CONFIRM STEP ─────────────────────────────────────────────────────────────
fnfWizardRouter.post('/:employeeId/step/:stepKey/confirm', async (req, res) => {
  const { employeeId, stepKey } = req.params
  const { originalData, overrideData, notes } = req.body

  const step = WIZARD_STEPS.find(s => s.key === stepKey)
  if (!step) throw new AppError('Invalid step key', 400)

  const session = await prisma.fnfWizardSession.findUnique({ where: { employeeId } })
  if (!session) throw new AppError('Wizard session not found', 404)

  const saved = await prisma.fnfWizardStepData.upsert({
    where: { sessionId_stepKey: { sessionId: session.id, stepKey } },
    create: {
      sessionId:    session.id,
      stepKey,
      stepNumber:   step.number,
      originalData: originalData || {},
      overrideData: overrideData || null,
      notes:        notes || null,
      confirmedAt:  new Date(),
      confirmedBy:  req.user!.id,
    },
    update: {
      originalData: originalData || {},
      overrideData: overrideData || null,
      notes:        notes || null,
      confirmedAt:  new Date(),
      confirmedBy:  req.user!.id,
    },
  })

  // Advance currentStep to next
  const currentIdx = WIZARD_STEPS.findIndex(s => s.key === stepKey)
  const nextStep = WIZARD_STEPS[currentIdx + 1]
  await prisma.fnfWizardSession.update({
    where: { id: session.id },
    data:  { currentStep: nextStep ? nextStep.key : stepKey },
  })

  res.json({ success: true, data: saved })
})

// ─── COMPLETE WIZARD → CREATE/UPDATE FnF SETTLEMENT ───────────────────────────
fnfWizardRouter.post('/:employeeId/complete', async (req, res) => {
  const { employeeId } = req.params

  const session = await prisma.fnfWizardSession.findUnique({
    where: { employeeId },
    include: { steps: true },
  })
  if (!session) throw new AppError('Wizard session not found', 404)

  // Read confirmed step data
  const getStep = (key: string) => {
    const s = session.steps.find(st => st.stepKey === key)
    if (!s) return null
    const orig = s.originalData as any
    const over = s.overrideData as any
    return { original: orig, override: over, merged: { ...orig, ...(over || {}) } }
  }

  const hyi       = getStep('HYI')
  const hyiOverrides: Record<string, number> | undefined = hyi?.override?.hyiMonthOverrides

  // Re-run calculation with any hyi overrides
  const calc = await calculateFnf(employeeId, undefined, hyiOverrides)

  // Apply override values from confirmed steps
  const proratedStep   = getStep('PRORATED_SALARY')
  const reimStep       = getStep('REIMBURSEMENTS')
  const loansStep      = getStep('LOANS')
  const pfStep         = getStep('PF_ESI_PT')
  const noticeStep     = getStep('NOTICE_RECOVERY')
  const tdsStep        = getStep('TDS')
  const bonusStep      = getStep('BONUS_PRORATION')

  const salaryAmount      = proratedStep?.override?.totalProratedSalary ?? calc.proratedSalary
  const reimbursements    = reimStep?.override?.total ?? calc.pendingReimbursements
  const loanOutstanding   = loansStep?.override?.total ?? calc.loanOutstanding
  const pfAmount          = pfStep?.override?.totalPf ?? calc.pfAmount
  const esiAmount         = pfStep?.override?.totalEsi ?? calc.esiAmount
  const ptAmount          = pfStep?.override?.totalPt ?? calc.ptAmount
  const tdsAmount         = tdsStep?.override?.total ?? calc.tdsAmount
  const hyiRecovery       = hyi?.override?.hyiRecovery ?? calc.hyiRecovery
  const noticeRecovery    = noticeStep?.override?.recoveryAmount ?? 0
  const bonusRecovery     = bonusStep?.override?.bonusRecovery ?? 0
  const otherDeductions   = noticeRecovery + bonusRecovery

  const lopDays           = proratedStep?.override?.totalLopDays ?? calc.lopDays
  const lopAmount         = proratedStep?.override?.totalLopAmount ?? calc.lopAmount
  const excessLeaveAmount = calc.excessLeaveAmount

  const totalDeductions = pfAmount + esiAmount + ptAmount + tdsAmount +
    loanOutstanding + hyiRecovery + lopAmount + excessLeaveAmount + otherDeductions
  const netPayable = Math.max(-999999, Math.round((salaryAmount + reimbursements - totalDeductions) * 100) / 100)
  const isNeg = netPayable < 0

  const breakdown = [
    { label: `Pro-rated Salary (${calc.noticePeriodMonths} month(s))`, amount: salaryAmount, type: 'addition' as const },
    ...(reimbursements > 0 ? [{ label: 'Reimbursements', amount: reimbursements, type: 'addition' as const }] : []),
    { label: 'Employee PF', amount: pfAmount, type: 'deduction' as const },
    ...(esiAmount > 0 ? [{ label: 'ESI', amount: esiAmount, type: 'deduction' as const }] : []),
    ...(ptAmount  > 0 ? [{ label: 'Professional Tax', amount: ptAmount, type: 'deduction' as const }] : []),
    ...(tdsAmount > 0 ? [{ label: 'TDS', amount: tdsAmount, type: 'deduction' as const }] : []),
    ...(loanOutstanding > 0 ? [{ label: 'Loan Outstanding', amount: loanOutstanding, type: 'deduction' as const }] : []),
    ...(hyiRecovery > 0 ? [{ label: 'HYI Recovery', amount: hyiRecovery, type: 'deduction' as const }] : []),
    ...(lopAmount > 0 ? [{ label: `LOP (${lopDays} days)`, amount: lopAmount, type: 'deduction' as const }] : []),
    ...(excessLeaveAmount > 0 ? [{ label: 'Excess Leave Recovery', amount: excessLeaveAmount, type: 'deduction' as const }] : []),
    ...(noticeRecovery > 0 ? [{ label: 'Notice Period Recovery', amount: noticeRecovery, type: 'deduction' as const }] : []),
    ...(bonusRecovery  > 0 ? [{ label: 'Bonus Recovery', amount: bonusRecovery, type: 'deduction' as const }] : []),
  ]

  const totalSalaryDays = calc.salaryDays

  // Create or update FnfSettlement
  const existing = await prisma.fnfSettlement.findUnique({ where: { employeeId } })

  let settlement: any
  if (existing) {
    settlement = await prisma.fnfSettlement.update({
      where: { employeeId },
      data: {
        resignationDate:   calc.resignationDate,
        lastWorkingDay:    calc.lastWorkingDay,
        salaryDays:        totalSalaryDays,
        salaryAmount,
        reimbursements,
        pfAmount,
        esiAmount,
        ptAmount,
        tdsAmount,
        incentiveRecovery: hyiRecovery,
        loanOutstanding,
        otherDeductions,
        netPayable:        Math.abs(netPayable),
        breakdownJson:     JSON.stringify(breakdown),
        cyclesJson:        JSON.stringify(calc.cycles || []),
        hyiRecoveryDetailJson: JSON.stringify(calc.hyiRecoveryDetail || []),
        excessLeaveDetailJson: JSON.stringify(calc.excessLeaveDetail || []),
      },
      include: { employee: true },
    })
  } else {
    settlement = await prisma.fnfSettlement.create({
      data: {
        employeeId,
        resignationDate:   calc.resignationDate,
        lastWorkingDay:    calc.lastWorkingDay,
        noticePeriosDays:  calc.noticePeriodDays,
        salaryDays:        totalSalaryDays,
        salaryAmount,
        reimbursements,
        pfAmount,
        esiAmount,
        ptAmount,
        tdsAmount,
        incentiveRecovery: hyiRecovery,
        loanOutstanding,
        otherDeductions,
        netPayable:        Math.abs(netPayable),
        breakdownJson:     JSON.stringify(breakdown),
        cyclesJson:        JSON.stringify(calc.cycles || []),
        hyiOverridesJson:  hyiOverrides ? JSON.stringify(hyiOverrides) : null,
        hyiRecoveryDetailJson: JSON.stringify(calc.hyiRecoveryDetail || []),
        excessLeaveDetailJson: JSON.stringify(calc.excessLeaveDetail || []),
        status:            'INITIATED',
      },
      include: { employee: true },
    })
  }

  // Mark session complete
  await prisma.fnfWizardSession.update({
    where: { id: session.id },
    data:  { status: 'COMPLETED' },
  })

  res.json({
    success: true,
    data: {
      settlement,
      summary: {
        salaryAmount,
        reimbursements,
        pfAmount,
        esiAmount,
        ptAmount,
        tdsAmount,
        hyiRecovery,
        loanOutstanding,
        otherDeductions,
        totalDeductions,
        netPayable,
        isNegative: isNeg,
        breakdown,
      },
    },
  })
})

// ─── RESET SESSION ────────────────────────────────────────────────────────────
fnfWizardRouter.delete('/:employeeId', async (req, res) => {
  await prisma.fnfWizardSession.deleteMany({ where: { employeeId: req.params.employeeId } })
  res.json({ success: true })
})
