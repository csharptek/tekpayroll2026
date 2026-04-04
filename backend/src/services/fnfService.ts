import { prisma } from '../utils/prisma'
import { AppError } from '../middleware/errorHandler'
import { computeSalaryStructure, computePf, computeEsi, computePt, computeIncentiveRecovery } from './payrollEngine'

export interface FnfCalculation {
  employeeId:        string
  employeeName:      string
  resignationDate:   Date
  lastWorkingDay:    Date

  // Salary component
  cycleStart:        Date
  lastWorkingDay_:   Date
  salaryDays:        number
  totalCycleDays:    number
  grossSalary:       number
  proratedSalary:    number

  // Additions
  pendingReimbursements: number

  // Deductions
  pfAmount:          number
  esiAmount:         number
  ptAmount:          number
  tdsAmount:         number
  incentiveRecovery: number
  loanOutstanding:   number
  otherDeductions:   number

  // Net
  totalAdditions:    number
  totalDeductions:   number
  netPayable:        number

  // Breakdown for display
  breakdown: {
    label:  string
    amount: number
    type:   'addition' | 'deduction'
  }[]
}

function daysBetween(start: Date, end: Date): number {
  return Math.round(Math.abs(end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

export async function calculateFnf(employeeId: string): Promise<FnfCalculation> {
  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
    include: {
      loans: { where: { status: 'ACTIVE' } },
    },
  })

  if (!employee) throw new AppError('Employee not found', 404)
  if (!employee.resignationDate) throw new AppError('No resignation date set for this employee', 400)
  if (!employee.lastWorkingDay) throw new AppError('No last working day set for this employee', 400)

  const lwd            = employee.lastWorkingDay
  const resignDate     = employee.resignationDate
  const lwdMonth       = lwd.getMonth()
  const lwdYear        = lwd.getFullYear()

  // Cycle for LWD month: 26th of prev month to 25th of current month
  const cycleStart = new Date(lwdYear, lwdMonth - 1, 26)
  const cycleEnd   = new Date(lwdYear, lwdMonth, 25)

  const totalCycleDays = daysBetween(cycleStart, cycleEnd)

  // Payable days: 26th prev month → last working day
  const salaryDays = daysBetween(cycleStart, lwd)

  const salary       = computeSalaryStructure(Number(employee.annualCtc), Number(employee.annualIncentive))
  const proratedSalary = round2((salary.grossSalary / totalCycleDays) * salaryDays)

  // Deductions
  const pfAmount    = computePf(salary.basic)
  const esiAmount   = computeEsi(salary.grossSalary)
  const ptAmount    = await computePt(salary.grossSalary, employee.state || '')

  // TDS — use last known TDS from most recent payroll entry
  const lastEntry = await prisma.payrollEntry.findFirst({
    where: { employeeId },
    orderBy: { createdAt: 'desc' },
  })
  const tdsAmount = lastEntry ? Number(lastEntry.tdsAmount) : 0

  // Incentive recovery
  const incentiveRecovery = computeIncentiveRecovery(
    salary.monthlyIncentive,
    resignDate,
    lwd
  )

  // Outstanding loan balances
  const loanOutstanding = employee.loans.reduce((sum, loan) => sum + Number(loan.outstandingBalance), 0)

  // Pending reimbursements from open cycle
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

  const totalAdditions  = round2(proratedSalary + pendingReimbursements)
  const totalDeductions = round2(pfAmount + esiAmount + ptAmount + tdsAmount + incentiveRecovery + loanOutstanding)
  const netPayable      = round2(Math.max(0, totalAdditions - totalDeductions))

  const breakdown = [
    { label: `Salary (${salaryDays} days)`,    amount: proratedSalary,       type: 'addition'  as const },
    ...(pendingReimbursements > 0 ? [{ label: 'Pending Reimbursements', amount: pendingReimbursements, type: 'addition' as const }] : []),
    { label: 'Provident Fund (PF)',             amount: pfAmount,             type: 'deduction' as const },
    ...(esiAmount > 0    ? [{ label: 'ESI',                  amount: esiAmount,   type: 'deduction' as const }] : []),
    ...(ptAmount > 0     ? [{ label: 'Professional Tax',      amount: ptAmount,    type: 'deduction' as const }] : []),
    ...(tdsAmount > 0    ? [{ label: 'TDS',                   amount: tdsAmount,   type: 'deduction' as const }] : []),
    ...(incentiveRecovery > 0 ? [{ label: 'Incentive Recovery', amount: incentiveRecovery, type: 'deduction' as const }] : []),
    ...(loanOutstanding > 0   ? [{ label: 'Loan Outstanding Balance', amount: loanOutstanding, type: 'deduction' as const }] : []),
  ]

  return {
    employeeId,
    employeeName:        employee.name,
    resignationDate:     resignDate,
    lastWorkingDay:      lwd,
    cycleStart,
    lastWorkingDay_:     lwd,
    salaryDays,
    totalCycleDays,
    grossSalary:         salary.grossSalary,
    proratedSalary,
    pendingReimbursements,
    pfAmount,
    esiAmount,
    ptAmount,
    tdsAmount,
    incentiveRecovery,
    loanOutstanding:     round2(loanOutstanding),
    otherDeductions:     0,
    totalAdditions,
    totalDeductions,
    netPayable,
    breakdown,
  }
}
