import { Router } from 'express';
import { authenticate, requireManagement, requireSuperAdmin } from '../middleware/auth';
import { prisma } from '../utils/prisma';
import { computeSalaryStructure, getEsiConfig } from '../services/payrollEngine';

export const reportRouter = Router();
reportRouter.use(authenticate, requireManagement);

reportRouter.get('/summary', async (_req, res) => {
  const [totalEmployees, lastCycle] = await Promise.all([
    prisma.employee.count({ where: { status: 'ACTIVE', skipPayroll: false } }),
    prisma.payrollCycle.findFirst({ orderBy: { cycleStart: 'desc' } }),
  ]);
  res.json({ success: true, data: { totalEmployees, lastCycle } });
});

reportRouter.get('/payroll-trend', async (_req, res) => {
  const cycles = await prisma.payrollCycle.findMany({
    where: { status: { in: ['LOCKED', 'DISBURSED'] } },
    orderBy: { cycleStart: 'asc' },
    take: 12,
    select: { payrollMonth: true, totalNet: true, totalGross: true, employeeCount: true },
  });
  res.json({ success: true, data: cycles });
});

// Tentative monthly salary summary — SUPER_ADMIN only
// Includes ACTIVE + ON_NOTICE + SEPARATED employees (all who were/are on payroll)
reportRouter.get('/salary-summary', requireSuperAdmin, async (_req, res) => {
  const esiConfig = await getEsiConfig();

  const employees = await prisma.employee.findMany({
    where: { status: { in: ['ACTIVE', 'ON_NOTICE', 'SEPARATED'] }, skipPayroll: false },
    select: {
      annualCtc: true,
      basicPercent: true,
      hraPercent: true,
      transportMonthly: true,
      fbpMonthly: true,
      mediclaim: true,
      hasIncentive: true,
      incentivePercent: true,
    },
  });

  let totalGross = 0;
  let totalEmployeePf = 0;
  let totalEmployerPf = 0;
  let totalEmployeeEsi = 0;
  let totalEmployerEsi = 0;

  for (const emp of employees) {
    const s = computeSalaryStructure({
      annualCtc: Number(emp.annualCtc),
      basicPercent: Number(emp.basicPercent),
      hraPercent: Number(emp.hraPercent),
      transportMonthly: emp.transportMonthly != null ? Number(emp.transportMonthly) : null,
      fbpMonthly: emp.fbpMonthly != null ? Number(emp.fbpMonthly) : null,
      mediclaim: Number(emp.mediclaim),
      hasIncentive: emp.hasIncentive,
      incentivePercent: Number(emp.incentivePercent),
    }, esiConfig);

    totalGross += s.grandTotalMonthly;
    totalEmployeePf += s.employeePfMonthly;
    totalEmployerPf += s.employerPfMonthly;
    totalEmployeeEsi += s.employeeEsiMonthly;
    totalEmployerEsi += s.employerEsiMonthly;
  }

  const totalNet = totalGross - totalEmployeePf - totalEmployeeEsi;

  res.json({
    success: true,
    data: {
      employeeCount: employees.length,
      totalGross: Math.round(totalGross),
      totalEmployeePf: Math.round(totalEmployeePf),
      totalEmployerPf: Math.round(totalEmployerPf),
      totalEmployeeEsi: Math.round(totalEmployeeEsi),
      totalEmployerEsi: Math.round(totalEmployerEsi),
      totalNet: Math.round(totalNet),
    },
  });
});
