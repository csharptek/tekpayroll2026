import { Router } from 'express'
import { authenticate, requireHR } from '../middleware/auth'
import { prisma } from '../utils/prisma'
import {
  fetchVerifiedDomains,
  fetchPreview,
  importSelected,
  pushToEntra,
} from '../services/graphSyncService'

export const syncRouter = Router()
syncRouter.use(authenticate, requireHR)

// GET /api/sync/domains — pull verified domains from Entra ID
syncRouter.get('/domains', async (_req, res) => {
  const domains = await fetchVerifiedDomains()
  res.json({ success: true, data: domains })
})

// GET /api/sync/domain-config — get saved domain selections
syncRouter.get('/domain-config', async (_req, res) => {
  const configs = await prisma.syncDomainConfig.findMany()
  res.json({ success: true, data: configs })
})

// PUT /api/sync/domain-config — save domain selections
syncRouter.put('/domain-config', async (req, res) => {
  const { domains } = req.body as { domains: { name: string; isEnabled: boolean }[] }
  for (const d of domains) {
    await prisma.syncDomainConfig.upsert({
      where:  { domain: d.name },
      update: { isEnabled: d.isEnabled },
      create: { domain: d.name, isEnabled: d.isEnabled },
    })
  }
  res.json({ success: true })
})

// POST /api/sync/preview — fetch users from selected domains, return preview
syncRouter.post('/preview', async (req, res) => {
  const { domains } = req.body as { domains: string[] }
  if (!domains?.length) {
    return res.status(400).json({ success: false, error: 'No domains selected' })
  }
  const preview = await fetchPreview(domains)
  res.json({ success: true, data: preview })
})

// POST /api/sync/import — import selected + edited rows into DB
syncRouter.post('/import', async (req, res) => {
  const { rows } = req.body
  if (!rows?.length) {
    return res.status(400).json({ success: false, error: 'No rows to import' })
  }

  const startedAt = new Date()
  const result    = await importSelected(rows, req.user!.id)

  await prisma.syncLog.create({
    data: {
      syncType:        'MANUAL',
      triggeredBy:     req.user!.id,
      triggeredByName: req.user!.name,
      status:          result.errors.length > 0 ? 'partial' : 'success',
      recordsAdded:    result.added,
      recordsUpdated:  result.updated,
      errorDetails:    result.errors.length > 0 ? result.errors : undefined,
      startedAt,
      completedAt:     new Date(),
    },
  })

  res.json({
    success: true,
    data: result,
    message: `${result.added} added, ${result.updated} updated${result.errors.length > 0 ? `, ${result.errors.length} errors` : ''}`,
  })
})

// POST /api/sync/push-to-entra — writeback DB → Entra ID
syncRouter.post('/push-to-entra', async (req, res) => {
  const { employeeIds } = req.body as { employeeIds: string[] }
  if (!employeeIds?.length) {
    return res.status(400).json({ success: false, error: 'No employees selected' })
  }

  const result = await pushToEntra(employeeIds)
  res.json({
    success: true,
    data: result,
    message: `${result.success} updated in Entra ID${result.failed > 0 ? `, ${result.failed} failed` : ''}`,
  })
})

// GET /api/sync/logs
syncRouter.get('/logs', async (_req, res) => {
  const logs = await prisma.syncLog.findMany({ orderBy: { startedAt: 'desc' }, take: 30 })
  res.json({ success: true, data: logs })
})

// GET /api/sync/test - quick connectivity test
syncRouter.get('/test', async (_req, res) => {
  try {
    const domains = await fetchVerifiedDomains()
    res.json({ success: true, count: domains.length, domains: domains.map(d => d.name) })
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message })
  }
})
