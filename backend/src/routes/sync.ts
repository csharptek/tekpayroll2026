import { Router } from 'express';
import { authenticate, requireHR } from '../middleware/auth';

export const syncRouter = Router();
syncRouter.use(authenticate, requireHR);

syncRouter.post('/trigger', async (_req, res) => {
  // Stub — real Graph API sync wired in Stage 16
  res.json({ success: true, message: 'Graph API sync stub — real integration in Stage 16' });
});

syncRouter.get('/logs', async (_req, res) => {
  const { prisma } = await import('../utils/prisma');
  const logs = await prisma.syncLog.findMany({ orderBy: { startedAt: 'desc' }, take: 20 });
  res.json({ success: true, data: logs });
});
