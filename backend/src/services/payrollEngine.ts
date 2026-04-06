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

const TRANSPORT_DEFAULT_PCT = 0.04 // 4% of Basic monthly
const FBP_DEFAULT_PCT       = 0.04 // 4% of Basic monthly
const BONUS_MONTH           = 3    // March

// ESI/PF defaults — overridden by SystemConfig at runtime
const DEFAULT_ESI_EMPLOYEE_RATE = 0.0075  // 0.75%
const DEFAULT_ESI_EMPLOYER_RATE = 0.0325  // 3.25%
const DEFAULT_ESI_THRESHOLD     = 21000   // ₹21,000 gross - HYI

// ─── LOAD ESI CONFIG FROM DB ─────────────────────────────────────────────────

async function getEsiConfig() {
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

  const annualBonus      = hasIncentive ? r2(annualCtc * incentivePercent / 100) : 0
  const basicAnnual      = r2(annualCtc * basicPercent / 100)
  const basicMonthly     = r2(basicAnnual / 12)

  // Employer PF — 12% of Basic, no cap (outside CTC, informational)
  const employerPfMonthly = r2(basicMonthly * 0.12)
  const employerPfAnnual  = r2(employerPfMonthly * 12)

  // Grand Total = CTC - Employer PF - Bonus - Mediclaim
  const grandTotalMonthly = r2((annualCtc - annualBonus - employerPfAnnual - mediclaim) / 12)

  const hraAnnual        = r2(annualCtc * hraPercent / 100)
  const hraMonthly       = r2(hraAnnual / 12)

  const transportMonthly = input.transportMonthly != null
    ? r2(input.transportMonthly)
    : r2(basicMonthly * TRANSPORT_DEFAULT_PCT)

  const fbpMonthly = input.fbpMonthly != null
    ? r2(input.fbpMonthly)
    : r2(basicMonthly * FBP_DEFAULT_PCT)

  const hyiMonthly = r2(grandTotalMonthly - basicMonthly - hraMonthly - transportMonthly - fbpMonthly)

  // Employee PF — 12% of Basic, no cap
  const employeePfMonthly = r2(basicMonthly * 0.12)

  // ESI — base = Gross - HYI (HYI excluded per govt rules)
  const esiBase   = r2(grandTotalMonthly - hyiMonthly)
  const esiApplies = esiBase <= esiConfig.threshold
  const employeeEsiMonthly = esiApplies ? r2(esiBase * esiConfig.employeeRate) : 0
  const employerEsiMonthly = esiApplies ? r2(esiBase * esiConfig.employerRate) : 0
  const employerEsiAnnual  = r2(employerEsiMonthly * 12)

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

export async function computeLoanDeduction(employeeId: string): Promise<number> {
  const loans = await prisma.loan.findMany({ where: { employeeId, status: 'ACTIVE' } })
  let total = 0
  for (const loan of loans) {
    total += Math.min(Number(loan.emiAmount), Number(loan.outstandingBalance))
  }
  return r2(total)
}

// ─── IS BONUS MONTH (March = month 3) ────────────────────────────────────────

export function isBonusMonth(payrollMonth: string): boolean {
  // payrollMonth format: "2026-03"
  const month = parseInt(payrollMonth.split('-')[1])
  return month === BONUS_MONTH
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
}): Promise<PayrollCalculation> {

  const esiConfig  = await getEsiConfig()
  const salary     = computeSalaryStructure(params.salaryInput, esiConfig)
  const proration  = computeProration(
    salary.grandTotalMonthly,
    params.cycleStart,
    params.cycleEnd,
    params.joiningDate,
    params.lastWorkingDay
  )

  const lopAmount       = computeLop(salary.grandTotalMonthly, proration.totalDays, params.lopDays)
  const esi             = salary.employeeEsiMonthly
  const pt              = await computePt(salary.grandTotalMonthly, params.state)
  const loanDeduction   = await computeLoanDeduction(params.employeeId)
  const bonusMonth      = isBonusMonth(params.payrollMonth)
  const annualBonus     = bonusMonth ? salary.annualBonus : 0

  const deductions: DeductionResult = {
    pf:                salary.employeePfMonthly,  // 12% of Basic, uncapped
    esi,  // 0.75% of (Gross - HYI) if applicable
    pt,
    tds:               params.tdsMonthly,
    lop:               lopAmount,
    incentiveRecovery: 0,  // Only applies on F&F
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

export { r2 }
