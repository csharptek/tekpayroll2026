import { Router } from 'express';
import { authenticate, requireManagement } from '../middleware/auth';
import { prisma } from '../utils/prisma';

export const reportRouter = Router();
reportRouter.use(authenticate, requireManagement);

reportRouter.get('/summary', async (_req, res) => {
  const [totalEmployees, lastCycle] = await Promise.all([
    prisma.employee.count({ where: { status: 'ACTIVE' } }),
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
