import { prisma } from '../utils/prisma'
import { AppError } from '../middleware/errorHandler'
import { computeSalaryStructure, computeEsi, computePt, computeLoanDeduction } from './payrollEngine'

export interface FnfCalculation {
  employeeId:        string
  employeeName:      string
  resignationDate:   Date
  lastWorkingDay:    Date
  cycleStart:        Date
  salaryDays:        number
  totalCycleDays:    number
  grossSalary:       number
  proratedSalary:    number
  pendingReimbursements: number
  pfAmount:          number
  esiAmount:         number
  ptAmount:          number
  tdsAmount:         number
  loanOutstanding:   number
  otherDeductions:   number
  totalAdditions:    number
  totalDeductions:   number
  netPayable:        number
  breakdown: { label: string; amount: number; type: 'addition' | 'deduction' }[]
}

function daysBetween(start: Date, end: Date): number {
  return Math.round(Math.abs(end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1
}

function r2(n: number): number { return Math.round(n * 100) / 100 }

export async function calculateFnf(employeeId: string): Promise<FnfCalculation> {
  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
    include: { loans: { where: { status: 'ACTIVE' } } },
  })

  if (!employee) throw new AppError('Employee not found', 404)
  if (!employee.resignationDate) throw new AppError('No resignation date set', 400)
  if (!employee.lastWorkingDay)  throw new AppError('No last working day set', 400)

  const lwd      = employee.lastWorkingDay
  const lwdMonth = lwd.getMonth()
  const lwdYear  = lwd.getFullYear()

  const cycleStart = new Date(lwdYear, lwdMonth - 1, 26)
  const cycleEnd   = new Date(lwdYear, lwdMonth, 25)

  const totalCycleDays = daysBetween(cycleStart, cycleEnd)
  const salaryDays     = daysBetween(cycleStart, lwd)

  // Build salary input from employee fields
  const salaryInput = {
    annualCtc:        Number(employee.annualCtc),
    basicPercent:     Number((employee as any).basicPercent    ?? 45),
    hraPercent:       Number((employee as any).hraPercent      ?? 35),
    transportMonthly: (employee as any).transportMonthly != null ? Number((employee as any).transportMonthly) : null,
    fbpMonthly:       (employee as any).fbpMonthly       != null ? Number((employee as any).fbpMonthly)       : null,
    mediclaim:        Number((employee as any).mediclaim        ?? 0),
    hasIncentive:     Boolean((employee as any).hasIncentive),
    incentivePercent: Number((employee as any).incentivePercent ?? 12),
  }

  const salary = computeSalaryStructure(salaryInput)

  const proratedSalary = r2((salary.grandTotalMonthly / totalCycleDays) * salaryDays)
  const pfAmount       = salary.employeePfMonthly
  const esiAmount      = computeEsi(salary.grandTotalMonthly)
  const ptAmount       = await computePt(salary.grandTotalMonthly, employee.state || '')

  // TDS from last entry
  const lastEntry = await prisma.payrollEntry.findFirst({
    where: { employeeId },
    orderBy: { createdAt: 'desc' },
  })
  const tdsAmount = lastEntry ? Number(lastEntry.tdsAmount) : 0

  // Loan outstanding
  const loanOutstanding = r2(
    (employee as any).loans.reduce((sum: number, loan: any) => sum + Number(loan.outstandingBalance), 0)
  )

  // Pending reimbursements
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

  const totalAdditions  = r2(proratedSalary + pendingReimbursements)
  const totalDeductions = r2(pfAmount + esiAmount + ptAmount + tdsAmount + loanOutstanding)
  const netPayable      = r2(Math.max(0, totalAdditions - totalDeductions))

  const breakdown = [
    { label: `Salary (${salaryDays} days)`,    amount: proratedSalary,       type: 'addition'  as const },
    ...(pendingReimbursements > 0 ? [{ label: 'Pending Reimbursements', amount: pendingReimbursements, type: 'addition'  as const }] : []),
    { label: 'Employee PF',                    amount: pfAmount,             type: 'deduction' as const },
    ...(esiAmount > 0     ? [{ label: 'ESI',                  amount: esiAmount,     type: 'deduction' as const }] : []),
    ...(ptAmount > 0      ? [{ label: 'Professional Tax',      amount: ptAmount,      type: 'deduction' as const }] : []),
    ...(tdsAmount > 0     ? [{ label: 'TDS',                   amount: tdsAmount,     type: 'deduction' as const }] : []),
    ...(loanOutstanding > 0 ? [{ label: 'Loan Outstanding',   amount: loanOutstanding, type: 'deduction' as const }] : []),
  ]

  return {
    employeeId,
    employeeName:          employee.name,
    resignationDate:       employee.resignationDate,
    lastWorkingDay:        lwd,
    cycleStart,
    salaryDays,
    totalCycleDays,
    grossSalary:           salary.grandTotalMonthly,
    proratedSalary,
    pendingReimbursements,
    pfAmount,
    esiAmount,
    ptAmount,
    tdsAmount,
    loanOutstanding,
    otherDeductions:       0,
    totalAdditions,
    totalDeductions,
    netPayable,
    breakdown,
  }
}
