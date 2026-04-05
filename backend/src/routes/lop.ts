import { Router } from 'express';
import { authenticate, requireSuperAdmin } from '../middleware/auth';
import { prisma } from '../utils/prisma';
import { AppError } from '../middleware/errorHandler';

export const lopRouter = Router();
lopRouter.use(authenticate, requireSuperAdmin);

lopRouter.get('/:cycleId', async (req, res) => {
  const entries = await prisma.lopEntry.findMany({
    where: { cycleId: req.params.cycleId },
    include: { employee: { select: { id: true, name: true, employeeCode: true } } },
  });
  res.json({ success: true, data: entries });
});

lopRouter.post('/', async (req, res) => {
  const { cycleId, employeeId, lopDays, reason } = req.body;
  const cycle = await prisma.payrollCycle.findUnique({ where: { id: cycleId } });
  if (!cycle) throw new AppError('Cycle not found', 404);
  if (cycle.status === 'LOCKED' || cycle.status === 'DISBURSED') throw new AppError('Cycle is locked', 400);

  const entry = await prisma.lopEntry.upsert({
    where: { cycleId_employeeId: { cycleId, employeeId } },
    create: { cycleId, employeeId, lopDays, reason, approvedBy: req.user!.id, approvedByName: req.user!.name, approvedAt: new Date() },
    update: { lopDays, reason, approvedBy: req.user!.id, approvedByName: req.user!.name, approvedAt: new Date() },
  });
  res.json({ success: true, data: entry });
});
