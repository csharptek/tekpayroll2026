import { Decimal } from '@prisma/client/runtime/library';
import { prisma } from '../utils/prisma';

// ─── TYPES ────────────────────────────────────────────────────────────────────

export interface SalaryStructure {
  annualCtc: number;
  monthlyCtc: number;
  basic: number;
  hra: number;
  allowances: number;
  grossSalary: number;
  monthlyIncentive: number;
}

export interface ProrationResult {
  totalDays: number;
  payableDays: number;
  isProrated: boolean;
  proratedGross: number;
}

export interface DeductionResult {
  pf: number;
  esi: number;
  pt: number;
  tds: number;
  lop: number;
  incentiveRecovery: number;
  loanDeduction: number;
}

export interface PayrollCalculation {
  salary: SalaryStructure;
  proration: ProrationResult;
  incentive: number;
  reimbursements: number;
  deductions: DeductionResult;
  netSalary: number;
}

// ─── CONFIG DEFAULTS ─────────────────────────────────────────────────────────
const PF_CAP = 1800;          // Max PF deduction per month
const ESI_THRESHOLD = 21000;  // ESI applies only if gross <= this
const ESI_RATE = 0.0075;      // 0.75%
const PF_RATE = 0.12;         // 12% of basic

// ─── SALARY STRUCTURE ────────────────────────────────────────────────────────

export function computeSalaryStructure(
  annualCtc: number,
  annualIncentive: number = 0
): SalaryStructure {
  const monthlyCtc = round2(annualCtc / 12);
  const basic = round2(monthlyCtc * 0.40);
  const hra = round2(basic * 0.80);
  const allowances = round2(monthlyCtc - basic - hra);
  const grossSalary = round2(basic + hra + allowances); // = monthlyCtc
  const monthlyIncentive = round2(annualIncentive / 12);

  return { annualCtc, monthlyCtc, basic, hra, allowances, grossSalary, monthlyIncentive };
}

// ─── PRORATION ───────────────────────────────────────────────────────────────

export function computeProration(
  grossSalary: number,
  cycleStart: Date,  // 26th of previous month
  cycleEnd: Date,    // 25th of current month
  joiningDate?: Date | null,
  lastWorkingDay?: Date | null
): ProrationResult {
  const totalDays = daysBetween(cycleStart, cycleEnd);

  let payableDays = totalDays;
  let isProrated = false;

  // Joiner mid-cycle
  if (joiningDate && joiningDate > cycleStart && joiningDate <= cycleEnd) {
    payableDays = daysBetween(joiningDate, cycleEnd);
    isProrated = true;
  }

  // Resigner mid-cycle
  if (lastWorkingDay && lastWorkingDay >= cycleStart && lastWorkingDay < cycleEnd) {
    payableDays = daysBetween(cycleStart, lastWorkingDay);
    isProrated = true;
  }

  const proratedGross = round2((grossSalary / totalDays) * payableDays);

  return { totalDays, payableDays, isProrated, proratedGross };
}

// ─── LOP ─────────────────────────────────────────────────────────────────────

export function computeLop(grossSalary: number, totalDays: number, lopDays: number): number {
  if (lopDays <= 0) return 0;
  return round2((grossSalary / totalDays) * lopDays);
}

// ─── PF ──────────────────────────────────────────────────────────────────────

export function computePf(basic: number): number {
  return Math.min(round2(basic * PF_RATE), PF_CAP);
}

// ─── ESI ─────────────────────────────────────────────────────────────────────

export function computeEsi(grossSalary: number): number {
  if (grossSalary > ESI_THRESHOLD) return 0;
  return round2(grossSalary * ESI_RATE);
}

// ─── PROFESSIONAL TAX ─────────────────────────────────────────────────────────

export async function computePt(grossSalary: number, state: string): Promise<number> {
  if (!state) return 0;

  const slab = await prisma.ptSlab.findFirst({
    where: {
      state: { equals: state, mode: 'insensitive' },
      minSalary: { lte: grossSalary },
      OR: [
        { maxSalary: null },
        { maxSalary: { gte: grossSalary } },
      ],
    },
    orderBy: { minSalary: 'desc' },
  });

  return slab ? Number(slab.ptAmount) : 0;
}

// ─── INCENTIVE RECOVERY ──────────────────────────────────────────────────────

export function computeIncentiveRecovery(
  monthlyIncentive: number,
  resignationDate: Date | null,
  lastWorkingDay: Date | null
): number {
  if (!resignationDate || !lastWorkingDay || monthlyIncentive <= 0) return 0;

  // Determine which slab we're in (Jan-Jun or Jul-Dec)
  const lwdMonth = lastWorkingDay.getMonth(); // 0-indexed
  const lwdYear = lastWorkingDay.getFullYear();

  let slabStart: Date;
  if (lwdMonth <= 5) {
    // Jan-Jun slab
    slabStart = new Date(lwdYear, 0, 1); // Jan 1
  } else {
    // Jul-Dec slab
    slabStart = new Date(lwdYear, 6, 1); // Jul 1
  }

  // Months from slab start to (resignation month - 1)
  const resignMonth = resignationDate.getMonth();
  const resignYear = resignationDate.getFullYear();

  const monthsPaid = (resignYear - slabStart.getFullYear()) * 12
    + resignMonth - slabStart.getMonth();

  if (monthsPaid <= 0) return 0;

  return round2(monthlyIncentive * monthsPaid);
}

// ─── LOAN DEDUCTION ──────────────────────────────────────────────────────────

export async function computeLoanDeduction(employeeId: string): Promise<{
  totalDeduction: number;
  loanIds: string[];
}> {
  const activeLoans = await prisma.loan.findMany({
    where: { employeeId, status: 'ACTIVE' },
  });

  let totalDeduction = 0;
  const loanIds: string[] = [];

  for (const loan of activeLoans) {
    const emi = Number(loan.emiAmount);
    const outstanding = Number(loan.outstandingBalance);
    const deduction = Math.min(emi, outstanding);
    totalDeduction += deduction;
    loanIds.push(loan.id);
  }

  return { totalDeduction: round2(totalDeduction), loanIds };
}

// ─── NET SALARY ──────────────────────────────────────────────────────────────

export function computeNetSalary(
  proratedGross: number,
  incentive: number,
  reimbursements: number,
  deductions: DeductionResult
): number {
  const totalAdditions = proratedGross + incentive + reimbursements;
  const totalDeductions =
    deductions.pf +
    deductions.esi +
    deductions.pt +
    deductions.tds +
    deductions.lop +
    deductions.incentiveRecovery +
    deductions.loanDeduction;

  return round2(Math.max(0, totalAdditions - totalDeductions));
}

// ─── FULL CALCULATION ─────────────────────────────────────────────────────────

export async function calculatePayrollForEmployee(params: {
  employeeId: string;
  annualCtc: number;
  annualIncentive: number;
  state: string;
  joiningDate: Date;
  lastWorkingDay?: Date | null;
  resignationDate?: Date | null;
  cycleStart: Date;
  cycleEnd: Date;
  lopDays: number;
  tdsAmount: number;
  reimbursements: number;
}): Promise<PayrollCalculation> {
  const salary = computeSalaryStructure(params.annualCtc, params.annualIncentive);
  const proration = computeProration(
    salary.grossSalary,
    params.cycleStart,
    params.cycleEnd,
    params.joiningDate,
    params.lastWorkingDay
  );

  const lopAmount = computeLop(salary.grossSalary, proration.totalDays, params.lopDays);
  const pf = computePf(salary.basic);
  const esi = computeEsi(salary.grossSalary);
  const pt = await computePt(salary.grossSalary, params.state);
  const incentiveRecovery = computeIncentiveRecovery(
    salary.monthlyIncentive,
    params.resignationDate || null,
    params.lastWorkingDay || null
  );
  const { totalDeduction: loanDeduction } = await computeLoanDeduction(params.employeeId);

  const deductions: DeductionResult = {
    pf,
    esi,
    pt,
    tds: params.tdsAmount,
    lop: lopAmount,
    incentiveRecovery,
    loanDeduction,
  };

  const netSalary = computeNetSalary(
    proration.proratedGross,
    salary.monthlyIncentive,
    params.reimbursements,
    deductions
  );

  return {
    salary,
    proration,
    incentive: salary.monthlyIncentive,
    reimbursements: params.reimbursements,
    deductions,
    netSalary,
  };
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function daysBetween(start: Date, end: Date): number {
  const ms = end.getTime() - start.getTime();
  return Math.round(ms / (1000 * 60 * 60 * 24)) + 1; // inclusive
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function toNumber(decimal: Decimal | number): number {
  return typeof decimal === 'number' ? decimal : Number(decimal);
}
