import { prisma } from '../utils/prisma'
import { AppError } from '../middleware/errorHandler'
import { computeSalaryStructure, computeEsi, computePt, computeLop, getSalaryInputForDate, getHyiSlab } from './payrollEngine'

export interface FnfCycleBreakdown {
  cycleLabel:    string
  cycleStart:    Date
  cycleEnd:      Date
  totalDays:     number
  salaryDays:    number
  grossMonthly:  number
  proratedSalary:number
  pfAmount:      number
  esiAmount:     number
  ptAmount:      number
  tdsAmount:     number
  lopDays:       number
  lopAmount:     number
}

export interface FnfCalculation {
  employeeId:        string
  employeeName:      string
  resignationDate:   Date
  lastWorkingDay:    Date
  cycleStart:        Date   // first cycle start (for compat)
  salaryDays:        number // total days across F&F-paid cycles only (Jul/Aug-style months)
  totalCycleDays:    number // total cycle days (for compat)
  noticePeriodDays:  number // full span: resignation date → LWD, inclusive
  noticePeriodMonths:number // distinct calendar months touched, resignation → LWD
  grossSalary:       number
  proratedSalary:    number
  pendingReimbursements: number
  pfAmount:          number
  esiAmount:         number
  ptAmount:          number
  tdsAmount:         number
  loanOutstanding:   number
  otherDeductions:   number
  hyiRecovery:       number
  hyiRecoveryDetail: HyiRecoveryDetailRow[]
  lopDays:           number
  lopAmount:         number
  excessLeaveDays:   number
  excessLeaveAmount: number
  excessLeaveDetail: ExcessLeaveDetailRow[]
  totalAdditions:    number
  totalDeductions:   number
  netPayable:        number
  isNegative:        boolean // true if deductions exceeded earnings (employee owes company)
  cycles:            FnfCycleBreakdown[]
  breakdown: { label: string; amount: number; type: 'addition' | 'deduction' }[]
}

export interface ExcessLeaveDetailRow {
  leaveKind:        string
  annualEntitlement:number
  monthsElapsed:    number
  proratedAllowed:  number
  usedDays:         number
  excessDays:       number
  excessAmount:     number
}

export interface HyiRecoveryDetailRow {
  monthLabel:   string
  monthKey:     string  // 'YYYY-MM' — used to key manual overrides
  amount:       number  // amount actually used (override if provided, else system value)
  systemAmount: number  // what the system would compute from salary history, for comparison
  isOverridden: boolean
}

function daysBetween(start: Date, end: Date): number {
  return Math.round(Math.abs(end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1
}

function r2(n: number): number { return Math.round(n * 100) / 100 }

// Salary is calendar-month based (1st → last day of month).
// The 26th is only the payroll RUN date; salary itself covers the full calendar month.
function monthStart(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1)
}
function monthEnd(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0) // day 0 of next month = last day
}
function monthLabel(date: Date): string {
  return date.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })
}

export async function calculateFnf(
  employeeId: string,
  overrideLwd?: Date,
  hyiOverrides?: Record<string, number>
): Promise<FnfCalculation> {
  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
    include: { loans: { where: { status: 'ACTIVE' } } },
  })

  if (!employee) throw new AppError('Employee not found', 404)
  if (!employee.resignationDate) throw new AppError('No resignation date set', 400)

  const lwd = overrideLwd || employee.lastWorkingDay || employee.expectedLwd
  if (!lwd) throw new AppError('No last working day set', 400)

  const resignationDate = employee.resignationDate

  // ─── BUILD MONTH LIST ─────────────────────────────────────────────────────
  // Resignation month salary is paid via normal payroll (HYI suppressed).
  // F&F covers: month AFTER resignation → LWD month.
  // All intermediate months: full salary, no HYI.
  // LWD month: prorated 1st → LWD day, no HYI.

  const fnfStartMonth  = new Date(resignationDate.getFullYear(), resignationDate.getMonth() + 1, 1)
  const lwdMonthStart  = monthStart(lwd)

  const cycles: FnfCycleBreakdown[] = []
  let cursor = fnfStartMonth

  // ─── LOP-RELEVANT LEAVE (notice-period rule) ──────────────────────────────
  // Only leave applications dated within fnfStartMonth..lwd are relevant — resignation
  // month is paid via normal payroll and tracked there via LopEntry, not here.
  // Rule: pre-resignation approved leave stays paid as originally approved.
  //       Leave applied (createdAt) AFTER resignationDate during notice → forced full LOP,
  //       since leave is not allowed during notice.
  //       Leave already flagged isLop (entitlement exceeded) → use its stored lopDays as-is.
  const fnfRangeApps = await prisma.lvApplication.findMany({
    where: {
      employeeId,
      status:    { in: ['APPROVED', 'AUTO_APPROVED'] },
      startDate: { gte: fnfStartMonth, lte: monthEnd(lwd) },
    },
  })

  while (cursor <= lwdMonthStart) {
    const mStart = monthStart(cursor)
    const mEnd   = monthEnd(cursor)
    const totalDays = daysBetween(mStart, mEnd) // calendar days in month

    const isLwdMonth = mStart.getTime() === lwdMonthStart.getTime()

    // Resignation month is paid FULL (employee worked 1st onward).
    // LWD month is prorated 1st → LWD day.
    const salaryDays = isLwdMonth ? daysBetween(mStart, lwd) : totalDays

    if (salaryDays > 0) {
      const salaryInput = await getSalaryInputForDate(employeeId, mStart)

      // Use snapshot (prebuiltSalary) when available — avoids recomputation drift.
      // Explicitly zero HYI: employee is on notice, no incentive for this period.
      let salary = salaryInput.prebuiltSalary
        ? { ...salaryInput.prebuiltSalary, hyiMonthly: 0, grandTotalMonthly: salaryInput.prebuiltSalary.grandTotalMonthly - salaryInput.prebuiltSalary.hyiMonthly }
        : computeSalaryStructure({ ...salaryInput, hasIncentive: false, incentivePercent: 0 })

      const grossMonthly   = salary.grandTotalMonthly
      const proratedSalary = isLwdMonth
        ? r2((grossMonthly / totalDays) * salaryDays)
        : grossMonthly
      const pfAmount  = isLwdMonth ? r2((salary.employeePfMonthly / totalDays) * salaryDays) : salary.employeePfMonthly
      const esiAmount = isLwdMonth ? r2((computeEsi(salary.esiBase) / totalDays) * salaryDays) : computeEsi(salary.esiBase)
      const ptAmount  = await computePt(grossMonthly, employee.state || '')
      const tdsAmount = isLwdMonth ? r2((salaryInput.tdsMonthly / totalDays) * salaryDays) : salaryInput.tdsMonthly

      let lopDaysForCycle = 0
      for (const app of fnfRangeApps) {
        if (app.startDate < mStart || app.startDate > mEnd) continue
        if (app.isLop) {
          lopDaysForCycle += Number(app.lopDays)
        } else if (app.createdAt >= resignationDate) {
          lopDaysForCycle += Number(app.totalDays)
        }
      }
      const lopAmount = computeLop(grossMonthly, totalDays, lopDaysForCycle)

      cycles.push({
        cycleLabel:     monthLabel(mStart),
        cycleStart:     mStart,
        cycleEnd:       mEnd,
        totalDays,
        salaryDays,
        grossMonthly:   grossMonthly,
        proratedSalary,
        pfAmount,
        esiAmount,
        ptAmount,
        tdsAmount,
        lopDays:        lopDaysForCycle,
        lopAmount,
      })
    }

    cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1)
  }

  // ─── AGGREGATE ────────────────────────────────────────────────────────────
  const totalSalaryDays    = cycles.reduce((s, c) => s + c.salaryDays, 0)
  const totalProratedSalary = r2(cycles.reduce((s, c) => s + c.proratedSalary, 0))
  const totalPf            = r2(cycles.reduce((s, c) => s + c.pfAmount, 0))
  const totalEsi           = r2(cycles.reduce((s, c) => s + c.esiAmount, 0))
  const totalPt            = r2(cycles.reduce((s, c) => s + c.ptAmount, 0))
  const totalTds           = r2(cycles.reduce((s, c) => s + c.tdsAmount, 0))
  const totalLopDays       = r2(cycles.reduce((s, c) => s + c.lopDays, 0))
  const totalLopAmount     = r2(cycles.reduce((s, c) => s + c.lopAmount, 0))

  // ─── LOAN OUTSTANDING ────────────────────────────────────────────────────
  const loanOutstanding = r2(
    (employee as any).loans.reduce((sum: number, loan: any) => sum + Number(loan.outstandingBalance), 0)
  )

  // ─── PENDING REIMBURSEMENTS ───────────────────────────────────────────────
  const openCycle = await prisma.payrollCycle.findFirst({
    where: { status: { in: ['DRAFT', 'CALCULATED'] } },
    orderBy: { cycleStart: 'desc' },
  })
  let pendingReimbursements = 0
  if (openCycle) {
    const reimbs = await prisma.reimbursement.aggregate({
      where: { cycleId: openCycle.id, employeeId },
      _sum: { amount: true },
    })
    pendingReimbursements = Number(reimbs._sum.amount || 0)
  }

  // ─── HYI RECOVERY ────────────────────────────────────────────────────────
  // Policy: ongoing (resignation) slab is entirely forfeited; if notice period
  // overlaps into the next slab, that overlap is also recovered. Previously
  // completed slabs are never touched. Since F&F always uses the actual LWD,
  // recovery = HYI for every month from the resignation slab's start through
  // the LWD month, inclusive — this matches all policy examples exactly.
  //
  // IMPORTANT: each month's rate is looked up historically via
  // getSalaryInputForDate(employeeId, thatMonth) — NOT a single flat rate as
  // of resignationDate. A mid-slab salary revision (e.g. effective April)
  // means Jan–Mar legitimately had a different HYI than Apr onwards; using
  // one flat rate for the whole slab silently overcharges/undercharges the
  // pre-revision months. hyiOverrides lets HR manually correct a month's
  // figure if the system's historical snapshot for that period is wrong.
  let hyiRecovery = 0
  const hyiRecoveryDetail: HyiRecoveryDetailRow[] = []

  const resignSlab     = getHyiSlab(resignationDate.getMonth())
  const slabStartMonth = resignSlab === 0 ? 0 : 6
  const cycleStartAbs  = resignationDate.getFullYear() * 12 + slabStartMonth
  const lwdAbs          = lwd.getFullYear() * 12 + lwd.getMonth()
  const recoveryMonths = lwdAbs - cycleStartAbs + 1

  // Still needed below for excess-leave valuation
  const salaryForHyi = await getSalaryInputForDate(employeeId, resignationDate)

  if (recoveryMonths > 0) {
    for (let i = 0; i < recoveryMonths; i++) {
      const abs = cycleStartAbs + i
      const d   = new Date(Math.floor(abs / 12), abs % 12, 1)
      const monthKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`

      const monthSalaryInput = await getSalaryInputForDate(employeeId, d)
      const systemAmount = monthSalaryInput.prebuiltSalary
        ? monthSalaryInput.prebuiltSalary.hyiMonthly
        : computeSalaryStructure(monthSalaryInput).hyiMonthly

      const isOverridden = hyiOverrides ? hyiOverrides[monthKey] !== undefined : false
      const amount = isOverridden ? Number(hyiOverrides![monthKey]) : systemAmount

      hyiRecoveryDetail.push({
        monthLabel: monthLabel(d),
        monthKey,
        amount:       r2(amount),
        systemAmount: r2(systemAmount),
        isOverridden,
      })
      hyiRecovery += amount
    }
    hyiRecovery = r2(hyiRecovery)
  }

  // ─── LEAVE PRORATION RECOVERY ─────────────────────────────────────────────
  // Annual entitlement (Sick 4 / Casual 8 / Planned 8) is granted in full each
  // Jan rollover. An employee who exits mid-year only "earns" a prorated share
  // (months Jan → resignation month, inclusive). Each leave was approved
  // against the FULL annual balance, so no single approval ever looked like
  // LOP — but if cumulative usedDays this year exceeds the prorated share,
  // the excess is unearned and recovered here. (No encashment for unused leave.)
  const proYear         = resignationDate.getFullYear()
  const monthsElapsed   = resignationDate.getMonth() + 1 // Jan=1 ... Dec=12
  const entitlements    = await prisma.leaveEntitlement.findMany({
    where: { employeeId, year: proYear },
  })

  const resignMonthStart = monthStart(resignationDate)
  const resignMonthEnd   = monthEnd(resignationDate)
  const resignMonthTotalDays = daysBetween(resignMonthStart, resignMonthEnd)
  const grossForExcess = salaryForHyi.prebuiltSalary
    ? salaryForHyi.prebuiltSalary.grandTotalMonthly
    : computeSalaryStructure(salaryForHyi).grandTotalMonthly

  let excessLeaveDays = 0
  let excessLeaveAmount = 0
  const excessLeaveDetail: ExcessLeaveDetailRow[] = []
  for (const ent of entitlements) {
    const proratedAllowed = (Number(ent.totalDays) * monthsElapsed) / 12
    const usedSoFar        = Number(ent.usedDays)
    const excess           = usedSoFar > proratedAllowed ? usedSoFar - proratedAllowed : 0
    const excessAmount     = excess > 0 ? computeLop(grossForExcess, resignMonthTotalDays, excess) : 0
    excessLeaveDetail.push({
      leaveKind:         ent.leaveKind,
      annualEntitlement: Number(ent.totalDays),
      monthsElapsed,
      proratedAllowed:   r2(proratedAllowed),
      usedDays:          usedSoFar,
      excessDays:        r2(excess),
      excessAmount:      r2(excessAmount),
    })
    excessLeaveDays   += excess
    excessLeaveAmount += excessAmount
  }
  excessLeaveDays   = r2(excessLeaveDays)
  excessLeaveAmount = r2(excessLeaveAmount)

  // ─── NOTICE PERIOD SPAN (display metric — resignation date → LWD, inclusive) ──
  // Distinct from F&F's own salaryDays/cycles, which only cover the months F&F
  // itself pays out (resignation month is paid separately via normal payroll).
  const noticePeriodDays   = daysBetween(resignationDate, lwd)
  const noticePeriodMonths =
    (lwd.getFullYear() * 12 + lwd.getMonth()) -
    (resignationDate.getFullYear() * 12 + resignationDate.getMonth()) + 1

  // ─── TOTALS ────────────────────────────────────────────────────────────────
  const totalAdditions  = r2(totalProratedSalary + pendingReimbursements)
  const totalDeductions = r2(totalPf + totalEsi + totalPt + totalTds + loanOutstanding + hyiRecovery + totalLopAmount + excessLeaveAmount)
  const netPayable      = r2(totalAdditions - totalDeductions)
  const isNegative      = netPayable < 0

  // ─── BREAKDOWN ────────────────────────────────────────────────────────────
  const breakdown: { label: string; amount: number; type: 'addition' | 'deduction' }[] = []

  if (cycles.length === 1) {
    const c = cycles[0]
    const label = c.salaryDays === c.totalDays
      ? `Salary (${c.cycleLabel} — full month)`
      : `Salary ${c.cycleLabel} (${c.salaryDays} of ${c.totalDays} days)`
    breakdown.push({ label, amount: totalProratedSalary, type: 'addition' })
  } else {
    cycles.forEach((c, i) => {
      const isLast = i === cycles.length - 1
      const label = isLast && c.salaryDays !== c.totalDays
        ? `Salary ${c.cycleLabel} (${c.salaryDays} of ${c.totalDays} days)`
        : `Salary ${c.cycleLabel} (full month)`
      breakdown.push({ label, amount: c.proratedSalary, type: 'addition' })
    })
  }

  if (pendingReimbursements > 0) breakdown.push({ label: 'Pending Reimbursements', amount: pendingReimbursements, type: 'addition' })

  breakdown.push({ label: 'Employee PF',        amount: totalPf,  type: 'deduction' })
  if (totalEsi > 0)           breakdown.push({ label: 'ESI',               amount: totalEsi,  type: 'deduction' })
  if (totalPt  > 0)           breakdown.push({ label: 'Professional Tax',  amount: totalPt,   type: 'deduction' })
  if (totalTds > 0)           breakdown.push({ label: 'TDS',               amount: totalTds,  type: 'deduction' })
  if (loanOutstanding > 0)    breakdown.push({ label: 'Loan Outstanding',  amount: loanOutstanding, type: 'deduction' })
  if (hyiRecovery > 0)        breakdown.push({ label: 'HYI Recovery',      amount: hyiRecovery, type: 'deduction' })
  if (totalLopAmount > 0)     breakdown.push({ label: `LOP (${totalLopDays} days)`, amount: totalLopAmount, type: 'deduction' })
  if (excessLeaveAmount > 0)  breakdown.push({ label: `Excess Leave Recovery (${excessLeaveDays} days)`, amount: excessLeaveAmount, type: 'deduction' })

  return {
    employeeId,
    employeeName:          employee.name,
    resignationDate,
    lastWorkingDay:        lwd,
    cycleStart:            cycles[0]?.cycleStart || resignationDate,
    salaryDays:            totalSalaryDays,
    totalCycleDays:        cycles.reduce((s, c) => s + c.totalDays, 0),
    noticePeriodDays,
    noticePeriodMonths,
    grossSalary:           cycles[0]?.grossMonthly || 0,
    proratedSalary:        totalProratedSalary,
    pendingReimbursements,
    pfAmount:              totalPf,
    esiAmount:             totalEsi,
    ptAmount:              totalPt,
    tdsAmount:             totalTds,
    loanOutstanding,
    otherDeductions:       0,
    hyiRecovery,
    hyiRecoveryDetail,
    lopDays:               totalLopDays,
    lopAmount:             totalLopAmount,
    excessLeaveDays,
    excessLeaveAmount,
    excessLeaveDetail,
    totalAdditions,
    totalDeductions,
    netPayable,
    isNegative,
    cycles,
    breakdown,
  }
}
