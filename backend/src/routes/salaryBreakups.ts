import { Router } from 'express';
import * as XLSX from 'xlsx';
import { authenticate, requireSuperAdmin } from '../middleware/auth';
import { prisma } from '../utils/prisma';
import { computeSalaryStructure, getEsiConfig, getSalaryInputForDate } from '../services/payrollEngine';

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
      netMonthly:   s.grandTotalMonthly - s.employeePfMonthly - s.employeeEsiMonthly,
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
// Body: { employeeIds?: string[], month, year, format?: 'long' | 'wide' }
// Default format = 'long' (row per component)

salaryBreakupsRouter.post('/export', async (req, res) => {
  const { employeeIds, month, year, format = 'long' } = req.body || {};

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
        ['Employee PF',   'Deduction (in Gross)', r.employeePf],
        ['Employee ESI',  'Deduction (in Gross)', r.employeeEsi],
        ['Employer PF',   'Employer (in CTC)',    r.employerPf],
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

  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;

  const filename = `salary-breakups-${y}-${String(m).padStart(2, '0')}.xlsx`;
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(buf);
});
