import ExcelJS from 'exceljs'
import { prisma } from '../utils/prisma'
import { buildBreakups } from '../routes/salaryBreakups'
import { computeProration } from './payrollEngine'

export interface PfSlipRow {
  employeeId: string
  name:       string
  basic:      number
  hra:        number
  transport:  number
  fbp:        number
  hyi:        number
  pf:         number
  esi:        number
  pt:         number
  lop:        number
  gross:      number
  isExtra:    boolean
}

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100

// ─── Rows from saved payroll entries (no recalculation) ──────────────────────

export async function buildEntryRows(cycleId: string, employeeIds?: string[]): Promise<PfSlipRow[]> {
  const entries = await prisma.payrollEntry.findMany({
    where: {
      cycleId,
      ...(employeeIds ? { employeeId: { in: employeeIds } } : {}),
    },
    include: { employee: { select: { id: true, name: true } } },
  })

  return entries
    .map((e): PfSlipRow => {
      const totalDays = Number(e.totalDays)
      const base  = e.isProrated && totalDays > 0 ? Number(e.payableDays) / totalDays : 1
      const ratio = Math.max(0, base - (totalDays > 0 ? Number(e.lopDays) / totalDays : 0))  // LOP folded into earnings
      return {
        employeeId: e.employeeId,
        name:       e.employee.name,
        basic:      r2(Number(e.basic) * ratio),
        hra:        r2(Number(e.hra) * ratio),
        transport:  r2(Number(e.transport) * ratio),
        fbp:        r2(Number(e.fbp) * ratio),
        hyi:        r2(Number(e.hyi) * ratio),
        pf:         r2(Number(e.pfAmount)),
        esi:        r2(Number(e.esiAmount)),
        pt:         r2(Number(e.ptAmount)),
        lop:        0,
        gross:      r2(Number(e.proratedGross) - Number(e.lopAmount)),
        isExtra:    false,
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name))
}

// ─── Rows for employees not in payroll (skipped / temp leave / exited) ───────
// Same proration + LOP rules as payroll. PF/ESI follow the prorated earnings.

export interface PfCycle { id: string; payrollMonth: string; cycleStart: Date; cycleEnd: Date }
export interface ExtraMeta { totalDays: number; payableDays: number; lopDays: number }

export async function getExtraMeta(cycle: PfCycle, employeeIds: string[]): Promise<Record<string, ExtraMeta>> {
  if (!employeeIds.length) return {}
  const [emps, lops] = await Promise.all([
    prisma.employee.findMany({
      where: { id: { in: employeeIds } },
      select: { id: true, joiningDate: true, lastWorkingDay: true },
    }),
    prisma.lopEntry.findMany({
      where: { cycleId: cycle.id, employeeId: { in: employeeIds } },
      select: { employeeId: true, lopDays: true },
    }),
  ])
  const lopMap = new Map<string, number>(lops.map((l: any) => [l.employeeId, Number(l.lopDays)] as [string, number]))
  const out: Record<string, ExtraMeta> = {}
  for (const e of emps) {
    const p = computeProration(0, cycle.cycleStart, cycle.cycleEnd, e.joiningDate, e.lastWorkingDay)
    let payable = p.payableDays
    if (e.lastWorkingDay && e.lastWorkingDay < cycle.cycleStart) payable = 0
    if (e.joiningDate && e.joiningDate > cycle.cycleEnd) payable = 0
    out[e.id] = { totalDays: p.totalDays, payableDays: payable, lopDays: lopMap.get(e.id) || 0 }
  }
  return out
}

export async function buildExtraRows(
  cycle: PfCycle,
  employeeIds: string[],
  lopOverride: Record<string, number> = {}
): Promise<PfSlipRow[]> {
  if (!employeeIds.length) return []
  const [y, m] = cycle.payrollMonth.split('-').map(n => parseInt(n))
  const asOf = new Date(y, m, 0, 23, 59, 59)

  const employees = await prisma.employee.findMany({
    where: { id: { in: employeeIds } },
    select: { id: true, employeeCode: true, name: true, jobTitle: true, department: true, state: true, status: true },
    orderBy: { name: 'asc' },
  })
  const [rows, meta] = await Promise.all([
    buildBreakups(employees, asOf),
    getExtraMeta(cycle, employeeIds),
  ])

  const out: PfSlipRow[] = []
  for (const r of rows) {
    const mt = meta[r.employeeId]
    const total = mt?.totalDays || 30
    const payable = mt ? mt.payableDays : total
    if (payable <= 0) continue
    const ratio = payable / total
    const lopDays = Math.max(0, Number(lopOverride[r.employeeId] ?? mt?.lopDays ?? 0))

    const effRatio = Math.max(0, payable - lopDays) / total   // LOP folded into earnings, drives PF/ESI
    const basic = r2(r.basic * effRatio)
    out.push({
      employeeId: r.employeeId,
      name:       r.name,
      basic,
      hra:        r2(r.hra * effRatio),
      transport:  r2(r.transport * effRatio),
      fbp:        r2(r.fbp * effRatio),
      hyi:        r2(r.hyi * effRatio),
      pf:         r2(Math.min(Math.round(basic * 0.12), 1800)),
      esi:        r2(r.employeeEsi * effRatio),
      pt:         r2(r.pt),
      lop:        0,
      gross:      r2(r.grossMonthly * effRatio),
      isExtra:    true,
    })
  }
  return out
}

// ─── Workbook (4 per row) ────────────────────────────────────────────────────

export async function writePfSheet(rows: PfSlipRow[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Salary Breakup')

  const COLS_PER_EMP = 5
  const EMPS_PER_ROW = 4
  const NUM_FMT = '#,##0.00'

  for (let c = 1; c <= EMPS_PER_ROW * COLS_PER_EMP; c++) {
    const pos = (c - 1) % COLS_PER_EMP
    const col = ws.getColumn(c)
    col.width = pos === 0 ? 28 : pos === 1 ? 13 : pos === 2 ? 22 : pos === 3 ? 13 : 3
  }

  const headerFill: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9E1F2' } }
  const totalFill:  ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF2CC' } }
  const netFill:    ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2EFDA' } }
  const border: Partial<ExcelJS.Borders> = {
    top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' },
  }

  const colFor = (empIdx: number, field: number) => empIdx * COLS_PER_EMP + field + 1

  function put(row: number, col: number, value: any, o: { fill?: ExcelJS.Fill; bold?: boolean; center?: boolean; num?: boolean } = {}) {
    const cell = ws.getCell(row, col)
    if (value !== undefined) cell.value = value
    cell.border = border
    if (o.fill) cell.fill = o.fill
    if (o.bold) cell.font = { bold: true, size: 10 }
    if (o.center) cell.alignment = { horizontal: 'center', vertical: 'middle' }
    if (o.num) cell.numFmt = NUM_FMT
  }

  function writeBlock(startRow: number, emps: (PfSlipRow | null)[]): number {
    emps.forEach((emp, i) => {
      const c1 = colFor(i, 0), c4 = colFor(i, 3)
      ws.mergeCells(startRow, c1, startRow, c4)
      put(startRow, c1, emp ? emp.name : '', { fill: headerFill, bold: true, center: true })
      ws.getRow(startRow).height = 18

      const hd = startRow + 1
      put(hd, colFor(i, 0), 'Earnings',   { fill: headerFill, bold: true, center: true })
      put(hd, colFor(i, 1), 'Amount',     { fill: headerFill, bold: true, center: true })
      put(hd, colFor(i, 2), 'Deductions', { fill: headerFill, bold: true, center: true })
      put(hd, colFor(i, 3), 'Amount',     { fill: headerFill, bold: true, center: true })

      const earn: [string, number][] = emp
        ? [
            ['Basic Salary', emp.basic],
            ['HRA', emp.hra],
            ['Transportation Allowance', emp.transport],
            ['FBP', emp.fbp],
            ['Incentive Half Yearly', emp.hyi],
          ]
        : [['Basic Salary', 0], ['HRA', 0], ['Transportation Allowance', 0], ['FBP', 0], ['Incentive Half Yearly', 0]]

      const ded: ([string, number] | null)[] = emp
        ? [
            ['Employee PF', emp.pf],
            emp.esi > 0 ? ['Employee ESI', emp.esi] : null,
            emp.pt  > 0 ? ['Professional Tax', emp.pt] : null,
            null,
          ]
        : [null, null, null, null, null]

      earn.forEach(([label, amt], ri) => {
        const row = startRow + 2 + ri
        put(row, colFor(i, 0), emp ? label : undefined)
        put(row, colFor(i, 1), emp ? amt : undefined, { num: true })
        const d = ded[ri]
        put(row, colFor(i, 2), d ? d[0] : undefined)
        put(row, colFor(i, 3), d ? d[1] : undefined, { num: true })
      })

      const totRow = startRow + 2 + earn.length
      const totalDed = emp ? r2(emp.pf + emp.esi + emp.pt) : 0
      put(totRow, colFor(i, 0), emp ? 'Total Earnings' : undefined,   { fill: totalFill, bold: true })
      put(totRow, colFor(i, 1), emp ? emp.gross : undefined,          { fill: totalFill, bold: true, num: true })
      put(totRow, colFor(i, 2), emp ? 'Total Deductions' : undefined, { fill: totalFill, bold: true })
      put(totRow, colFor(i, 3), emp ? totalDed : undefined,           { fill: totalFill, bold: true, num: true })

      const netRow = totRow + 1
      put(netRow, colFor(i, 0), undefined)
      put(netRow, colFor(i, 1), undefined)
      put(netRow, colFor(i, 2), emp ? 'Net Salary' : undefined,       { fill: netFill, bold: true })
      put(netRow, colFor(i, 3), emp ? r2(emp.gross - totalDed) : undefined, { fill: netFill, bold: true, num: true })
    })
    return startRow + 2 + 5 + 1 + 1 + 1 // header+cols+5 rows+total+net+gap
  }

  let current = 1
  for (let i = 0; i < rows.length; i += EMPS_PER_ROW) {
    const group: (PfSlipRow | null)[] = rows.slice(i, i + EMPS_PER_ROW)
    while (group.length < EMPS_PER_ROW) group.push(null)
    current = writeBlock(current, group)
  }

  return Buffer.from(await wb.xlsx.writeBuffer())
}
