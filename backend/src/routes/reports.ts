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
  // Prefer active cycle (DRAFT/CALCULATED/LOCKED), fall back to last DISBURSED
  let activeCycle = await prisma.payrollCycle.findFirst({
    where: { status: { in: ['DRAFT', 'CALCULATED', 'LOCKED'] } },
    orderBy: { cycleStart: 'desc' },
  });

  if (!activeCycle) {
    activeCycle = await prisma.payrollCycle.findFirst({
      where: { status: 'DISBURSED' },
      orderBy: { cycleStart: 'desc' },
    });
  }

  if (!activeCycle) {
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
        cycleStatus: null,
        note: 'No payroll cycle found',
      },
    });
  }

  const agg = await prisma.payrollEntry.aggregate({
    where: { cycleId: activeCycle.id },
    _sum: {
      grossSalary: true,
      netSalary:   true,
      pfAmount:    true,
      esiAmount:   true,
    },
    _count: { id: true },
  });

  const entries = await prisma.payrollEntry.findMany({
    where: { cycleId: activeCycle.id },
    select: { basic: true, pfAmount: true, esiAmount: true, employerPfAmount: true, employerEsiAmount: true },
  });

  let totalEmployerPf  = 0;
  let totalEmployerEsi = 0;
  for (const e of entries) {
    // Use stored employer amounts if available, else compute
    if (Number((e as any).employerPfAmount) > 0) {
      totalEmployerPf  += Number((e as any).employerPfAmount);
    } else {
      totalEmployerPf  += Math.min(Math.round(Number(e.basic) * 0.12), 1800);
    }
    if (Number((e as any).employerEsiAmount) > 0) {
      totalEmployerEsi += Number((e as any).employerEsiAmount);
    } else {
      const empEsi = Number(e.esiAmount);
      if (empEsi > 0) totalEmployerEsi += Math.round(empEsi * (3.25 / 0.75));
    }
  }

  res.json({
    success: true,
    data: {
      payrollMonth:     activeCycle.payrollMonth,
      cycleStatus:      activeCycle.status,
      employeeCount:    activeCycle.employeeCount ?? agg._count.id,
      totalGross:       Math.round(Number(agg._sum.grossSalary ?? 0)),
      totalNet:         Math.round(Number(agg._sum.netSalary   ?? 0)),
      totalEmployeePf:  Math.round(Number(agg._sum.pfAmount    ?? 0)),
      totalEmployerPf:  Math.round(totalEmployerPf),
      totalEmployeeEsi: Math.round(Number(agg._sum.esiAmount   ?? 0)),
      totalEmployerEsi: Math.round(totalEmployerEsi),
    },
  });
});
