import ExcelJS from 'exceljs'
import { prisma } from '../utils/prisma'
import { buildBreakups } from '../routes/salaryBreakups'
import { computeProration, getPfConfig, getEsiConfig, pfFor, esiCeil } from './payrollEngine'

export interface PfSlipRow {
  employeeId: string
  name:       string
  code:       string
  uan:        string
  esiNumber:  string
  basic:      number   // earned (after proration + LOP)
  hra:        number
  transport:  number
  fbp:        number
  hyi:        number
  pf:         number   // statutory employee PF on earned basic
  paidPf:     number   // PF actually deducted from employee
  esi:        number   // statutory employee ESI (rounded up)
  paidEsi:    number   // ESI actually deducted from employee
  esiApplies: boolean
  pt:         number
  lop:        number
  gross:      number   // earned gross
  totalDays:  number
  workedDays: number   // whole days
  ncpDays:    number   // non-contributory days (totalDays - workedDays)
  lwd:        Date | null
  zeroWage:   boolean  // unpaid leave — reported with 0 wages
  isExtra:    boolean
}

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100
const r0 = (n: number) => Math.round(Number(n) || 0)
const cleanName = (n: string) => String(n || '').split('|')[0].replace(/\s+/g, ' ').trim()

function monthEndOf(payrollMonth: string): Date {
  const [y, m] = payrollMonth.split('-').map(n => parseInt(n))
  return new Date(Date.UTC(y, m, 0, 23, 59, 59))
}

function lwdInMonth(lwd: Date | null | undefined, start: Date, end: Date): Date | null {
  if (!lwd) return null
  const d = new Date(lwd)
  const e = new Date(end); e.setHours(23, 59, 59, 999)
  return d >= new Date(start) && d <= e ? d : null
}

/** Earnings rounded to the rupee; HYI is the balancing line so lines always add up to gross */
function earnLines(basic: number, hra: number, transport: number, fbp: number, gross: number, hyiRaw: number) {
  const b = r0(basic), h = r0(hra), t = r0(transport), f = r0(fbp), g = r0(gross)
  const residual = g - (b + h + t + f)
  return { basic: b, hra: h, transport: t, fbp: f, hyi: residual >= 0 ? residual : r0(hyiRaw), gross: residual >= 0 ? g : b + h + t + f + r0(hyiRaw) }
}

// ─── Rows from saved payroll entries (no recalculation of pay) ───────────────

export async function buildEntryRows(cycleId: string, employeeIds?: string[]): Promise<PfSlipRow[]> {
  const entries = await prisma.payrollEntry.findMany({
    where: {
      cycleId,
      ...(employeeIds ? { employeeId: { in: employeeIds } } : {}),
    },
    include: {
      employee: { select: { id: true, name: true, employeeCode: true, uanNumber: true, esiNumber: true, lastWorkingDay: true } },
      cycle:    { select: { payrollMonth: true, cycleStart: true, cycleEnd: true } },
    },
  })
  const [pfCfg, esiCfg] = await Promise.all([getPfConfig(), getEsiConfig()])

  return entries
    .map((e): PfSlipRow => {
      const totalDays = Number(e.totalDays) || 30
      const payable   = e.isProrated ? Number(e.payableDays) : totalDays
      const worked    = Math.max(0, payable - Number(e.lopDays))
      const ratio     = worked / totalDays
      const monthEnd  = monthEndOf((e as any).cycle.payrollMonth)
      const earnedBasic = r2(Number(e.basic) * ratio)
      const lines = earnLines(
        earnedBasic, Number(e.hra) * ratio, Number(e.transport) * ratio, Number(e.fbp) * ratio,
        Number(e.proratedGross) - Number(e.lopAmount), Number(e.hyi) * ratio,
      )
      const esiApplies = Number(e.esiAmount) > 0 || Number(e.employerEsiAmount) > 0
      const workedDays = Math.floor(worked)
      const emp: any = e.employee
      return {
        employeeId: e.employeeId,
        name:       emp.name,
        code:       emp.employeeCode,
        uan:        String(emp.uanNumber || '').trim(),
        esiNumber:  String(emp.esiNumber || '').trim(),
        ...lines,
        pf:         pfFor(earnedBasic, monthEnd, pfCfg),
        paidPf:     r2(Number(e.pfAmount)),
        esi:        esiApplies ? esiCeil(earnedBasic * esiCfg.employeeRate) : 0,
        paidEsi:    r2(Number(e.esiAmount)),
        esiApplies,
        pt:         r2(Number(e.ptAmount)),
        lop:        0,
        totalDays,
        workedDays,
        ncpDays:    Math.max(0, totalDays - workedDays),
        lwd:        lwdInMonth(emp.lastWorkingDay, (e as any).cycle.cycleStart, (e as any).cycle.cycleEnd),
        zeroWage:   false,
        isExtra:    false,
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name))
}

// ─── Rows for employees not in payroll (skipped / unpaid leave / exited) ─────
// Same proration + LOP rules as payroll. PF/ESI follow the earned basic.

export interface PfCycle { id: string; payrollMonth: string; cycleStart: Date; cycleEnd: Date }
export interface ExtraMeta { totalDays: number; payableDays: number; lopDays: number; zeroWage: boolean; lwd: Date | null }

export async function getExtraMeta(cycle: PfCycle, employeeIds: string[]): Promise<Record<string, ExtraMeta>> {
  if (!employeeIds.length) return {}
  const [emps, lops] = await Promise.all([
    prisma.employee.findMany({
      where: { id: { in: employeeIds } },
      select: { id: true, joiningDate: true, lastWorkingDay: true, pfZeroWage: true },
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
    out[e.id] = {
      totalDays:   p.totalDays,
      payableDays: payable,
      lopDays:     lopMap.get(e.id) || 0,
      zeroWage:    Boolean((e as any).pfZeroWage),
      lwd:         lwdInMonth(e.lastWorkingDay, cycle.cycleStart, cycle.cycleEnd),
    }
  }
  return out
}

export async function buildExtraRows(
  cycle: PfCycle,
  employeeIds: string[],
  lopOverride: Record<string, number> = {}
): Promise<PfSlipRow[]> {
  if (!employeeIds.length) return []
  const asOf = monthEndOf(cycle.payrollMonth)
  const [pfCfg, esiCfg] = await Promise.all([getPfConfig(), getEsiConfig()])

  const employees = await prisma.employee.findMany({
    where: { id: { in: employeeIds } },
    select: {
      id: true, employeeCode: true, name: true, jobTitle: true, department: true, state: true, status: true,
      uanNumber: true, esiNumber: true,
    },
    orderBy: { name: 'asc' },
  })
  const meta = await getExtraMeta(cycle, employeeIds)
  const empMap = new Map(employees.map(e => [e.id, e]))

  const out: PfSlipRow[] = []

  // Unpaid leave: reported with 0 wages, full month non-contributory
  for (const e of employees) {
    const mt = meta[e.id]
    if (!mt?.zeroWage) continue
    out.push({
      employeeId: e.id, name: e.name, code: e.employeeCode,
      uan: String(e.uanNumber || '').trim(), esiNumber: String(e.esiNumber || '').trim(),
      basic: 0, hra: 0, transport: 0, fbp: 0, hyi: 0, gross: 0,
      pf: 0, paidPf: 0, esi: 0, paidEsi: 0, esiApplies: false, pt: 0, lop: 0,
      totalDays: mt.totalDays, workedDays: 0, ncpDays: mt.totalDays,
      lwd: null, zeroWage: true, isExtra: true,
    })
  }

  const payIds = employees.filter(e => !meta[e.id]?.zeroWage)
  const rows = await buildBreakups(payIds, asOf)
  for (const r of rows) {
    const mt = meta[r.employeeId]
    const e: any = empMap.get(r.employeeId)
    const total = mt?.totalDays || 30
    const payable = mt ? mt.payableDays : total
    if (payable <= 0) continue
    const lopDays = Math.max(0, Number(lopOverride[r.employeeId] ?? mt?.lopDays ?? 0))
    const worked  = Math.max(0, payable - lopDays)
    const effRatio = worked / total   // LOP folded into earnings, drives PF/ESI
    const earnedBasic = r2(r.basic * effRatio)
    const lines = earnLines(earnedBasic, r.hra * effRatio, r.transport * effRatio, r.fbp * effRatio, r.grossMonthly * effRatio, r.hyi * effRatio)
    const esiApplies = Number(r.employeeEsi) > 0
    const pf  = pfFor(earnedBasic, asOf, pfCfg)
    const esi = esiApplies ? esiCeil(earnedBasic * esiCfg.employeeRate) : 0
    const workedDays = Math.floor(worked)
    out.push({
      employeeId: r.employeeId,
      name:       r.name,
      code:       e?.employeeCode || '',
      uan:        String(e?.uanNumber || '').trim(),
      esiNumber:  String(e?.esiNumber || '').trim(),
      ...lines,
      pf, paidPf: pf,
      esi, paidEsi: esi,
      esiApplies,
      pt:         r2(r.pt),
      lop:        0,
      totalDays:  total,
      workedDays,
      ncpDays:    Math.max(0, total - workedDays),
      lwd:        mt?.lwd ?? null,
      zeroWage:   false,
      isExtra:    true,
    })
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

// ─── ECR (EPFO return text file) ─────────────────────────────────────────────
// UAN#~#NAME#~#GROSS#~#EPF WAGES#~#EPS WAGES#~#EDLI WAGES#~#EPF EE#~#EPS#~#EPF-EPS DIFF#~#NCP DAYS#~#REFUND

export function ecrLine(r: PfSlipRow, ceiling: number, rate: number) {
  const cap     = (n: number) => Math.min(r0(n), ceiling)
  const epf     = cap(r.basic)
  const ee      = r.zeroWage ? 0 : Math.round(epf * rate)
  const eps     = r.zeroWage ? 0 : Math.round(epf * 0.0833)
  return { epf, eps: epf, edli: epf, ee, epsAmt: eps, er: Math.max(0, ee - eps) }
}

export async function writeEcr(rows: PfSlipRow[], payrollMonth: string): Promise<{ text: string; missing: string[] }> {
  const cfg      = await getPfConfig()
  const monthEnd = monthEndOf(payrollMonth)
  const ceiling  = monthEnd.getTime() >= cfg.effectiveFrom.getTime() ? cfg.ceiling : cfg.prevCeiling
  const missing: string[] = []
  const lines: string[] = []
  for (const r of rows) {
    if (!/^\d{12}$/.test(r.uan)) { missing.push(cleanName(r.name)); continue }
    const c = ecrLine(r, ceiling, cfg.rate)
    const name = cleanName(r.name).toUpperCase().replace(/[^A-Z .]/g, '')
    lines.push([r.uan, name, r0(r.gross), c.epf, c.eps, c.edli, c.ee, c.epsAmt, c.er, r.ncpDays, 0].join('#~#'))
  }
  return { text: lines.join('\r\n') + (lines.length ? '\r\n' : ''), missing }
}

// ─── ESIC monthly contribution upload ────────────────────────────────────────
// Reason codes: 0 none, 1 On Leave, 2 Left Service

export async function writeEsic(rows: PfSlipRow[]): Promise<{ buf: Buffer; missing: string[] }> {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Sheet1')
  ws.addRow(['IP Number (10 Digits)', 'IP Name( Only Alphabets and Space )', 'No of Days for which wages paid/payable during the month',
    'Total Monthly Wages', 'Reason Code for Zero workings days(numeric only; provide 0 for all other reasons- Click on the link for reference)',
    'Last Working Day( Format DD/MM/YYYY  or DD-MM-YYYY)'])
  ws.getRow(1).font = { bold: true }
  const missing: string[] = []
  const fmt = (d: Date) => `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`
  for (const r of rows) {
    const inEsi = r.esiApplies || (r.esiNumber && (r.zeroWage || r.lwd))
    if (!inEsi) continue
    if (!/^\d{10}$/.test(r.esiNumber)) { missing.push(cleanName(r.name)); continue }
    const days   = r.zeroWage ? 0 : r.workedDays
    const wages  = r.zeroWage ? 0 : r0(r.basic)
    const reason = r.lwd ? 2 : days === 0 ? 1 : 0
    ws.addRow([r.esiNumber, cleanName(r.name).replace(/[^A-Za-z ]/g, ''), days, wages, reason, r.lwd ? fmt(r.lwd) : ''])
  }
  ws.columns.forEach(c => { c.width = 22 })
  return { buf: Buffer.from(await wb.xlsx.writeBuffer()), missing }
}

// ─── Workbook (4 per row) ────────────────────────────────────────────────────

export async function writePfSheet(rows: PfSlipRow[], payrollMonth?: string): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Salary Breakup')

  const COLS_PER_EMP = 5
  const EMPS_PER_ROW = 4
  const NUM_FMT = '#,##0'

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

      const companyDiff = emp ? r2((emp.pf - emp.paidPf) + (emp.esi - emp.paidEsi)) : 0
      const ded: ([string, number] | null)[] = emp
        ? [
            ['Employee PF', emp.pf],
            emp.esi > 0 ? ['Employee ESI', emp.esi] : null,
            emp.pt  > 0 ? ['Professional Tax', emp.pt] : null,
            companyDiff !== 0 ? [companyDiff > 0 ? 'Less: Borne by company' : 'Add: Excess deducted', -companyDiff] : null,
            emp.zeroWage ? ['Unpaid leave (0 wages)', 0] : null,
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
      const totalDed = emp ? r2(emp.paidPf + emp.paidEsi + emp.pt) : 0
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

  // ── Summary sheet (for PF consultant) ──────────────────────────────────────
  const cfg = await getPfConfig()
  const monthEnd = payrollMonth ? monthEndOf(payrollMonth) : new Date()
  const ceiling  = monthEnd.getTime() >= cfg.effectiveFrom.getTime() ? cfg.ceiling : cfg.prevCeiling
  const esiCfg   = await getEsiConfig()
  const sm = wb.addWorksheet('PF ESIC Summary')
  sm.addRow(['Code', 'Name', 'UAN', 'ESIC IP No', 'Days in Month', 'Days Worked', 'NCP Days', 'Gross',
    'EPF Wages', 'EPS Wages', 'EDLI Wages', 'EE PF', 'EPS', 'ER PF', 'PF Deducted', 'PF Borne by Company',
    'ESI Wages', 'ESI EE', 'ESI ER', 'ESI Deducted', 'Last Working Day', 'Remarks'])
  sm.getRow(1).font = { bold: true }
  sm.getRow(1).fill = headerFill
  const tot = new Array(22).fill(0)
  for (const r of rows) {
    const c = ecrLine(r, ceiling, cfg.rate)
    const esiWages = r.esiApplies ? r0(r.basic) : 0
    const esiEr    = r.esiApplies ? esiCeil(r.basic * esiCfg.employerRate) : 0
    const remarks  = [
      r.zeroWage ? 'Unpaid leave — 0 wages' : '',
      r.lwd ? 'Left service' : '',
      !r.uan ? 'UAN missing' : '',
      r.esiApplies && !r.esiNumber ? 'ESIC no. missing' : '',
      r.isExtra ? 'Not in payroll run' : '',
    ].filter(Boolean).join('; ')
    const vals = [r.code, cleanName(r.name), r.uan, r.esiNumber, r.totalDays, r.workedDays, r.ncpDays, r0(r.gross),
      c.epf, c.eps, c.edli, c.ee, c.epsAmt, c.er, r.paidPf, r2(c.ee - r.paidPf),
      esiWages, r.esi, esiEr, r.paidEsi, r.lwd ? r.lwd.toISOString().slice(0, 10) : '', remarks]
    sm.addRow(vals)
    vals.forEach((v, i) => { if (i >= 7 && i <= 19 && typeof v === 'number') tot[i] += v })
  }
  const totRow = sm.addRow(['', 'TOTAL', '', '', '', '', '', ...tot.slice(7, 20).map(v => r2(v)), '', ''])
  totRow.font = { bold: true }
  totRow.fill = totalFill
  sm.columns.forEach((c, i) => { c.width = i === 1 ? 28 : i === 21 ? 34 : 13 })

  return Buffer.from(await wb.xlsx.writeBuffer())
}
