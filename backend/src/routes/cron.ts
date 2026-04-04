import { Router } from 'express'
import { cronRunPayroll, cronGeneratePayslips, cronSyncEntraId } from '../services/cronJobs'

export const cronRouter = Router()

// These endpoints are called by Railway Cron on schedule.
// They are protected by a shared secret header.
function verifyCronSecret(req: any, res: any, next: any) {
  const secret = req.headers['x-cron-secret']
  const expected = process.env.CRON_SECRET

  // In dev, allow without secret
  if (process.env.NODE_ENV !== 'production') return next()

  if (!expected || secret !== expected) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  next()
}

// POST /api/cron/run-payroll  → runs on 27th
cronRouter.post('/run-payroll', verifyCronSecret, async (_req, res) => {
  console.log('[CRON ENDPOINT] run-payroll triggered')
  await cronRunPayroll()
  res.json({ success: true, message: 'Payroll run complete' })
})

// POST /api/cron/generate-payslips → runs on 5th
cronRouter.post('/generate-payslips', verifyCronSecret, async (_req, res) => {
  console.log('[CRON ENDPOINT] generate-payslips triggered')
  await cronGeneratePayslips()
  res.json({ success: true, message: 'Payslip generation complete' })
})

// POST /api/cron/sync-entra → runs daily at 02:00
cronRouter.post('/sync-entra', verifyCronSecret, async (_req, res) => {
  console.log('[CRON ENDPOINT] sync-entra triggered')
  await cronSyncEntraId()
  res.json({ success: true, message: 'Entra sync complete' })
})
