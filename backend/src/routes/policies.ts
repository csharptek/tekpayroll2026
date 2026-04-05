import { Router } from 'express'
import { authenticate, requireSuperAdmin } from '../middleware/auth'
import { prisma } from '../utils/prisma'
import { AppError } from '../middleware/errorHandler'

export const policiesRouter = Router()
policiesRouter.use(authenticate)

// GET /api/policies — all authenticated users
policiesRouter.get('/', async (_req, res) => {
  const policies = await prisma.companyPolicy.findMany({
    where: { isActive: true },
    orderBy: { sortOrder: 'asc' },
  })
  res.json({ success: true, data: policies })
})

// POST /api/policies — SUPER_ADMIN only
policiesRouter.post('/', requireSuperAdmin, async (req, res) => {
  const { title, content } = req.body
  if (!title?.trim()) throw new AppError('Title is required', 400)
  if (!content?.trim()) throw new AppError('Content is required', 400)

  const last = await prisma.companyPolicy.findFirst({ orderBy: { sortOrder: 'desc' } })
  const sortOrder = (last?.sortOrder ?? -1) + 1

  const policy = await prisma.companyPolicy.create({
    data: { title: title.trim(), content, sortOrder },
  })
  res.status(201).json({ success: true, data: policy })
})

// PUT /api/policies/reorder — SUPER_ADMIN only
policiesRouter.put('/reorder', requireSuperAdmin, async (req, res) => {
  const { ids } = req.body as { ids: string[] }
  if (!Array.isArray(ids)) throw new AppError('ids must be an array', 400)

  await Promise.all(
    ids.map((id, idx) =>
      prisma.companyPolicy.update({ where: { id }, data: { sortOrder: idx } })
    )
  )
  res.json({ success: true })
})

// PUT /api/policies/:id — SUPER_ADMIN only
policiesRouter.put('/:id', requireSuperAdmin, async (req, res) => {
  const { title, content } = req.body
  const existing = await prisma.companyPolicy.findUnique({ where: { id: req.params.id } })
  if (!existing) throw new AppError('Policy not found', 404)

  const policy = await prisma.companyPolicy.update({
    where: { id: req.params.id },
    data: {
      ...(title !== undefined && { title: title.trim() }),
      ...(content !== undefined && { content }),
    },
  })
  res.json({ success: true, data: policy })
})

// DELETE /api/policies/:id — SUPER_ADMIN only
policiesRouter.delete('/:id', requireSuperAdmin, async (req, res) => {
  const existing = await prisma.companyPolicy.findUnique({ where: { id: req.params.id } })
  if (!existing) throw new AppError('Policy not found', 404)
  await prisma.companyPolicy.delete({ where: { id: req.params.id } })
  res.json({ success: true })
})
