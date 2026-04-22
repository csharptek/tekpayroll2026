import { Router } from 'express';
import * as XLSX from 'xlsx';
import ExcelJS from 'exceljs';
import { authenticate, requireSuperAdmin } from '../middleware/auth';
import { prisma } from '../utils/prisma';
import { computeSalaryStructure, getEsiConfig, getSalaryInputForDate, computePt } from '../services/payrollEngine';

export const salaryBreakupsRouter = Router();
salaryBreakupsRouter.use(authenticate, requireSuperAdmin);

interface BreakupRow {
  employeeId:       string;
  employeeCode:     string;
  name:             string;
  jobTitle:         string;
  department:       string;
  state:            string;
  status:           string;
  annualCtc:        number;
  basic:            number;
  hra:              number;
  transport:        number;
  fbp:              number;
  hyi:              number;
  grossMonthly:     number;
  employeePf:       number;
  employeeEsi:      number;
  employerPf:       number;
  employerEsi:      number;
  pt:               number;
  netMonthly:       number;
  esiApplies:       boolean;
  mediclaim:        number;
  annualBonus:      number;
  hasIncentive:     boolean;
}

// ─── Helper: build breakup rows for a given month ────────────────────────────

async function buildBreakups(
  employees: Array<{ id: string; employeeCode: string; name: string; jobTitle: string | null; department: string | null; state: string | null; status: string }>,
  asOf: Date
): Promise<BreakupRow[]> {
  const esiConfig = await getEsiConfig();
  const rows: BreakupRow[] = [];

  for (const emp of employees) {
    const input = await getSalaryInputForDate(emp.id, asOf);
    if (!input.annualCtc || Number(input.annualCtc) <= 0) continue;

    const s = computeSalaryStructure({
      annualCtc:        Number(input.annualCtc),
      basicPercent:     Number(input.basicPercent),
      hraPercent:       Number(input.hraPercent),
      transportMonthly: input.transportMonthly != null ? Number(input.transportMonthly) : null,
      fbpMonthly:       input.fbpMonthly       != null ? Number(input.fbpMonthly)       : null,
      mediclaim:        Number(input.mediclaim),
      hasIncentive:     Boolean(input.hasIncentive),
      incentivePercent: Number(input.incentivePercent),
    }, esiConfig);

    const pt = await computePt(s.grandTotalMonthly, emp.state || '');

    rows.push({
      employeeId:   emp.id,
      employeeCode: emp.employeeCode,
      name:         emp.name,
      jobTitle:     emp.jobTitle || '',
      department:   emp.department || '',
      state:        emp.state || '',
      status:       emp.status,
      annualCtc:    Number(input.annualCtc),
      basic:        s.basicMonthly,
      hra:          s.hraMonthly,
      transport:    s.transportMonthly,
      fbp:          s.fbpMonthly,
      hyi:          s.hyiMonthly,
      grossMonthly: s.grandTotalMonthly,
      employeePf:   s.employeePfMonthly,
      employeeEsi:  s.employeeEsiMonthly,
      employerPf:   Math.min(s.employerPfMonthly, 1800),
      employerEsi:  s.employerEsiMonthly,
      pt,
      netMonthly:   s.grandTotalMonthly - s.employeePfMonthly - s.employeeEsiMonthly - pt,
      esiApplies:   s.esiApplies,
      mediclaim:    Number(input.mediclaim),
      annualBonus:  s.annualBonus,
      hasIncentive: Boolean(input.hasIncentive),
    });
  }
  return rows;
}

// ─── GET /api/hr/salary-breakups ─────────────────────────────────────────────

salaryBreakupsRouter.get('/', async (req, res) => {
  const now        = new Date();
  const month      = parseInt(String(req.query.month || (now.getMonth() + 1)));
  const year       = parseInt(String(req.query.year  || now.getFullYear()));
  const q          = String(req.query.q || '').trim().toLowerCase();
  const department = String(req.query.department || '').trim();

  // Use the last day of the selected month as "asOf" for salary revision lookup
  const asOf = new Date(year, month, 0, 23, 59, 59);

  const where: any = { status: { in: ['ACTIVE', 'ON_NOTICE'] } };
  if (department) where.department = department;

  const employees = await prisma.employee.findMany({
    where,
    select: {
      id: true, employeeCode: true, name: true, jobTitle: true,
      department: true, state: true, status: true,
    },
    orderBy: [{ name: 'asc' }],
  });

  // Filter by search after fetch (small employee counts)
  const filtered = q
    ? employees.filter(e =>
        e.name.toLowerCase().includes(q) ||
        e.employeeCode.toLowerCase().includes(q) ||
        (e.jobTitle || '').toLowerCase().includes(q) ||
        (e.department || '').toLowerCase().includes(q)
      )
    : employees;

  const rows = await buildBreakups(filtered, asOf);

  // Distinct departments for filter UI
  const allDepts = Array.from(new Set(
    employees.map(e => e.department).filter((d): d is string => !!d)
  )).sort();

  res.json({
    success: true,
    data: {
      month, year,
      asOf: asOf.toISOString(),
      employeeCount: rows.length,
      rows,
      departments: allDepts,
    },
  });
});

// ─── POST /api/hr/salary-breakups/export ─────────────────────────────────────
// Body: { employeeIds?: string[], month, year, format?: 'slip' | 'long' | 'wide' }
// Default format = 'slip'

salaryBreakupsRouter.post('/export', async (req, res) => {
  const { employeeIds, month, year, format = 'slip' } = req.body || {};

  const m = parseInt(String(month));
  const y = parseInt(String(year));
  if (!m || !y) return res.status(400).json({ success: false, error: 'month and year required' });

  const asOf = new Date(y, m, 0, 23, 59, 59);

  const where: any = { status: { in: ['ACTIVE', 'ON_NOTICE'] } };
  if (Array.isArray(employeeIds) && employeeIds.length > 0) {
    where.id = { in: employeeIds };
  }

  const employees = await prisma.employee.findMany({
    where,
    select: {
      id: true, employeeCode: true, name: true, jobTitle: true,
      department: true, state: true, status: true,
    },
    orderBy: [{ name: 'asc' }],
  });

  const rows = await buildBreakups(employees, asOf);

  const monthLabel = new Date(y, m - 1, 1).toLocaleString('en-IN', { month: 'long', year: 'numeric' });

  const filename = `salary-breakups-${y}-${String(m).padStart(2, '0')}.xlsx`;

  // ── SLIP FORMAT (default) ────────────────────────────────────────────────
  if (format === 'slip') {
    const wbSlip = new ExcelJS.Workbook();
    const ws = wbSlip.addWorksheet('Salary Breakup');

    const COLS_PER_EMP = 5; // earningLabel | earningAmt | dedLabel | dedAmt | gap
    const EMPS_PER_ROW = 4;

    // Column widths
    for (let c = 1; c <= EMPS_PER_ROW * COLS_PER_EMP; c++) {
      const pos = (c - 1) % COLS_PER_EMP;
      const col = ws.getColumn(c);
      if (pos === 0)      col.width = 28;
      else if (pos === 1) col.width = 13;
      else if (pos === 2) col.width = 22;
      else if (pos === 3) col.width = 13;
      else                col.width = 3;
    }

    const headerFill: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9E1F2' } };
    const totalFill:  ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF2CC' } };
    const netFill:    ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2EFDA' } };
    const thinBorder: Partial<ExcelJS.Borders> = {
      top: { style: 'thin' }, left: { style: 'thin' },
      bottom: { style: 'thin' }, right: { style: 'thin' },
    };

    function colFor(empIdx: number, field: number) {
      return empIdx * COLS_PER_EMP + field + 1;
    }
    function sc(cell: ExcelJS.Cell, opts: {
      fill?: ExcelJS.Fill; bold?: boolean; border?: Partial<ExcelJS.Borders>;
      align?: Partial<ExcelJS.Alignment>; numFmt?: string; italic?: boolean;
    }) {
      if (opts.fill)   cell.fill   = opts.fill;
      if (opts.border) cell.border = opts.border;
      if (opts.align)  cell.alignment = opts.align;
      if (opts.numFmt) cell.numFmt = opts.numFmt;
      if (opts.bold || opts.italic) cell.font = { bold: !!opts.bold, italic: !!opts.italic, size: 10 };
    }

    function writeBlock(startRow: number, emps: BreakupRow[]) {
      // ── Name row
      emps.forEach((emp, i) => {
        const c1 = colFor(i, 0), c4 = colFor(i, 3);
        ws.mergeCells(startRow, c1, startRow, c4);
        const cell = ws.getCell(startRow, c1);
        cell.value = emp.name;
        sc(cell, { fill: headerFill, bold: true, border: thinBorder, align: { horizontal: 'center', vertical: 'middle' } });
        ws.getRow(startRow).height = 18;
      });

      // ── Column header row
      const hdRow = startRow + 1;
      emps.forEach((emp, i) => {
        [
          [colFor(i,0), 'Earnings'],
          [colFor(i,1), 'Amount'],
          [colFor(i,2), 'Deductions'],
          [colFor(i,3), 'Amount'],
        ].forEach(([c, label]) => {
          const cell = ws.getCell(hdRow, c as number);
          cell.value = label;
          sc(cell, { fill: headerFill, bold: true, border: thinBorder, align: { horizontal: 'center' } });
        });
      });

      // ── Earning/deduction rows
      const earningLabels = ['Basic Salary', 'HRA', 'Transportation Allowance', 'FBP', 'Incentive Half Yearly'];
      const earningKeys:  (keyof BreakupRow)[] = ['basic', 'hra', 'transport', 'fbp', 'hyi'];

      earningLabels.forEach((label, ri) => {
        const row = startRow + 2 + ri;
        emps.forEach((emp, i) => {
          const lCell = ws.getCell(row, colFor(i, 0));
          lCell.value = label;
          sc(lCell, { border: thinBorder });

          const aCell = ws.getCell(row, colFor(i, 1));
          aCell.value = emp[earningKeys[ri]] as number;
          sc(aCell, { border: thinBorder, numFmt: '#,##0' });

          const dlCell = ws.getCell(row, colFor(i, 2));
          const daCell = ws.getCell(row, colFor(i, 3));

          if (ri === 0) {
            dlCell.value = 'Employee PF';
            sc(dlCell, { border: thinBorder });
            daCell.value = emp.employeePf;
            sc(daCell, { border: thinBorder, numFmt: '#,##0' });
          } else if (ri === 1 && emp.employeeEsi > 0) {
            dlCell.value = 'Employee ESI';
            sc(dlCell, { border: thinBorder });
            daCell.value = emp.employeeEsi;
            sc(daCell, { border: thinBorder, numFmt: '#,##0' });
          } else if (ri === 2 && emp.pt > 0) {
            dlCell.value = 'Professional Tax';
            sc(dlCell, { border: thinBorder });
            daCell.value = emp.pt;
            sc(daCell, { border: thinBorder, numFmt: '#,##0' });
          } else {
            sc(dlCell, { border: thinBorder });
            sc(daCell, { border: thinBorder });
          }
        });
      });

      // ── Totals row
      const totRow = startRow + 2 + earningLabels.length;
      emps.forEach((emp, i) => {
        const totalDed = emp.employeePf + emp.employeeEsi + emp.pt;

        const tlCell = ws.getCell(totRow, colFor(i, 0));
        tlCell.value = 'Total Earnings';
        sc(tlCell, { fill: totalFill, bold: true, border: thinBorder });

        const taCell = ws.getCell(totRow, colFor(i, 1));
        taCell.value = emp.grossMonthly;
        sc(taCell, { fill: totalFill, bold: true, border: thinBorder, numFmt: '#,##0' });

        const tdlCell = ws.getCell(totRow, colFor(i, 2));
        tdlCell.value = 'Total Deductions';
        sc(tdlCell, { fill: totalFill, bold: true, border: thinBorder });

        const tdaCell = ws.getCell(totRow, colFor(i, 3));
        tdaCell.value = totalDed;
        sc(tdaCell, { fill: totalFill, bold: true, border: thinBorder, numFmt: '#,##0' });
      });

      // ── Net salary row
      const netRow = totRow + 1;
      emps.forEach((emp, i) => {
        sc(ws.getCell(netRow, colFor(i, 0)), { border: thinBorder });
        sc(ws.getCell(netRow, colFor(i, 1)), { border: thinBorder });

        const nlCell = ws.getCell(netRow, colFor(i, 2));
        nlCell.value = 'Net Salary';
        sc(nlCell, { fill: netFill, bold: true, border: thinBorder });

        const naCell = ws.getCell(netRow, colFor(i, 3));
        naCell.value = emp.netMonthly;
        sc(naCell, { fill: netFill, bold: true, border: thinBorder, numFmt: '#,##0' });
      });

      return netRow + 2; // gap of 2 rows before next block
    }

    // ── Pad rows to groups of 4 and write
    const EMPTY_ROW: BreakupRow = {
      employeeId: '', employeeCode: '', name: '', jobTitle: '', department: '',
      state: '', status: '', annualCtc: 0, basic: 0, hra: 0, transport: 0,
      fbp: 0, hyi: 0, grossMonthly: 0, employeePf: 0, employeeEsi: 0,
      employerPf: 0, employerEsi: 0, pt: 0, netMonthly: 0, esiApplies: false,
      mediclaim: 0, annualBonus: 0, hasIncentive: false,
    };

    let currentRow = 1;
    for (let i = 0; i < rows.length; i += EMPS_PER_ROW) {
      const group = rows.slice(i, i + EMPS_PER_ROW);
      while (group.length < EMPS_PER_ROW) group.push({ ...EMPTY_ROW });
      currentRow = writeBlock(currentRow, group);
    }

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    const buf = await wbSlip.xlsx.writeBuffer();
    return res.send(buf);
  }

  // ── WIDE / LONG (existing) ───────────────────────────────────────────────
  const wb = XLSX.utils.book_new();

  if (format === 'wide') {
    // WIDE: one row per employee, all components as columns
    const data = rows.map(r => ({
      'Employee Code': r.employeeCode,
      'Name':          r.name,
      'Job Title':     r.jobTitle,
      'Department':    r.department,
      'Status':        r.status,
      'State':         r.state,
      'Annual CTC':    r.annualCtc,
      'Basic':         r.basic,
      'HRA':           r.hra,
      'Transport':     r.transport,
      'FBP':           r.fbp,
      'HYI':           r.hyi,
      'Gross Monthly': r.grossMonthly,
      'Employee PF':   r.employeePf,
      'Employee ESI':  r.employeeEsi,
      'Professional Tax': r.pt,
      'Employer PF':   r.employerPf,
      'Employer ESI':  r.employerEsi,
      'Net Monthly':   r.netMonthly,
      'ESIC Applicable': r.esiApplies ? 'Yes' : 'No',
      'Mediclaim Annual': r.mediclaim,
      'Annual Bonus':  r.annualBonus,
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    XLSX.utils.book_append_sheet(wb, ws, `Breakups ${monthLabel}`);
  } else {
    // LONG: row per component
    const data: any[] = [];
    for (const r of rows) {
      const base = {
        'Employee Code': r.employeeCode,
        'Name':          r.name,
        'Job Title':     r.jobTitle,
        'Department':    r.department,
        'Status':        r.status,
        'State':         r.state,
        'Annual CTC':    r.annualCtc,
      };
      const components: Array<[string, string, number]> = [
        ['Basic',         'Earning (in Gross)',   r.basic],
        ['HRA',           'Earning (in Gross)',   r.hra],
        ['Transport',     'Earning (in Gross)',   r.transport],
        ['FBP',           'Earning (in Gross)',   r.fbp],
        ['HYI',           'Earning (in Gross)',   r.hyi],
        ['Gross Monthly', 'Gross',                r.grossMonthly],
        ['Employee PF',        'Deduction (in Gross)', r.employeePf],
        ['Employee ESI',       'Deduction (in Gross)', r.employeeEsi],
        ['Professional Tax',   'Deduction (in Gross)', r.pt],
        ['Employer PF',        'Employer (in CTC)',    r.employerPf],
        ['Employer ESI',  'Employer (in CTC)',    r.employerEsi],
        ['Net Monthly',   'Net Take Home',        r.netMonthly],
      ];
      for (const [comp, type, monthly] of components) {
        data.push({
          ...base,
          'Component': comp,
          'Type':      type,
          'Monthly':   monthly,
          'Annual':    monthly * 12,
        });
      }
    }
    const ws = XLSX.utils.json_to_sheet(data);
    XLSX.utils.book_append_sheet(wb, ws, `Breakups ${monthLabel}`);
  }

  const buf2 = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as any;

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(buf2);
});
