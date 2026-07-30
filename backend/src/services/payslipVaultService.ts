import archiver from 'archiver'
import { PDFDocument } from 'pdf-lib'
import ExcelJS from 'exceljs'
import { prisma } from '../utils/prisma'
import { AppError } from '../middleware/errorHandler'
import { downloadPayslipPdf } from '../utils/payslipBlob'

// ─── Date helpers ──────────────────────────────────────────────────────────
// Date-only strings like "2026-04-01" from <input type="date"> parse as UTC
// midnight. cycleStart is stored as IST local time, so a naive `gte` on that
// UTC instant excludes the first ~5.5 hours of the day — cutting out entire
// early-month cycles (e.g. April missing while May onward worked). Normalize
// explicitly to IST day boundaries instead of trusting Date's UTC parsing.
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000

function startOfDayIST(d: Date): Date {
  // Shift into IST, floor to date, shift back to get the UTC instant
  // that corresponds to 00:00:00 IST on that calendar day.
  const ist = new Date(d.getTime() + IST_OFFSET_MS)
  ist.setUTCHours(0, 0, 0, 0)
  return new Date(ist.getTime() - IST_OFFSET_MS)
}

function endOfDayIST(d: Date): Date {
  const start = startOfDayIST(d)
  return new Date(start.getTime() + 24 * 60 * 60 * 1000 - 1)
}

// ─── Shared helpers ────────────────────────────────────────────────────────

function dec(v: any): number {
  return v == null ? 0 : Number(v)
}

async function fetchPayslips(params: {
  employeeIds: string[]
  months?: string[]        // payrollMonth values e.g. "2026-04"
  from?: Date
  to?: Date
}) {
  const { employeeIds, months, from, to } = params

  const cycleFilter: any = {}
  if (months?.length) cycleFilter.payrollMonth = { in: months }
  if (from || to) {
    cycleFilter.cycleStart = {}
    if (from) cycleFilter.cycleStart.gte = startOfDayIST(from)
    if (to) cycleFilter.cycleStart.lte = endOfDayIST(to)
  }

  return prisma.payslip.findMany({
    where: {
      employeeId: { in: employeeIds },
      status: 'GENERATED',
      pdfKey: { not: null },
      cycle: Object.keys(cycleFilter).length ? cycleFilter : undefined,
    },
    include: {
      employee: { select: { id: true, name: true, employeeCode: true, status: true } },
      cycle: { select: { payrollMonth: true, cycleStart: true } },
      entry: true,
    },
    orderBy: [{ employeeId: 'asc' }, { cycle: { cycleStart: 'asc' } }],
  })
}

// ─── Single employee — merge multiple months into one PDF ─────────────────

export async function mergeSingleEmployeePayslips(employeeId: string, months: string[]) {
  const payslips = await fetchPayslips({ employeeIds: [employeeId], months })
  if (!payslips.length) throw new AppError('No generated payslips found for selection', 404)

  const merged = await PDFDocument.create()
  for (const ps of payslips) {
    const buf = await downloadPayslipPdf(ps.pdfKey!)
    const src = await PDFDocument.load(buf)
    const pages = await merged.copyPages(src, src.getPageIndices())
    pages.forEach((p) => merged.addPage(p))
  }

  const bytes = await merged.save()
  const employee = payslips[0].employee
  return { buffer: Buffer.from(bytes), employee }
}

// ─── Multi-employee bulk — zip of individual PDFs ──────────────────────────

export async function zipBulkPayslips(params: {
  employeeIds: string[]
  months?: string[]
  from?: Date
  to?: Date
}): Promise<NodeJS.ReadableStream> {
  const payslips = await fetchPayslips(params)
  if (!payslips.length) throw new AppError('No generated payslips found for selection', 404)

  const archive = archiver('zip', { zlib: { level: 9 } })

  ;(async () => {
    for (const ps of payslips) {
      try {
        const buf = await downloadPayslipPdf(ps.pdfKey!)
        const fname = `${ps.employee.employeeCode}_${ps.employee.name.replace(/[^a-zA-Z0-9]/g, '_')}/${ps.cycle.payrollMonth}.pdf`
        archive.append(buf, { name: fname })
      } catch {
        // skip missing blob, continue others
      }
    }
    archive.finalize()
  })()

  return archive
}

// ─── Salary view: monthly + cumulative ─────────────────────────────────────

export async function getSalaryView(params: {
  employeeId: string
  from?: Date
  to?: Date
}) {
  const { employeeId, from, to } = params

  const entries = await prisma.payrollEntry.findMany({
    where: {
      employeeId,
      cycle: {
        ...(from || to ? { cycleStart: { ...(from ? { gte: startOfDayIST(from) } : {}), ...(to ? { lte: endOfDayIST(to) } : {}) } } : {}),
      },
    },
    include: { cycle: { select: { payrollMonth: true, cycleStart: true, status: true } } },
    orderBy: { cycle: { cycleStart: 'asc' } },
  })

  const monthly = entries.map((e) => ({
    payrollMonth: e.cycle.payrollMonth,
    grossSalary: dec(e.grossSalary),
    netSalary: dec(e.netSalary),
    pfAmount: dec(e.pfAmount),
    esiAmount: dec(e.esiAmount),
    ptAmount: dec(e.ptAmount),
    tdsAmount: dec(e.tdsAmount),
    lopAmount: dec(e.lopAmount),
    loanDeduction: dec(e.loanDeduction),
    status: e.status,
  }))

  const cumulative = monthly.reduce(
    (acc, m) => ({
      grossSalary: acc.grossSalary + m.grossSalary,
      netSalary: acc.netSalary + m.netSalary,
      pfAmount: acc.pfAmount + m.pfAmount,
      esiAmount: acc.esiAmount + m.esiAmount,
      ptAmount: acc.ptAmount + m.ptAmount,
      tdsAmount: acc.tdsAmount + m.tdsAmount,
      lopAmount: acc.lopAmount + m.lopAmount,
      loanDeduction: acc.loanDeduction + m.loanDeduction,
    }),
    { grossSalary: 0, netSalary: 0, pfAmount: 0, esiAmount: 0, ptAmount: 0, tdsAmount: 0, lopAmount: 0, loanDeduction: 0 },
  )

  return { monthly, cumulative, monthCount: monthly.length }
}

// ─── Company-wide report: month-wise all employees + cumulative totals ─────

export async function getCompanyReport(params: { from?: Date; to?: Date }) {
  const { from, to } = params

  const entries = await prisma.payrollEntry.findMany({
    where: {
      cycle: {
        ...(from || to ? { cycleStart: { ...(from ? { gte: startOfDayIST(from) } : {}), ...(to ? { lte: endOfDayIST(to) } : {}) } } : {}),
      },
    },
    select: {
      grossSalary: true,
      netSalary: true,
      pfAmount: true,
      employerPfAmount: true,
      esiAmount: true,
      employerEsiAmount: true,
      ptAmount: true,
      tdsAmount: true,
      lopAmount: true,
      loanDeduction: true,
      employee: { select: { id: true, employeeCode: true, name: true, department: true, status: true } },
      cycle: { select: { payrollMonth: true, cycleStart: true } },
    },
    orderBy: [{ cycle: { cycleStart: 'asc' } }, { employee: { name: 'asc' } }],
  })

  if (!entries.length) return { months: [], cumulative: null, employeeCount: 0 }

  const byMonth = new Map<string, typeof entries>()
  for (const e of entries) {
    const key = e.cycle.payrollMonth
    if (!byMonth.has(key)) byMonth.set(key, [])
    byMonth.get(key)!.push(e)
  }

  const months = [...byMonth.entries()].map(([payrollMonth, rows]) => ({
    payrollMonth,
    employeeCount: rows.length,
    totalGross: rows.reduce((s, r) => s + dec(r.grossSalary), 0),
    totalNet: rows.reduce((s, r) => s + dec(r.netSalary), 0),
    totalPf: rows.reduce((s, r) => s + dec(r.pfAmount) + dec(r.employerPfAmount), 0),
    totalEsi: rows.reduce((s, r) => s + dec(r.esiAmount) + dec(r.employerEsiAmount), 0),
    totalPt: rows.reduce((s, r) => s + dec(r.ptAmount), 0),
    totalTds: rows.reduce((s, r) => s + dec(r.tdsAmount), 0),
    totalLop: rows.reduce((s, r) => s + dec(r.lopAmount), 0),
    totalLoan: rows.reduce((s, r) => s + dec(r.loanDeduction), 0),
    employees: rows.map((r) => ({
      employeeId: r.employee.id,
      employeeCode: r.employee.employeeCode,
      name: r.employee.name,
      department: r.employee.department,
      status: r.employee.status,
      grossSalary: dec(r.grossSalary),
      netSalary: dec(r.netSalary),
    })),
  }))

  const cumulative = entries.reduce(
    (acc, r) => ({
      totalGross: acc.totalGross + dec(r.grossSalary),
      totalNet: acc.totalNet + dec(r.netSalary),
      totalPf: acc.totalPf + dec(r.pfAmount) + dec(r.employerPfAmount),
      totalEsi: acc.totalEsi + dec(r.esiAmount) + dec(r.employerEsiAmount),
      totalPt: acc.totalPt + dec(r.ptAmount),
      totalTds: acc.totalTds + dec(r.tdsAmount),
      totalLop: acc.totalLop + dec(r.lopAmount),
      totalLoan: acc.totalLoan + dec(r.loanDeduction),
    }),
    { totalGross: 0, totalNet: 0, totalPf: 0, totalEsi: 0, totalPt: 0, totalTds: 0, totalLop: 0, totalLoan: 0 },
  )

  const uniqueEmployees = new Set(entries.map((e) => e.employee.id))

  return { months, cumulative, employeeCount: uniqueEmployees.size, monthCount: months.length }
}

const EXCEL_COLUMNS = [
  { header: 'Employee Code', key: 'employeeCode', width: 16 },
  { header: 'Employee Name', key: 'employeeName', width: 24 },
  { header: 'Status', key: 'empStatus', width: 12 },
  { header: 'Payroll Month', key: 'payrollMonth', width: 14 },
  { header: 'Annual CTC', key: 'annualCtc', width: 14 },
  { header: 'Monthly CTC', key: 'monthlyCtc', width: 14 },
  { header: 'Basic', key: 'basic', width: 12 },
  { header: 'HRA', key: 'hra', width: 12 },
  { header: 'Transport', key: 'transport', width: 12 },
  { header: 'FBP', key: 'fbp', width: 12 },
  { header: 'HYI', key: 'hyi', width: 12 },
  { header: 'Gross Salary', key: 'grossSalary', width: 14 },
  { header: 'Annual Bonus', key: 'annualBonus', width: 14 },
  { header: 'Payable Days', key: 'payableDays', width: 12 },
  { header: 'Total Days', key: 'totalDays', width: 12 },
  { header: 'LOP Days', key: 'lopDays', width: 10 },
  { header: 'LOP Amount', key: 'lopAmount', width: 12 },
  { header: 'Incentive', key: 'incentive', width: 12 },
  { header: 'Reimbursement', key: 'reimbursementTotal', width: 14 },
  { header: 'Employee PF', key: 'pfAmount', width: 12 },
  { header: 'Employer PF', key: 'employerPfAmount', width: 12 },
  { header: 'Employee ESI', key: 'esiAmount', width: 12 },
  { header: 'Employer ESI', key: 'employerEsiAmount', width: 12 },
  { header: 'PT', key: 'ptAmount', width: 10 },
  { header: 'TDS', key: 'tdsAmount', width: 12 },
  { header: 'Incentive Recovery', key: 'incentiveRecovery', width: 16 },
  { header: 'Loan Deduction', key: 'loanDeduction', width: 14 },
  { header: 'Net Salary', key: 'netSalary', width: 14 },
]

export async function exportSalaryExcel(params: {
  employeeIds: string[]
  from?: Date
  to?: Date
}): Promise<Buffer> {
  const { employeeIds, from, to } = params

  const entries = await prisma.payrollEntry.findMany({
    where: {
      employeeId: { in: employeeIds },
      cycle: {
        ...(from || to ? { cycleStart: { ...(from ? { gte: startOfDayIST(from) } : {}), ...(to ? { lte: endOfDayIST(to) } : {}) } } : {}),
      },
    },
    include: {
      employee: { select: { employeeCode: true, name: true, status: true } },
      cycle: { select: { payrollMonth: true, cycleStart: true } },
    },
    orderBy: [{ employee: { employeeCode: 'asc' } }, { cycle: { cycleStart: 'asc' } }],
  })

  if (!entries.length) throw new AppError('No payroll data found for selection', 404)

  const wb = new ExcelJS.Workbook()
  const sheet = wb.addWorksheet('Salary Breakup')
  sheet.columns = EXCEL_COLUMNS

  sheet.getRow(1).font = { bold: true }
  sheet.getRow(1).alignment = { vertical: 'middle', horizontal: 'center' }

  for (const e of entries) {
    sheet.addRow({
      employeeCode: e.employee.employeeCode,
      employeeName: e.employee.name,
      empStatus: e.employee.status,
      payrollMonth: e.cycle.payrollMonth,
      annualCtc: dec(e.annualCtc),
      monthlyCtc: dec(e.monthlyCtc),
      basic: dec(e.basic),
      hra: dec(e.hra),
      transport: dec(e.transport),
      fbp: dec(e.fbp),
      hyi: dec(e.hyi),
      grossSalary: dec(e.grossSalary),
      annualBonus: dec(e.annualBonus),
      payableDays: e.payableDays,
      totalDays: e.totalDays,
      lopDays: dec(e.lopDays),
      lopAmount: dec(e.lopAmount),
      incentive: dec(e.incentive),
      reimbursementTotal: dec(e.reimbursementTotal),
      pfAmount: dec(e.pfAmount),
      employerPfAmount: dec(e.employerPfAmount),
      esiAmount: dec(e.esiAmount),
      employerEsiAmount: dec(e.employerEsiAmount),
      ptAmount: dec(e.ptAmount),
      tdsAmount: dec(e.tdsAmount),
      incentiveRecovery: dec(e.incentiveRecovery),
      loanDeduction: dec(e.loanDeduction),
      netSalary: dec(e.netSalary),
    })
  }

  sheet.autoFilter = { from: 'A1', to: `${sheet.getColumn(EXCEL_COLUMNS.length).letter}1` }
  sheet.views = [{ state: 'frozen', ySplit: 1 }]

  const buf = await wb.xlsx.writeBuffer()
  return Buffer.from(buf as ArrayBuffer)
}
