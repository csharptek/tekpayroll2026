import { Router } from 'express';
import { authenticate, requireHR } from '../middleware/auth';

export const importRouter = Router();
importRouter.use(authenticate, requireHR);

importRouter.get('/template', async (_req, res) => {
  // Stub — Excel template generation in Stage 5
  res.json({ success: true, message: 'Bulk import template — implemented in Stage 5' });
});

importRouter.post('/employees', async (_req, res) => {
  res.json({ success: true, message: 'Bulk import — implemented in Stage 5' });
});
