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
  annualBonus:      number  // = CTC × incentivePercent (paid March)
  // Monthly components
  basicMonthly:     number
  hraMonthly:       number
  transportMonthly: number
  fbpMonthly:       number
  hyiMonthly:       number  // balancing figure
  grandTotalMonthly: number // gross payable monthly
  // Computed annual equivalents
  basicAnnual:      number
  hraAnnual:        number
  employerPfAnnual: number
  // Deductions
  employeePfMonthly: number
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

const EMPLOYEE_PF_CAP = 1800       // Max employee/employer PF = ₹1,800/month = ₹21,600/year
const ESI_THRESHOLD = 21000        // ESI only if gross ≤ this
const ESI_RATE = 0.0075            // 0.75%
const TRANSPORT_DEFAULT_PCT = 0.04 // 4% of Basic monthly
const FBP_DEFAULT_PCT = 0.04       // 4% of Basic monthly
const BONUS_MONTH = 3              // March (0-indexed = 2, but we store 1-indexed = 3)

// ─── CORE SALARY CALCULATOR ──────────────────────────────────────────────────

export function computeSalaryStructure(input: SalaryInput): SalaryStructure {
  const {
    annualCtc,
    basicPercent,
    hraPercent,
    mediclaim,
    hasIncentive,
    incentivePercent,
  } = input

  // Annual bonus = CTC × incentive% (if applicable)
  const annualBonus = hasIncentive ? r2(annualCtc * incentivePercent / 100) : 0

  // Basic = CTC × basicPercent%
  const basicAnnual   = r2(annualCtc * basicPercent / 100)
  const basicMonthly  = r2(basicAnnual / 12)

  // Employer PF = min(Basic × 12%, 1800) per month — same rule as employee PF
  const employerPfMonthly = Math.min(r2(basicMonthly * 0.12), EMPLOYEE_PF_CAP)
  const employerPfAnnual  = r2(employerPfMonthly * 12)

  // Grand Total Annual = CTC - Annual Bonus - Employer PF - Mediclaim
  const grandTotalAnnual = annualCtc - annualBonus - employerPfAnnual - mediclaim
  const grandTotalMonthly = r2(grandTotalAnnual / 12)

  // HRA = CTC × hraPercent%
  const hraAnnual    = r2(annualCtc * hraPercent / 100)
  const hraMonthly   = r2(hraAnnual / 12)

  // Transport & FBP — use input if provided, else formula
  const transportMonthly = input.transportMonthly !== null && input.transportMonthly !== undefined
    ? r2(input.transportMonthly)
    : r2(basicMonthly * TRANSPORT_DEFAULT_PCT)

  const fbpMonthly = input.fbpMonthly !== null && input.fbpMonthly !== undefined
    ? r2(input.fbpMonthly)
    : r2(basicMonthly * FBP_DEFAULT_PCT)

  // HYI = Grand Total - Basic - HRA - Transport - FBP (balancing figure)
  const hyiMonthly = r2(grandTotalMonthly - basicMonthly - hraMonthly - transportMonthly - fbpMonthly)

  // Employee PF = min(Basic × 12%, 1800) — mirrors employer PF rule
  const employeePfMonthly = Math.min(r2(basicMonthly * 0.12), EMPLOYEE_PF_CAP)

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
    employerPfAnnual,
    employeePfMonthly,
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

export function computeEsi(grandTotalMonthly: number): number {
  if (grandTotalMonthly > ESI_THRESHOLD) return 0
  return r2(grandTotalMonthly * ESI_RATE)
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

  const salary     = computeSalaryStructure(params.salaryInput)
  const proration  = computeProration(
    salary.grandTotalMonthly,
    params.cycleStart,
    params.cycleEnd,
    params.joiningDate,
    params.lastWorkingDay
  )

  const lopAmount       = computeLop(salary.grandTotalMonthly, proration.totalDays, params.lopDays)
  const esi             = computeEsi(salary.grandTotalMonthly)
  const pt              = await computePt(salary.grandTotalMonthly, params.state)
  const loanDeduction   = await computeLoanDeduction(params.employeeId)
  const bonusMonth      = isBonusMonth(params.payrollMonth)
  const annualBonus     = bonusMonth ? salary.annualBonus : 0

  const deductions: DeductionResult = {
    pf:                salary.employeePfMonthly,
    esi,
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

export function previewSalaryBreakdown(input: SalaryInput): {
  components: { label: string; monthly: number; annual: number; editable: boolean }[]
  grossMonthly: number
  annualBonus: number
  employerPf: number
  totalCtc: number
  employeePf: number
  netEstimate: number
} {
  const s = computeSalaryStructure(input)

  const components = [
    { label: 'Basic',          monthly: s.basicMonthly,     annual: s.basicAnnual,           editable: false },
    { label: 'HRA',            monthly: s.hraMonthly,       annual: s.hraAnnual,             editable: false },
    { label: 'Transportation', monthly: s.transportMonthly, annual: s.transportMonthly * 12, editable: true  },
    { label: 'FBP',            monthly: s.fbpMonthly,       annual: s.fbpMonthly * 12,       editable: true  },
    { label: 'HYI',            monthly: s.hyiMonthly,       annual: s.hyiMonthly * 12,       editable: false },
  ]

  return {
    components,
    grossMonthly:  s.grandTotalMonthly,
    annualBonus:   s.annualBonus,
    employerPf:    s.employerPfAnnual,
    totalCtc:      s.annualCtc,
    employeePf:    s.employeePfMonthly,
    netEstimate:   r2(s.grandTotalMonthly - s.employeePfMonthly),
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
