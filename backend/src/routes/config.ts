import { Router } from 'express';
import { authenticate, requireHR, requireSuperAdmin } from '../middleware/auth';
import { prisma } from '../utils/prisma';

export const configRouter = Router();
configRouter.use(authenticate);

configRouter.get('/', async (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const config = await prisma.systemConfig.findMany();
  const map = Object.fromEntries(config.map(c => [c.key, c.value]));
  res.json({ success: true, data: map });
});

configRouter.put('/', requireHR, async (req, res) => {
  const updates = req.body as Record<string, string>;

  // Super Admin only keys
  const superAdminKeysExact = [
    'GRAPH_TENANT_ID', 'GRAPH_CLIENT_ID', 'GRAPH_CLIENT_SECRET', 'GRAPH_SENDER_EMAIL',
    'NOTICE_DAYS_RESIGNED', 'NOTICE_DAYS_TERMINATED', 'NOTICE_DAYS_ABSCONDED',
  ]
  const isSuperAdminKey = (key: string) =>
    superAdminKeysExact.includes(key) || key.startsWith('NOTIF_')

  for (const [key, value] of Object.entries(updates)) {
    if (isSuperAdminKey(key) && req.user!.role !== 'SUPER_ADMIN') continue
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

// Test notification — sends a preview email to chosen recipients
configRouter.post('/test-notification', requireSuperAdmin, async (req, res) => {
  const { type, toEmail } = req.body as { type: string; toEmail: string }
  if (!type || !toEmail) return res.status(400).json({ success: false, error: 'type and toEmail required' })
  const { sendEmailWithCc, emailWrap } = await import('../services/emailService')
  const html = emailWrap(`<h2 style="color:#0284c7;margin:0 0 16px">Test Notification — ${type}</h2><p style="color:#475569">This is a test of the <strong>${type}</strong> notification template. If you received this, routing is working.</p>`)
  await sendEmailWithCc(toEmail, [], `TekPayroll — Test: ${type}`, html)
  res.json({ success: true })
})
