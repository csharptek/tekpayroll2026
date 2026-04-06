import { Router } from 'express'
import { cronRunPayroll, cronGeneratePayslips, cronSyncEntraId, cronSendHolidayGreetings, cronLeaveRolloverReminder, cronLwdReminder } from '../services/cronJobs'

export const cronRouter = Router()

function verifyCronSecret(req: any, res: any, next: any) {
  const secret = req.headers['x-cron-secret']
  const expected = process.env.CRON_SECRET
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

// POST /api/cron/holiday-greetings → runs daily at 08:00
cronRouter.post('/holiday-greetings', verifyCronSecret, async (_req, res) => {
  console.log('[CRON ENDPOINT] holiday-greetings triggered')
  await cronSendHolidayGreetings()
  res.json({ success: true, message: 'Holiday greetings processed' })
})

// POST /api/cron/rollover-reminder → runs daily at 09:00 (fires only on Dec 25)
cronRouter.post('/rollover-reminder', verifyCronSecret, async (_req, res) => {
  console.log('[CRON ENDPOINT] rollover-reminder triggered')
  await cronLeaveRolloverReminder()
  res.json({ success: true, message: 'Rollover reminder processed' })
})

// POST /api/cron/lwd-reminder → runs daily
cronRouter.post('/lwd-reminder', verifyCronSecret, async (_req, res) => {
  console.log('[CRON ENDPOINT] lwd-reminder triggered')
  await cronLwdReminder()
  res.json({ success: true, message: 'LWD reminders processed' })
})
