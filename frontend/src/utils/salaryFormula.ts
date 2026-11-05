// ─── UNIFIED SALARY FORMULA (New ESIC rules) ─────────────────────────────
// Rules:
//  - Employer PF & Employer ESI are INSIDE CTC
//  - Employee PF & Employee ESI are INSIDE Gross (deducted later)
//  - ESI applies when Basic < ESI_THRESHOLD (default ₹21,000)
//  - PF = 12% of Basic, capped at rate × wage ceiling (date-aware, from config)
//  - Incentive is inside CTC, paid annually in March
//  - Grand Monthly = (CTC − Mediclaim) ÷ 12 − Bonus/12 − EmployerPF − EmployerESI
//  - Transport = Gross × 2%, FBP = Gross × 2%, HYI = Gross − Basic − HRA − Transport − FBP

export const DEFAULT_PF_RATE               = 0.12
export const DEFAULT_PF_WAGE_CEILING       = 25000
export const DEFAULT_PF_WAGE_CEILING_PREV  = 15000
export const DEFAULT_PF_EFFECTIVE_FROM     = '2026-10-01'
export const DEFAULT_PF_CAP = Math.round(DEFAULT_PF_RATE * DEFAULT_PF_WAGE_CEILING)
/** @deprecated use pfCapFromConfig */
export const EMPLOYER_PF_CAP = DEFAULT_PF_CAP
/** @deprecated use pfCapFromConfig */
export const EMPLOYEE_PF_CAP = DEFAULT_PF_CAP

/** Monthly PF cap (₹) from system config for a given date (YYYY-MM-DD or Date). */
export function pfCapFromConfig(sysConfig: Record<string, any> | undefined, on: Date | string = new Date()): number {
  const num = (k: string, d: number) => {
    const v = Number(sysConfig?.[k]); return sysConfig?.[k] != null && sysConfig?.[k] !== '' && !isNaN(v) && v > 0 ? v : d
  }
  const rate    = num('PF_RATE', DEFAULT_PF_RATE)
  const ceiling = num('PF_WAGE_CEILING', DEFAULT_PF_WAGE_CEILING)
  const prev    = num('PF_WAGE_CEILING_PREV', DEFAULT_PF_WAGE_CEILING_PREV)
  const eff     = String(sysConfig?.PF_CEILING_EFFECTIVE_FROM || DEFAULT_PF_EFFECTIVE_FROM)
  const onStr   = typeof on === 'string' ? on.slice(0, 10) : on.toISOString().slice(0, 10)
  return Math.round(rate * (onStr >= eff ? ceiling : prev))
}
export const DEFAULT_ESI_EMPLOYEE_RATE = 0.0075
export const DEFAULT_ESI_EMPLOYER_RATE = 0.0325
export const DEFAULT_ESI_THRESHOLD     = 21000
export const TRANSPORT_PCT_OF_GROSS    = 0.02
export const FBP_PCT_OF_GROSS          = 0.02

export const ri = (n: number) => Math.round(n)
export const r2 = (n: number) => Math.round(n * 100) / 100

export interface SalaryFormulaInput {
  ctc: number
  basicPct: number
  hraPct: number
  incentivePct: number
  hasIncentive: boolean
  mediclaim: number
  bonusAmountOverride?: number | null   // annualized bonus ₹ (overrides CTC × incentivePct)
  hraOfBasic?: boolean                  // true = hraPct is % of Basic
  pfCap?: number                        // monthly PF cap ₹
  transportOverride?: number | null
  fbpOverride?: number | null
  esiEmployeeRate?: number
  esiEmployerRate?: number
  esiThreshold?: number
}

export interface SalaryFormulaOutput {
  basic: number
  hra: number
  transport: number
  fbp: number
  hyi: number
  grandTotal: number         // Gross Monthly
  employerPf: number         // monthly, inside CTC
  employerEsi: number        // monthly, inside CTC
  employeePf: number         // monthly, inside Gross (deducted)
  employeeEsi: number        // monthly, inside Gross (deducted)
  annualBonus: number        // annual amount
  esiApplies: boolean
  netEstimate: number        // grandTotal - employeePf - employeeEsi
}

export function computeSalary(input: SalaryFormulaInput): SalaryFormulaOutput {
  const {
    ctc, basicPct, hraPct, incentivePct, hasIncentive, mediclaim,
    transportOverride = null, fbpOverride = null,
    bonusAmountOverride = null, hraOfBasic = false, pfCap = DEFAULT_PF_CAP,
    esiEmployeeRate = DEFAULT_ESI_EMPLOYEE_RATE,
    esiEmployerRate = DEFAULT_ESI_EMPLOYER_RATE,
    esiThreshold    = DEFAULT_ESI_THRESHOLD,
  } = input

  const annualBonus = hasIncentive
    ? (bonusAmountOverride != null ? ri(bonusAmountOverride) : ri(ctc * incentivePct / 100))
    : 0
  const basic = ri(ctc * basicPct / 100 / 12)
  const hra   = hraOfBasic ? ri(basic * hraPct / 100) : ri(ctc * hraPct / 100 / 12)

  // Employer contributions — inside CTC
  const employerPf  = Math.min(ri(basic * DEFAULT_PF_RATE), pfCap)
  const esiApplies  = basic > 0 && basic < esiThreshold
  const employerEsi = esiApplies ? ri(basic * esiEmployerRate) : 0

  // Gross = (CTC − mediclaim) / 12 − bonus/12 − employer PF − employer ESI
  const annualBonusMonthly = hasIncentive ? ri(annualBonus / 12) : 0
  const grandTotal = ri((ctc - mediclaim) / 12 - annualBonusMonthly - employerPf - employerEsi)

  const transport = transportOverride != null ? ri(transportOverride) : ri(grandTotal * TRANSPORT_PCT_OF_GROSS)
  const fbp       = fbpOverride       != null ? ri(fbpOverride)       : ri(grandTotal * FBP_PCT_OF_GROSS)
  const hyi       = ri(grandTotal - basic - hra - transport - fbp)

  // Employee deductions — inside Gross
  const employeePf  = Math.min(ri(basic * DEFAULT_PF_RATE), pfCap)
  const employeeEsi = esiApplies ? ri(basic * esiEmployeeRate) : 0

  const netEstimate = r2(grandTotal - employeePf - employeeEsi)

  return {
    basic, hra, transport, fbp, hyi, grandTotal,
    employerPf, employerEsi, employeePf, employeeEsi,
    annualBonus, esiApplies, netEstimate,
  }
}
