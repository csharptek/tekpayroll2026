import { Router } from 'express';
import { authenticate, requireHR, requireSuperAdmin } from '../middleware/auth';
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

  // Super Admin only keys
  const superAdminKeys = [
    'GRAPH_TENANT_ID', 'GRAPH_CLIENT_ID', 'GRAPH_CLIENT_SECRET', 'GRAPH_SENDER_EMAIL',
    'NOTICE_DAYS_RESIGNED', 'NOTICE_DAYS_TERMINATED', 'NOTICE_DAYS_ABSCONDED',
  ]

  for (const [key, value] of Object.entries(updates)) {
    if (superAdminKeys.includes(key) && req.user!.role !== 'SUPER_ADMIN') continue
    await prisma.systemConfig.upsert({
      where:  { key },
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

// Test Graph API email config
configRouter.post('/test-email', requireSuperAdmin, async (req, res) => {
  const { toEmail } = req.body
  if (!toEmail) return res.status(400).json({ success: false, error: 'toEmail required' })
  const { sendEmail } = await import('../services/emailService')
  await sendEmail(toEmail, 'TekPayroll — Email Config Test', '<p>Your email configuration is working correctly.</p>')
  res.json({ success: true, message: 'Test email sent' })
})
