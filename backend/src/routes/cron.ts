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

// ─── ASSET CATEGORY SEED ──────────────────────────────────────────────────────

cronRouter.post('/manual/seed-asset-categories', requireSuperAdmin, async (_req, res) => {
  try {
    const SEED: { name: string; type: 'IT' | 'PHYSICAL'; subs: string[] }[] = [
      {
        name: 'IT Assets', type: 'IT',
        subs: ['Laptop', 'Desktop', 'Monitor', 'Keyboard', 'Mouse', 'Headphone', 'Webcam',
               'CPU', 'Hard Disk', 'SSD', 'USB Cable', 'USB Wifi Dongle', 'Printer',
               'Scanner', 'Router', 'Switch', 'Server', 'UPS', 'Projector'],
      },
      {
        name: 'Mobile Devices', type: 'IT',
        subs: ['Phone', 'Tablet', 'iPod', 'SIM Card', 'Power Bank'],
      },
      {
        name: 'Software Licenses', type: 'IT',
        subs: ['OS License', 'Office Suite', 'Antivirus', 'IDE License'],
      },
      {
        name: 'Furniture', type: 'PHYSICAL',
        subs: ['Chair', 'Desk', 'Cabinet', 'Locker', 'Sofa', 'Whiteboard'],
      },
      {
        name: 'Office Equipment', type: 'PHYSICAL',
        subs: ['Telephone', 'Stapler', 'Shredder', 'Calculator', 'AC', 'Refrigerator',
               'Microwave', 'Water Dispenser'],
      },
      {
        name: 'Stationery', type: 'PHYSICAL',
        subs: ['Notebook', 'Pen Set', 'File Organizer'],
      },
      {
        name: 'Vehicles', type: 'PHYSICAL',
        subs: ['Car', 'Bike', 'Scooter'],
      },
      {
        name: 'Access & Security', type: 'PHYSICAL',
        subs: ['ID Card', 'Access Card', 'Key', 'CCTV Camera'],
      },
    ]

    let catCreated = 0, catSkipped = 0, subCreated = 0, subSkipped = 0

    for (const c of SEED) {
      const existingCat = await prisma.assetCategoryConfig.findUnique({
        where: { name_type: { name: c.name, type: c.type } },
      })
      let catId: string
      if (existingCat) {
        catId = existingCat.id
        catSkipped++
      } else {
        const created = await prisma.assetCategoryConfig.create({
          data: { name: c.name, type: c.type, isActive: true },
        })
        catId = created.id
        catCreated++
      }
      for (const s of c.subs) {
        const existingSub = await prisma.assetSubCategoryConfig.findUnique({
          where: { name_categoryId: { name: s, categoryId: catId } },
        })
        if (existingSub) { subSkipped++; continue }
        await prisma.assetSubCategoryConfig.create({
          data: { name: s, categoryId: catId, isActive: true },
        })
        subCreated++
      }
    }

    res.json({
      success: true,
      data: {
        total: SEED.length,
        success: catCreated + subCreated,
        failed: 0,
        catCreated, catSkipped, subCreated, subSkipped,
      },
    })
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
