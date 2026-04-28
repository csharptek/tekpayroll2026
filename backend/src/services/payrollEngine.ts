import { prisma } from '../utils/prisma'

// ─── TYPES ───────────────────────────────────────────────────────────────────

export interface SalaryInput {
  annualCtc:       number
  basicPercent:    number   // default 45
  hraPercent:      number   // default 35
  transportMonthly: number | null  // null = use formula (4% of Basic)
  fbpMonthly:      number | null   // null = use formula (4% of Basic)
  mediclaim:       number   // annual
  hasIncentive:    boolean
  incentivePercent: number  // default 12
}

export interface SalaryStructure {
  // Annual
  annualCtc:        number
  annualBonus:      number
  // Monthly components
  basicMonthly:     number
  hraMonthly:       number
  transportMonthly: number
  fbpMonthly:       number
  hyiMonthly:       number
  grandTotalMonthly: number
  // Computed annual equivalents
  basicAnnual:      number
  hraAnnual:        number
  // Employer contributions (outside CTC — informational)
  employerPfMonthly:  number
  employerPfAnnual:   number
  employerEsiMonthly: number  // 0 if ESI not applicable
  employerEsiAnnual:  number
  // ESI info
  esiBase:    number   // Gross - HYI
  esiApplies: boolean  // true if esiBase <= threshold
  // Employee deductions
  employeePfMonthly:  number
  employeeEsiMonthly: number  // 0 if ESI not applicable
}

export interface ProrationResult {
  totalDays:    number
  payableDays:  number
  isProrated:   boolean
  proratedGross: number
}

export interface DeductionResult {
  pf:                number
  esi:               number
  pt:                number
  tds:               number
  lop:               number
  incentiveRecovery: number
  loanDeduction:     number
}

export interface PayrollCalculation {
  salary:         SalaryStructure
  proration:      ProrationResult
  isBonusMonth:   boolean
  annualBonus:    number
  reimbursements: number
  deductions:     DeductionResult
  netSalary:      number
}

// ─── CONSTANTS ───────────────────────────────────────────────────────────────

const TRANSPORT_DEFAULT_PCT = 0.02 // 2% of Grand Monthly Total
const FBP_DEFAULT_PCT       = 0.02 // 2% of Grand Monthly Total
const BONUS_MONTH           = 3    // March

// ESI/PF defaults — overridden by SystemConfig at runtime
const DEFAULT_ESI_EMPLOYEE_RATE = 0.0075  // 0.75%
const DEFAULT_ESI_EMPLOYER_RATE = 0.0325  // 3.25%
const DEFAULT_ESI_THRESHOLD     = 21000   // ₹21,000 gross - HYI

// ─── LOAD ESI CONFIG FROM DB ─────────────────────────────────────────────────

export async function getEsiConfig() {
  const rows = await prisma.systemConfig.findMany({
    where: { key: { in: ['ESI_EMPLOYEE_RATE', 'ESI_EMPLOYER_RATE', 'ESI_THRESHOLD'] } },
  })
  const map = Object.fromEntries(rows.map(r => [r.key, Number(r.value)]))
  return {
    employeeRate: map['ESI_EMPLOYEE_RATE'] ?? DEFAULT_ESI_EMPLOYEE_RATE,
    employerRate: map['ESI_EMPLOYER_RATE'] ?? DEFAULT_ESI_EMPLOYER_RATE,
    threshold:    map['ESI_THRESHOLD']     ?? DEFAULT_ESI_THRESHOLD,
  }
}

// ─── CORE SALARY CALCULATOR ──────────────────────────────────────────────────

export function computeSalaryStructure(
  input: SalaryInput,
  esiConfig = { employeeRate: DEFAULT_ESI_EMPLOYEE_RATE, employerRate: DEFAULT_ESI_EMPLOYER_RATE, threshold: DEFAULT_ESI_THRESHOLD }
): SalaryStructure {
  const { annualCtc, basicPercent, hraPercent, mediclaim, hasIncentive, incentivePercent } = input

  const annualBonus      = hasIncentive ? ri(annualCtc * incentivePercent / 100) : 0
  const basicAnnual      = ri(annualCtc * basicPercent / 100)
  const basicMonthly     = ri(basicAnnual / 12)

  // ── NEW ESIC RULE: ESI applies when Basic < threshold ────────────────────
  const esiApplies = basicMonthly > 0 && basicMonthly < esiConfig.threshold

  // Employer PF (inside CTC, capped at ₹1,800/mo)
  const EMPLOYER_PF_CTC_CAP    = 1800
  const employerPfInCtcMonthly = Math.min(ri(basicMonthly * 0.12), EMPLOYER_PF_CTC_CAP)
  const employerPfInCtcAnnual  = employerPfInCtcMonthly * 12

  // Employer ESI (inside CTC, computed from Basic)
  const employerEsiInCtcMonthly = esiApplies ? ri(basicMonthly * esiConfig.employerRate) : 0
  const employerEsiInCtcAnnual  = employerEsiInCtcMonthly * 12

  // Grand Total = (CTC − Mediclaim) / 12 − Bonus/12 − Employer PF − Employer ESI
  const annualBonusMonthly = hasIncentive ? ri(annualBonus / 12) : 0
  const grandTotalMonthly = ri((annualCtc - mediclaim) / 12 - annualBonusMonthly - employerPfInCtcMonthly - employerEsiInCtcMonthly)

  // Uncapped actual employer PF (shown informally)
  const employerPfMonthly = ri(basicMonthly * 0.12)
  const employerPfAnnual  = employerPfMonthly * 12

  const hraAnnual        = ri(annualCtc * hraPercent / 100)
  const hraMonthly       = ri(hraAnnual / 12)

  const transportMonthly = input.transportMonthly != null
    ? Math.round(input.transportMonthly)
    : ri(grandTotalMonthly * TRANSPORT_DEFAULT_PCT)

  const fbpMonthly = input.fbpMonthly != null
    ? Math.round(input.fbpMonthly)
    : ri(grandTotalMonthly * FBP_DEFAULT_PCT)

  const hyiMonthly = ri(grandTotalMonthly - basicMonthly - hraMonthly - transportMonthly - fbpMonthly)

  // Employee PF deduction — capped at ₹1,800/mo
  const employeePfMonthly = Math.min(ri(basicMonthly * 0.12), 1800)

  // Employee ESI — base = Basic (new rule)
  const employeeEsiMonthly = esiApplies ? ri(basicMonthly * esiConfig.employeeRate) : 0
  const employerEsiMonthly = employerEsiInCtcMonthly
  const employerEsiAnnual  = employerEsiInCtcAnnual
  const esiBase            = basicMonthly  // retained for backward compat; now represents ESI base = Basic

  return {
    annualCtc,
    annualBonus,
    basicMonthly,
    hraMonthly,
    transportMonthly,
    fbpMonthly,
    hyiMonthly,
    grandTotalMonthly,
    basicAnnual,
    hraAnnual,
    employerPfMonthly,
    employerPfAnnual,
    employerEsiMonthly,
    employerEsiAnnual,
    esiBase,
    esiApplies,
    employeePfMonthly,
    employeeEsiMonthly,
  }
}

// ─── PRORATION ───────────────────────────────────────────────────────────────

export function computeProration(
  grandTotalMonthly: number,
  cycleStart: Date,
  cycleEnd:   Date,
  joiningDate?:     Date | null,
  lastWorkingDay?:  Date | null
): ProrationResult {
  const totalDays = daysBetween(cycleStart, cycleEnd)
  let payableDays = totalDays
  let isProrated  = false

  if (joiningDate && joiningDate > cycleStart && joiningDate <= cycleEnd) {
    payableDays = daysBetween(joiningDate, cycleEnd)
    isProrated  = true
  }

  if (lastWorkingDay && lastWorkingDay >= cycleStart && lastWorkingDay < cycleEnd) {
    payableDays = daysBetween(cycleStart, lastWorkingDay)
    isProrated  = true
  }

  const proratedGross = r2((grandTotalMonthly / totalDays) * payableDays)
  return { totalDays, payableDays, isProrated, proratedGross }
}

// ─── LOP ─────────────────────────────────────────────────────────────────────

export function computeLop(grandTotalMonthly: number, totalDays: number, lopDays: number): number {
  if (lopDays <= 0) return 0
  return r2((grandTotalMonthly / totalDays) * lopDays)
}

// ─── ESI ─────────────────────────────────────────────────────────────────────
// ESI is now computed inside computeSalaryStructure using esiBase = Gross - HYI
// This function kept for backward compat but delegates to salary structure
export function computeEsi(esiBase: number, employeeRate = DEFAULT_ESI_EMPLOYEE_RATE, threshold = DEFAULT_ESI_THRESHOLD): number {
  if (esiBase > threshold) return 0
  return r2(esiBase * employeeRate)
}

// ─── PROFESSIONAL TAX ────────────────────────────────────────────────────────

export async function computePt(grandTotalMonthly: number, state: string): Promise<number> {
  if (!state) return 0
  const slab = await prisma.ptSlab.findFirst({
    where: {
      state: { equals: state, mode: 'insensitive' },
      minSalary: { lte: grandTotalMonthly },
      OR: [{ maxSalary: null }, { maxSalary: { gte: grandTotalMonthly } }],
    },
    orderBy: { minSalary: 'desc' },
  })
  return slab ? Number(slab.ptAmount) : 0
}

// ─── LOAN DEDUCTION ──────────────────────────────────────────────────────────

/**
 * Returns loan deduction for a specific payroll month based on the schedule
 * (PENDING entries only). Paused/deducted entries are skipped.
 */
export async function computeLoanDeduction(employeeId: string, payrollMonth?: string): Promise<number> {
  if (!payrollMonth) {
    // Fallback for callers that don't pass month — legacy behaviour (flat EMI sum for ACTIVE loans)
    const loans = await prisma.loan.findMany({ where: { employeeId, status: 'ACTIVE' } })
    let total = 0
    for (const loan of loans) {
      total += Math.min(Number(loan.emiAmount), Number(loan.outstandingBalance))
    }
    return r2(total)
  }

  // Schedule-driven: sum PENDING entries for this month across all of the
  // employee's ACTIVE loans, capped at each loan's outstanding balance.
  const entries = await prisma.loanSchedule.findMany({
    where: {
      cycleMonth: payrollMonth,
      status:     'PENDING',
      loan:       { employeeId, status: 'ACTIVE' },
    },
    include: { loan: true },
  })

  let total = 0
  for (const e of entries) {
    total += Math.min(Number(e.plannedAmount), Number(e.loan.outstandingBalance))
  }
  return r2(total)
}

/**
 * Called after a payroll entry is committed — marks the month's schedule rows
 * as DEDUCTED, increments loan.totalRepaid, decrements outstandingBalance,
 * and auto-CLOSES the loan if balance hits zero.
 */
export async function applyLoanDeductionToSchedule(opts: {
  employeeId:   string
  payrollMonth: string
  entryId:      string
}): Promise<void> {
  const entries = await prisma.loanSchedule.findMany({
    where: {
      cycleMonth: opts.payrollMonth,
      status:     'PENDING',
      loan:       { employeeId: opts.employeeId, status: 'ACTIVE' },
    },
    include: { loan: true },
  })

  for (const e of entries) {
    const outstanding = Number(e.loan.outstandingBalance)
    if (outstanding <= 0) continue
    const applied = Math.min(Number(e.plannedAmount), outstanding)

    await prisma.$transaction(async (tx) => {
      await tx.loanSchedule.update({
        where: { id: e.id },
        data:  { status: 'DEDUCTED', actualAmount: applied },
      })
      const newOutstanding = Math.max(0, outstanding - applied)
      await tx.loan.update({
        where: { id: e.loanId },
        data: {
          totalRepaid:        { increment: applied },
          outstandingBalance: newOutstanding,
          ...(newOutstanding === 0 ? { status: 'CLOSED', closedAt: new Date(), closureNote: 'Auto-closed: fully repaid' } : {}),
        },
      })
      await tx.loanRepayment.create({
        data: {
          loanId:     e.loanId,
          entryId:    opts.entryId,
          amount:     applied,
          cycleMonth: opts.payrollMonth,
          paidOn:     new Date(),
        },
      })
    })
  }
}

// ─── IS BONUS MONTH (March = month 3) ────────────────────────────────────────

export function isBonusMonth(payrollMonth: string): boolean {
  // payrollMonth format: "2026-03"
  const month = parseInt(payrollMonth.split('-')[1])
  return month === BONUS_MONTH
}

// ─── SALARY REVISION LOOKUP ──────────────────────────────────────────────────
// Returns the salary input effective as of a given date.
// Queries SalaryStructureSnapshot (active) first — this is the source of truth set via the salary tab.
// Falls back to SalaryRevision → Employee fields for older employees without a snapshot.

export async function getSalaryInputForDate(
  employeeId: string,
  asOf: Date
): Promise<SalaryInput & { tdsMonthly: number; prebuiltSalary?: SalaryStructure }> {
  const emp = await prisma.employee.findUnique({ where: { id: employeeId } })
  if (!emp) throw new Error(`Employee ${employeeId} not found`)

  // ── 1. Prefer active SalaryStructureSnapshot ──────────────────────────────
  const snapshot = await prisma.salaryStructureSnapshot.findFirst({
    where: {
      employeeId,
      isActive: true,
      effectiveDate: { lte: asOf },
    },
    orderBy: { effectiveDate: 'desc' },
  })

  if (snapshot) {
    const annualCtc         = Number(snapshot.annualCtc)
    const basicMonthly      = Number(snapshot.basicMonthly)
    const hraMonthly        = Number(snapshot.hraMonthly)
    const transportMonthly  = Number(snapshot.transportMonthly)
    const fbpMonthly        = Number(snapshot.fbpMonthly)
    const hyiMonthly        = Number(snapshot.hyiMonthly)
    const grandTotalMonthly = Number(snapshot.grandTotalMonthly)
    const mediclaim         = Number(snapshot.mediclaim)
    const hasIncentive      = Boolean(snapshot.hasIncentive)
    const annualBonus       = Number(snapshot.annualBonus)
    const esiApplies        = Boolean(snapshot.esiApplies)

    // Read ALL deductions directly from snapshot — no recomputation
    const employeePfMonthly  = Number(snapshot.employeePfMonthly)
    const employerPfMonthly  = Number(snapshot.employerPfMonthly)
    const employerPfAnnual   = employerPfMonthly * 12
    const employeeEsiMonthly = Number(snapshot.employeeEsiMonthly)
    const employerEsiMonthly = Number(snapshot.employerEsiMonthly)
    const employerEsiAnnual  = employerEsiMonthly * 12
    const tdsMonthly         = Number(snapshot.tdsMonthly)

    // Build SalaryStructure directly from snapshot — zero recomputation
    const prebuiltSalary: SalaryStructure & { ptMonthly: number } = {
      annualCtc,
      annualBonus,
      basicMonthly,
      hraMonthly,
      transportMonthly,
      fbpMonthly,
      hyiMonthly,
      grandTotalMonthly,
      basicAnnual:       basicMonthly * 12,
      hraAnnual:         hraMonthly * 12,
      employerPfMonthly,
      employerPfAnnual,
      employerEsiMonthly,
      employerEsiAnnual,
      esiBase:           basicMonthly,
      esiApplies,
      employeePfMonthly,
      employeeEsiMonthly,
      ptMonthly:         Number(snapshot.ptMonthly),
    }

    // Also return a valid SalaryInput for callers that need it
    const annualBasic      = basicMonthly * 12
    const basicPercent     = annualCtc > 0 ? (annualBasic / annualCtc) * 100 : 45
    const hraPercent       = annualBasic > 0 ? (hraMonthly * 12 / annualBasic) * 100 : 35
    const incentivePercent = annualCtc > 0 && hasIncentive ? (annualBonus / annualCtc) * 100 : 12

    return {
      annualCtc,
      basicPercent,
      hraPercent,
      transportMonthly,
      fbpMonthly,
      mediclaim,
      hasIncentive,
      incentivePercent,
      tdsMonthly,
      prebuiltSalary,
    }
  }

  // ── 2. Fallback: SalaryRevision + Employee fields ─────────────────────────
  const revision = await prisma.salaryRevision.findFirst({
    where: {
      employeeId,
      effectiveFrom: { lte: asOf },
    },
    orderBy: { effectiveFrom: 'desc' },
  })

  const base = {
    annualCtc:        Number(emp.annualCtc),
    basicPercent:     Number((emp as any).basicPercent    ?? 45),
    hraPercent:       Number((emp as any).hraPercent      ?? 35),
    transportMonthly: (emp as any).transportMonthly != null ? Number((emp as any).transportMonthly) : null,
    fbpMonthly:       (emp as any).fbpMonthly       != null ? Number((emp as any).fbpMonthly)       : null,
    mediclaim:        Number((emp as any).mediclaim        ?? 0),
    hasIncentive:     Boolean((emp as any).hasIncentive),
    incentivePercent: Number((emp as any).incentivePercent ?? 12),
    tdsMonthly:       Number((emp as any).tdsMonthly       ?? 0),
  }

  if (!revision) return base

  return {
    ...base,
    annualCtc: Number(revision.newCtc),
  }
}

// ─── HYI HALF-YEAR SLAB HELPERS ──────────────────────────────────────────────
// Slabs: Jan–Jun (0) and Jul–Dec (1)

export function getHyiSlab(month: number): 0 | 1 {
  return month <= 5 ? 0 : 1  // month is 0-indexed (Date.getMonth())
}

// Returns true if HYI should be suppressed for this payroll month.
// Suppressed when: employee is ON_NOTICE and LWD falls within the same half-year slab.
export function shouldSuppressHyi(
  employeeStatus: string,
  lastWorkingDay: Date | null | undefined,
  cycleStart: Date
): boolean {
  if (employeeStatus !== 'ON_NOTICE') return false
  if (!lastWorkingDay) return false

  const cycleSlab = getHyiSlab(cycleStart.getMonth())
  const lwdSlab   = getHyiSlab(lastWorkingDay.getMonth())
  const sameYear  = lastWorkingDay.getFullYear() === cycleStart.getFullYear()

  // Suppress if LWD is in the same half-year slab as current cycle
  return sameYear && cycleSlab === lwdSlab
}

// ─── FULL CALCULATION ────────────────────────────────────────────────────────

export async function calculatePayrollForEmployee(params: {
  employeeId:      string
  salaryInput:     SalaryInput
  state:           string
  joiningDate:     Date
  lastWorkingDay?: Date | null
  resignationDate?: Date | null
  cycleStart:      Date
  cycleEnd:        Date
  payrollMonth:    string
  lopDays:         number
  tdsMonthly:      number
  reimbursements:  number
  employeeStatus?: string
  esiConfig?: Awaited<ReturnType<typeof getEsiConfig>>
  prebuiltSalary?: SalaryStructure
  isTrainee?:      boolean
  stipendMonthly?: number
}): Promise<PayrollCalculation> {

  const esiConfig  = params.esiConfig ?? await getEsiConfig()

  // ── TRAINEE: flat stipend, no CTC formula, no ESI/PF/PT ──────────────────
  if (params.isTrainee && params.stipendMonthly) {
    const stipend   = params.stipendMonthly
    const proration = computeProration(stipend, params.cycleStart, params.cycleEnd, params.joiningDate, params.lastWorkingDay)
    const lopAmount = computeLop(stipend, proration.totalDays, params.lopDays)
    const loanDeduction = await computeLoanDeduction(params.employeeId, params.payrollMonth)

    const deductions: DeductionResult = {
      pf: 0, esi: 0, pt: 0,
      tds:               params.tdsMonthly,
      lop:               lopAmount,
      incentiveRecovery: 0,
      loanDeduction,
    }

    const totalDeductions = deductions.tds + deductions.lop + deductions.loanDeduction
    const netSalary = r2(Math.max(0, proration.proratedGross + params.reimbursements - totalDeductions))

    // Build a minimal SalaryStructure so rest of system (payroll entry) works unchanged
    const traineeSalary: SalaryStructure = {
      annualCtc:          stipend * 12,
      annualBonus:        0,
      basicMonthly:       0,
      hraMonthly:         0,
      transportMonthly:   0,
      fbpMonthly:         0,
      hyiMonthly:         0,
      grandTotalMonthly:  stipend,
      basicAnnual:        0,
      hraAnnual:          0,
      employerPfMonthly:  0,
      employerPfAnnual:   0,
      employerEsiMonthly: 0,
      employerEsiAnnual:  0,
      esiBase:            0,
      esiApplies:         false,
      employeePfMonthly:  0,
      employeeEsiMonthly: 0,
    }

    return {
      salary:         traineeSalary,
      proration,
      isBonusMonth:   false,
      annualBonus:    0,
      reimbursements: params.reimbursements,
      deductions,
      netSalary,
    }
  }

  // Resolve salary input from revision history if not explicitly provided
  // Callers may pass salaryInput directly (legacy) or we derive it from revisions
  let salaryInput = params.salaryInput

  // HYI suppression: zero out hyiMonthly for ON_NOTICE employees in LWD slab
  const suppressHyi = shouldSuppressHyi(
    params.employeeStatus || 'ACTIVE',
    params.lastWorkingDay,
    params.cycleStart
  )

  let salary: SalaryStructure
  if (params.prebuiltSalary) {
    // Use snapshot values directly — no recomputation
    salary = suppressHyi
      ? { ...params.prebuiltSalary, hyiMonthly: 0, annualBonus: 0 }
      : params.prebuiltSalary
  } else {
    const salaryInputForCalc: SalaryInput = suppressHyi
      ? { ...salaryInput, hasIncentive: false, incentivePercent: 0 }
      : salaryInput
    salary = computeSalaryStructure(salaryInputForCalc, esiConfig)
  }

  const proration  = computeProration(
    salary.grandTotalMonthly,
    params.cycleStart,
    params.cycleEnd,
    params.joiningDate,
    params.lastWorkingDay
  )

  const lopAmount     = computeLop(salary.grandTotalMonthly, proration.totalDays, params.lopDays)
  const loanDeduction = await computeLoanDeduction(params.employeeId, params.payrollMonth)
  const bonusMonth    = isBonusMonth(params.payrollMonth)
  const annualBonus   = bonusMonth ? salary.annualBonus : 0

  // When snapshot present — PF, ESI, PT read directly from it. No recomputation.
  const pf  = salary.employeePfMonthly
  const esi = salary.employeeEsiMonthly
  const pt  = (params.prebuiltSalary as any)?.ptMonthly !== undefined
    ? (params.prebuiltSalary as any).ptMonthly
    : await computePt(salary.grandTotalMonthly, params.state)

  const deductions: DeductionResult = {
    pf,
    esi,
    pt,
    tds:               params.tdsMonthly,
    lop:               lopAmount,
    incentiveRecovery: 0,
    loanDeduction,
  }

  // Net = proratedGross + annualBonus (if March) + reimbursements - all deductions
  const totalDeductions = deductions.pf + deductions.esi + deductions.pt +
    deductions.tds + deductions.lop + deductions.incentiveRecovery + deductions.loanDeduction

  const netSalary = r2(Math.max(0,
    proration.proratedGross + annualBonus + params.reimbursements - totalDeductions
  ))

  return {
    salary,
    proration,
    isBonusMonth: bonusMonth,
    annualBonus,
    reimbursements: params.reimbursements,
    deductions,
    netSalary,
  }
}

// ─── PREVIEW BREAKDOWN (for UI — shows all components before saving) ──────────

export async function previewSalaryBreakdown(input: SalaryInput) {
  const esiConfig = await getEsiConfig()
  const s = computeSalaryStructure(input, esiConfig)

  const components = [
    { label: 'Basic',          monthly: s.basicMonthly,     annual: s.basicAnnual,           editable: false },
    { label: 'HRA',            monthly: s.hraMonthly,       annual: s.hraAnnual,             editable: false },
    { label: 'Transportation', monthly: s.transportMonthly, annual: s.transportMonthly * 12, editable: true  },
    { label: 'FBP',            monthly: s.fbpMonthly,       annual: s.fbpMonthly * 12,       editable: true  },
    { label: 'HYI',            monthly: s.hyiMonthly,       annual: s.hyiMonthly * 12,       editable: false },
  ]

  return {
    components,
    grossMonthly:        s.grandTotalMonthly,
    annualBonus:         s.annualBonus,
    // Employer contributions (outside CTC — informational)
    employerPf:          s.employerPfAnnual,
    employerPfMonthly:   s.employerPfMonthly,
    employerEsiMonthly:  s.employerEsiMonthly,
    employerEsiAnnual:   s.employerEsiAnnual,
    // ESI info
    esiBase:             s.esiBase,
    esiApplies:          s.esiApplies,
    esiThreshold:        esiConfig.threshold,
    // Employee deductions
    employeePf:          s.employeePfMonthly,
    employeeEsi:         s.employeeEsiMonthly,
    totalCtc:            s.annualCtc,
    netEstimate:         r2(s.grandTotalMonthly - s.employeePfMonthly - s.employeeEsiMonthly),
  }
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function daysBetween(start: Date, end: Date): number {
  return Math.round(Math.abs(end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1
}

function r2(n: number): number {
  return Math.round(n * 100) / 100
}

function ri(n: number): number {
  return Math.round(n)  // round to whole rupee
}

export { r2 }
