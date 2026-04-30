import { Router } from 'express';
import { authenticate, requireManagement, requireSuperAdmin } from '../middleware/auth';
import { prisma } from '../utils/prisma';

export const reportRouter = Router();
reportRouter.use(authenticate, requireManagement);

// ─── DASHBOARD SUMMARY ────────────────────────────────────────────────────────
reportRouter.get('/summary', async (_req, res) => {
  const lastCycle = await prisma.payrollCycle.findFirst({
    where: { status: { in: ['LOCKED', 'DISBURSED'] } },
    orderBy: { cycleStart: 'desc' },
  });

  const totalEmployees = lastCycle?.employeeCount
    ?? await prisma.employee.count({ where: { status: 'ACTIVE' } });

  res.json({ success: true, data: { totalEmployees, lastCycle } });
});

// ─── PAYROLL TREND ────────────────────────────────────────────────────────────
reportRouter.get('/payroll-trend', async (_req, res) => {
  const cycles = await prisma.payrollCycle.findMany({
    where: { status: { in: ['LOCKED', 'DISBURSED'] } },
    orderBy: { cycleStart: 'asc' },
    take: 12,
    select: { payrollMonth: true, totalNet: true, totalGross: true, employeeCount: true },
  });
  res.json({ success: true, data: cycles });
});

// ─── SALARY SUMMARY ───────────────────────────────────────────────────────────
// Reads from latest locked/disbursed PayrollCycle + PayrollEntry records
reportRouter.get('/salary-summary', requireSuperAdmin, async (_req, res) => {
  const latestCycle = await prisma.payrollCycle.findFirst({
    where: { status: { in: ['LOCKED', 'DISBURSED'] } },
    orderBy: { cycleStart: 'desc' },
  });

  if (!latestCycle) {
    return res.json({
      success: true,
      data: {
        employeeCount: 0,
        totalGross: 0,
        totalEmployeePf: 0,
        totalEmployerPf: 0,
        totalEmployeeEsi: 0,
        totalEmployerEsi: 0,
        totalNet: 0,
        payrollMonth: null,
        note: 'No locked payroll cycle found',
      },
    });
  }

  const agg = await prisma.payrollEntry.aggregate({
    where: { cycleId: latestCycle.id },
    _sum: {
      grossSalary: true,
      netSalary:   true,
      pfAmount:    true,
      esiAmount:   true,
    },
    _count: { id: true },
  });

  // Employer PF: 12% of Basic, capped at 1800 per employee — compute from entries
  const entries = await prisma.payrollEntry.findMany({
    where: { cycleId: latestCycle.id },
    select: { basic: true, pfAmount: true, esiAmount: true },
  });

  let totalEmployerPf  = 0;
  let totalEmployerEsi = 0;
  for (const e of entries) {
    const basic = Number(e.basic);
    totalEmployerPf  += Math.min(Math.round(basic * 0.12), 1800);
    // ESI employer: 3.25% of gross — approximate from esiAmount (employee = 0.75%)
    // if employee ESI > 0, employer = employee * (3.25/0.75)
    const empEsi = Number(e.esiAmount);
    if (empEsi > 0) totalEmployerEsi += Math.round(empEsi * (3.25 / 0.75));
  }

  res.json({
    success: true,
    data: {
      payrollMonth:     latestCycle.payrollMonth,
      employeeCount:    latestCycle.employeeCount ?? agg._count.id,
      totalGross:       Math.round(Number(agg._sum.grossSalary ?? 0)),
      totalNet:         Math.round(Number(agg._sum.netSalary   ?? 0)),
      totalEmployeePf:  Math.round(Number(agg._sum.pfAmount    ?? 0)),
      totalEmployerPf,
      totalEmployeeEsi: Math.round(Number(agg._sum.esiAmount   ?? 0)),
      totalEmployerEsi,
    },
  });
});
