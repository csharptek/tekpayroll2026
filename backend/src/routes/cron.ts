import { Router } from 'express'
import { cronRunPayroll, cronGeneratePayslips, cronSyncEntraId, cronSendHolidayGreetings } from '../services/cronJobs'
import { prisma } from '../utils/prisma'
import { authenticate, requireSuperAdmin } from '../middleware/auth'
import { migrateAllSalarySnapshots } from '../services/salarySnapshot'

export const cronRouter = Router()

// All /manual/* and /logs routes require authentication
cronRouter.use('/manual', authenticate)
cronRouter.use('/logs', authenticate)

function verifyCronSecret(req: any, res: any, next: any) {
  const secret = req.headers['x-cron-secret']
  const expected = process.env.CRON_SECRET
  if (process.env.NODE_ENV !== 'production') return next()
  if (!expected || secret !== expected) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  next()
}

// ─── EXTERNAL SCHEDULER ENDPOINTS ────────────────────────────────────────────

cronRouter.post('/run-payroll', verifyCronSecret, async (_req, res) => {
  await cronRunPayroll('cron')
  res.json({ success: true })
})

cronRouter.post('/generate-payslips', verifyCronSecret, async (_req, res) => {
  await cronGeneratePayslips('cron')
  res.json({ success: true })
})

cronRouter.post('/sync-entra', verifyCronSecret, async (_req, res) => {
  await cronSyncEntraId('cron')
  res.json({ success: true })
})

cronRouter.post('/holiday-greetings', verifyCronSecret, async (_req, res) => {
  await cronSendHolidayGreetings('cron')
  res.json({ success: true })
})

// ─── MANUAL TRIGGER ENDPOINTS (Super Admin UI) ───────────────────────────────

cronRouter.post('/manual/run-payroll', requireSuperAdmin, async (_req, res) => {
  await cronRunPayroll('manual')
  res.json({ success: true })
})

cronRouter.post('/manual/generate-payslips', requireSuperAdmin, async (_req, res) => {
  await cronGeneratePayslips('manual')
  res.json({ success: true })
})

cronRouter.post('/manual/sync-entra', requireSuperAdmin, async (_req, res) => {
  await cronSyncEntraId('manual')
  res.json({ success: true })
})

cronRouter.post('/manual/holiday-greetings', requireSuperAdmin, async (_req, res) => {
  await cronSendHolidayGreetings('manual')
  res.json({ success: true })
})

// ─── SALARY STRUCTURE MIGRATION ──────────────────────────────────────────────

cronRouter.post('/manual/migrate-salary-snapshots', requireSuperAdmin, async (req: any, res) => {
  try {
    const computedBy = req.employee?.id || 'system'
    const result = await migrateAllSalarySnapshots(computedBy)
    res.json({ success: true, data: result })
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message })
  }
})

// ─── CRON LOGS ────────────────────────────────────────────────────────────────

cronRouter.get('/logs', requireSuperAdmin, async (req, res) => {
  const { jobName, status, page = '1', limit = '50' } = req.query as any

  const where: any = {}
  if (jobName) where.jobName = jobName
  if (status)  where.status  = status

  const skip = (parseInt(page) - 1) * parseInt(limit)

  const [logs, total] = await Promise.all([
    prisma.cronLog.findMany({
      where,
      orderBy: { startedAt: 'desc' },
      skip,
      take: parseInt(limit),
    }),
    prisma.cronLog.count({ where }),
  ])

  res.json({ logs, total, page: parseInt(page), limit: parseInt(limit) })
})
