import { Router } from 'express'
import { authenticate, requireSuperAdmin } from '../middleware/auth'
import { prisma } from '../utils/prisma'
import { AppError } from '../middleware/errorHandler'

export const tdsRouter = Router()
tdsRouter.use(authenticate, requireSuperAdmin)

// ─── Helper: FY from payrollMonth ────────────────────────────────────────────
function getFY(payrollMonth: string): string {
  const [y, m] = payrollMonth.split('-').map(Number)
  // Apr(4)–Mar(3): FY starts in April
  const fyStart = m >= 4 ? y : y - 1
  return `${fyStart}-${String(fyStart + 1).slice(2)}`
}

// FY months in order: Apr=1 ... Mar=12
function getFYMonths(fy: string): string[] {
  const startYear = parseInt(fy.split('-')[0])
  const months: string[] = []
  for (let m = 4; m <= 12; m++) months.push(`${startYear}-${String(m).padStart(2, '0')}`)
  for (let m = 1; m <= 3; m++)  months.push(`${startYear + 1}-${String(m).padStart(2, '0')}`)
  return months
}

function currentPayrollMonth(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

// ─── GET /api/tds/:employeeId — summary + history ────────────────────────────
tdsRouter.get('/:employeeId', async (req, res) => {
  const { employeeId } = req.params
  const payrollMonth = (req.query.payrollMonth as string) || currentPayrollMonth()
  const fy = getFY(payrollMonth)
  const fyMonths = getFYMonths(fy)

  const emp = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: { id: true, name: true, employeeCode: true, tdsMonthly: true },
  })
  if (!emp) throw new AppError('Employee not found', 404)

  // YTD paid — sum tdsAmount from LOCKED/DISBURSED payroll entries in this FY
  const ytdEntries = await prisma.payrollEntry.findMany({
    where: {
      employeeId,
      cycle: {
        payrollMonth: { in: fyMonths },
        status: { in: ['LOCKED', 'DISBURSED'] },
      },
    },
    select: { tdsAmount: true, cycle: { select: { payrollMonth: true } } },
  })

  const ytdPaid = ytdEntries.reduce((s, e) => s + Number(e.tdsAmount), 0)

  // Remaining months in FY from payrollMonth (inclusive)
  const idx = fyMonths.indexOf(payrollMonth)
  const remainingMonths = idx >= 0 ? fyMonths.length - idx : 12

  // History for this FY
  const history = await prisma.tdsConfig.findMany({
    where: { employeeId, financialYear: fy },
    orderBy: { createdAt: 'desc' },
    include: { employee: { select: { name: true } } },
  })

  res.json({
    success: true,
    data: {
      employee: emp,
      payrollMonth,
      financialYear: fy,
      ytdPaid: Math.round(ytdPaid * 100) / 100,
      remainingMonths,
      currentMonthlyTds: Number(emp.tdsMonthly),
      history,
    },
  })
})

// ─── POST /api/tds/:employeeId — set new annual tax ──────────────────────────
tdsRouter.post('/:employeeId', async (req, res) => {
  const { employeeId } = req.params
  const { annualTax, payrollMonth, note } = req.body

  if (!annualTax || isNaN(Number(annualTax))) throw new AppError('annualTax required', 400)
  const pm = payrollMonth || currentPayrollMonth()
  const fy = getFY(pm)
  const fyMonths = getFYMonths(fy)

  const emp = await prisma.employee.findUnique({ where: { id: employeeId } })
  if (!emp) throw new AppError('Employee not found', 404)

  // YTD paid in locked/disbursed entries
  const ytdEntries = await prisma.payrollEntry.findMany({
    where: {
      employeeId,
      cycle: {
        payrollMonth: { in: fyMonths },
        status: { in: ['LOCKED', 'DISBURSED'] },
      },
    },
    select: { tdsAmount: true },
  })
  const ytdPaid = ytdEntries.reduce((s, e) => s + Number(e.tdsAmount), 0)

  const idx = fyMonths.indexOf(pm)
  const remainingMonths = idx >= 0 ? fyMonths.length - idx : 12

  const remaining = Math.max(0, Number(annualTax) - ytdPaid)
  const monthlyTds = remainingMonths > 0 ? Math.round((remaining / remainingMonths) * 100) / 100 : 0

  // Save config record + update employee.tdsMonthly
  await prisma.$transaction([
    prisma.tdsConfig.create({
      data: {
        employeeId,
        financialYear: fy,
        annualTax: Number(annualTax),
        monthlyTds,
        effectiveFrom: pm,
        ytdPaidAtChange: ytdPaid,
        remainingMonths,
        setBy: req.user!.id,
        note: note || null,
      },
    }),
    prisma.employee.update({
      where: { id: employeeId },
      data: { tdsMonthly: monthlyTds },
    }),
  ])

  res.json({
    success: true,
    data: {
      annualTax: Number(annualTax),
      ytdPaid: Math.round(ytdPaid * 100) / 100,
      remainingMonths,
      monthlyTds,
      effectiveFrom: pm,
      financialYear: fy,
    },
  })
})

// ─── GET /api/tds — list employees with current TDS ──────────────────────────
tdsRouter.get('/', async (_req, res) => {
  const employees = await prisma.employee.findMany({
    where: { status: { in: ['ACTIVE', 'ON_NOTICE'] } },
    select: {
      id: true, name: true, employeeCode: true, department: true,
      tdsMonthly: true,
    },
    orderBy: { name: 'asc' },
  })
  res.json({ success: true, data: employees })
})
