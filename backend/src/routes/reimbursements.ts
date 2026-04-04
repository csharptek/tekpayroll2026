import { Router } from 'express';
import { authenticate, requireHR } from '../middleware/auth';
import { prisma } from '../utils/prisma';

export const reimbursementRouter = Router();
reimbursementRouter.use(authenticate, requireHR);

reimbursementRouter.get('/:cycleId', async (req, res) => {
  const items = await prisma.reimbursement.findMany({
    where: { cycleId: req.params.cycleId },
    include: { employee: { select: { name: true, employeeCode: true } } },
  });
  res.json({ success: true, data: items });
});

reimbursementRouter.post('/', async (req, res) => {
  const { cycleId, employeeId, category, amount, notes } = req.body;
  const item = await prisma.reimbursement.create({
    data: { cycleId, employeeId, category, amount, notes, addedBy: req.user!.id, addedByName: req.user!.name },
  });
  res.json({ success: true, data: item });
});

reimbursementRouter.delete('/:id', async (req, res) => {
  await prisma.reimbursement.delete({ where: { id: req.params.id } });
  res.json({ success: true });
});
