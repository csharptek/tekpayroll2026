import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { createAuditLog } from '../middleware/audit';
import { AuditAction } from '@prisma/client';

export const authRouter = Router();

// GET /api/auth/me — returns current user info
authRouter.get('/me', authenticate, async (req, res) => {
  res.json({ success: true, user: req.user });
});

// POST /api/auth/logout
authRouter.post('/logout', authenticate, async (req, res) => {
  await createAuditLog({
    user: req.user!,
    action: AuditAction.LOGOUT,
    description: `${req.user!.name} logged out`,
  });
  res.json({ success: true, message: 'Logged out successfully' });
});

// GET /api/auth/dev-roles — only available in dev mode
authRouter.get('/dev-roles', (_req, res) => {
  if (process.env.DEV_AUTH_BYPASS !== 'true' || process.env.NODE_ENV === 'production') {
    return res.status(404).json({ error: 'Not found' });
  }
  res.json({
    available: ['SUPER_ADMIN', 'HR', 'MANAGEMENT', 'EMPLOYEE'],
    note: 'Dev bypass is active. Set DEV_AUTH_BYPASS=false to disable.',
  });
});
