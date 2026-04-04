import { Router } from 'express';
import { authenticate, requireHR } from '../middleware/auth';
import { prisma } from '../utils/prisma';

export const configRouter = Router();
configRouter.use(authenticate);

configRouter.get('/', async (_req, res) => {
  const config = await prisma.systemConfig.findMany();
  const map = Object.fromEntries(config.map(c => [c.key, c.value]));
  res.json({ success: true, data: map });
});

configRouter.put('/', requireHR, async (req, res) => {
  const updates = req.body as Record<string, string>;
  for (const [key, value] of Object.entries(updates)) {
    await prisma.systemConfig.upsert({
      where: { key },
      create: { key, value, updatedBy: req.user!.id },
      update: { value, updatedBy: req.user!.id },
    });
  }
  res.json({ success: true });
});

configRouter.get('/pt-slabs', async (_req, res) => {
  const slabs = await prisma.ptSlab.findMany({ orderBy: [{ state: 'asc' }, { minSalary: 'asc' }] });
  res.json({ success: true, data: slabs });
});
