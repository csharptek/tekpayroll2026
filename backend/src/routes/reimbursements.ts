import { Router } from 'express'
import multer from 'multer'
import { authenticate, requireSuperAdmin } from '../middleware/auth'
import { prisma } from '../utils/prisma'
import { AppError } from '../middleware/errorHandler'
import { createAuditLog } from '../middleware/audit'
import { AuditAction, UserRole } from '@prisma/client'
import {
  uploadReimbursementFile,
  deleteReimbursementFile,
  refreshReimbursementSasUrl,
} from '../utils/reimbursementBlob'

export const reimbursementRouter = Router()
reimbursementRouter.use(authenticate)

const MAX_FILES     = 5
const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB

const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: MAX_FILE_SIZE, files: MAX_FILES },
  fileFilter: (_req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf']
    cb(null, allowed.includes(file.mimetype))
  },
})

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function isSA(req: any)  { return req.user?.role === UserRole.SUPER_ADMIN }
function isHR(req: any)  { return req.user?.role === UserRole.HR }

// Strip file list if viewer is HR (HR cannot view bills).
function stripFilesForHR(reimb: any, req: any) {
  if (isHR(req)) {
    return { ...reimb, files: [], filesRedacted: true }
  }
  return reimb
}

function canViewReimbursement(req: any, reimb: { employeeId: string }) {
  if (isSA(req)) return true
  if (isHR(req)) return true // HR can see list/amount/status, not files.
  return reimb.employeeId === req.user!.id
}

function canViewFiles(req: any, reimb: { employeeId: string }) {
  if (isSA(req)) return true
  if (reimb.employeeId === req.user!.id) return true
  return false
}

// ─── EMPLOYEE SELF-SERVICE ───────────────────────────────────────────────────

// Employee creates a reimbursement request (with up to 5 files).
reimbursementRouter.post('/request', upload.array('files', MAX_FILES), async (req, res) => {
  const { category, amount, expenseDate, description } = req.body
  if (!category) throw new AppError('Category is required', 400)
  const amt = Number(amount)
  if (!amt || amt <= 0) throw new AppError('Amount must be > 0', 400)

  const files = (req.files as any[]) || []
  if (files.length > MAX_FILES) throw new AppError(`Maximum ${MAX_FILES} files allowed`, 400)

  const emp = await prisma.employee.findUnique({
    where:  { id: req.user!.id },
    select: { employeeCode: true, name: true },
  })
  if (!emp) throw new AppError('Employee not found', 404)

  const reimb = await prisma.reimbursement.create({
    data: {
      employeeId:      req.user!.id,
      category,
      amount:          amt,
      expenseDate:     expenseDate ? new Date(expenseDate) : undefined,
      description:     description || null,
      source:          'EMPLOYEE',
      status:          'PENDING',
      requestedBy:     req.user!.id,
      requestedByName: req.user!.name,
      addedBy:         req.user!.id,
      addedByName:     req.user!.name,
    },
  })

  for (const f of files) {
    const up = await uploadReimbursementFile(f.buffer, f.originalname, emp.employeeCode, emp.name)
    await prisma.reimbursementFile.create({
      data: {
        reimbursementId: reimb.id,
        fileName:        f.originalname,
        mimeType:        up.mimeType,
        sizeBytes:       up.sizeBytes,
        blobKey:         up.key,
        blobUrl:         up.url,
        uploadedBy:      req.user!.id,
      },
    })
  }

  await createAuditLog({
    user: req.user!,
    action: AuditAction.CREATE,
    recordId: reimb.id,
    targetEmployeeId: req.user!.id,
    description: `Reimbursement request submitted: ${category} ₹${amt}`,
  })

  const full = await prisma.reimbursement.findUnique({
    where: { id: reimb.id },
    include: { files: true },
  })
  res.status(201).json({ success: true, data: full })
})

// Employee's own list.
reimbursementRouter.get('/my', async (req, res) => {
  const items = await prisma.reimbursement.findMany({
    where: { employeeId: req.user!.id },
    include: {
      files: true,
      cycle: { select: { id: true, payrollMonth: true, status: true } },
    },
    orderBy: { createdAt: 'desc' },
  })
  // Employee always sees own files — refresh SAS for any stale URLs is handled client-side via detail fetch.
  res.json({ success: true, data: items })
})

// Employee can withdraw own request while PENDING.
reimbursementRouter.post('/:id/withdraw', async (req, res) => {
  const r = await prisma.reimbursement.findUnique({ where: { id: req.params.id }, include: { files: true } })
  if (!r) throw new AppError('Request not found', 404)
  if (r.employeeId !== req.user!.id) throw new AppError('Forbidden', 403)
  if (r.status !== 'PENDING') throw new AppError('Only pending requests can be withdrawn', 400)

  for (const f of r.files) {
    try { await deleteReimbursementFile(f.blobKey) } catch {}
  }
  await prisma.reimbursement.delete({ where: { id: r.id } })

  await createAuditLog({
    user: req.user!,
    action: AuditAction.DELETE,
    recordId: r.id,
    targetEmployeeId: r.employeeId,
    description: `Reimbursement request withdrawn: ${r.category} ₹${r.amount}`,
  })
  res.json({ success: true })
})

// ─── SHARED: LIST / DETAIL ───────────────────────────────────────────────────

// List (SA: all; HR: all minus files; Employee: own only via /my).
reimbursementRouter.get('/', async (req, res) => {
  if (!isSA(req) && !isHR(req)) throw new AppError('Forbidden', 403)

  const { status, cycleId, employeeId, source } = req.query as Record<string, string | undefined>
  const where: any = {}
  if (status)     where.status     = status
  if (cycleId)    where.cycleId    = cycleId
  if (employeeId) where.employeeId = employeeId
  if (source)     where.source     = source

  const items = await prisma.reimbursement.findMany({
    where,
    include: {
      employee: { select: { id: true, name: true, employeeCode: true, email: true } },
      cycle:    { select: { id: true, payrollMonth: true, status: true } },
      files:    isSA(req),
    },
    orderBy: { createdAt: 'desc' },
  })
  const out = isHR(req) ? items.map(i => stripFilesForHR(i, req)) : items
  res.json({ success: true, data: out })
})

// Detail.
reimbursementRouter.get('/:id', async (req, res) => {
  const r = await prisma.reimbursement.findUnique({
    where: { id: req.params.id },
    include: {
      employee: { select: { id: true, name: true, employeeCode: true, email: true } },
      cycle:    { select: { id: true, payrollMonth: true, status: true } },
      files:    true,
    },
  })
  if (!r) throw new AppError('Not found', 404)
  if (!canViewReimbursement(req, r)) throw new AppError('Forbidden', 403)

  // Refresh SAS URLs on read (3yr but safer).
  const files = canViewFiles(req, r)
    ? r.files.map(f => ({ ...f, blobUrl: refreshReimbursementSasUrl(f.blobKey) }))
    : []
  res.json({ success: true, data: { ...r, files, filesRedacted: !canViewFiles(req, r) } })
})

// ─── SA: OPEN CYCLES FOR DROPDOWN ────────────────────────────────────────────

reimbursementRouter.get('/cycles/open', requireSuperAdmin, async (_req, res) => {
  const cycles = await prisma.payrollCycle.findMany({
    where:  { status: { not: 'DISBURSED' } },
    select: { id: true, payrollMonth: true, status: true, cycleStart: true, cycleEnd: true },
    orderBy: { cycleStart: 'desc' },
  })
  res.json({ success: true, data: cycles })
})

// ─── SA: DIRECT ADD (no employee request) ────────────────────────────────────

reimbursementRouter.post('/sa/add', requireSuperAdmin, upload.array('files', MAX_FILES), async (req, res) => {
  const { employeeId, category, amount, expenseDate, description, notes, cycleId, payslipLabel, autoApprove } = req.body
  if (!employeeId) throw new AppError('employeeId required', 400)
  if (!category)   throw new AppError('Category required', 400)
  const amt = Number(amount)
  if (!amt || amt <= 0) throw new AppError('Amount must be > 0', 400)

  const emp = await prisma.employee.findUnique({
    where:  { id: employeeId },
    select: { id: true, employeeCode: true, name: true },
  })
  if (!emp) throw new AppError('Employee not found', 404)

  if (cycleId) {
    const c = await prisma.payrollCycle.findUnique({ where: { id: cycleId }, select: { status: true } })
    if (!c) throw new AppError('Cycle not found', 404)
    if (c.status === 'DISBURSED') throw new AppError('Cycle is disbursed — cannot attach', 400)
  }

  const approve = autoApprove === 'true' || autoApprove === true || !!cycleId

  const reimb = await prisma.reimbursement.create({
    data: {
      employeeId,
      category,
      amount:          amt,
      expenseDate:     expenseDate ? new Date(expenseDate) : undefined,
      description:     description || null,
      notes:           notes || null,
      source:          'SUPER_ADMIN',
      status:          approve ? 'APPROVED' : 'PENDING',
      payslipLabel:    payslipLabel || null,
      cycleId:         approve && cycleId ? cycleId : null,
      requestedBy:     req.user!.id,
      requestedByName: req.user!.name,
      addedBy:         req.user!.id,
      addedByName:     req.user!.name,
      ...(approve ? {
        approvedBy:     req.user!.id,
        approvedByName: req.user!.name,
        approvedAt:     new Date(),
      } : {}),
    },
  })

  const files = (req.files as any[]) || []
  for (const f of files) {
    const up = await uploadReimbursementFile(f.buffer, f.originalname, emp.employeeCode, emp.name)
    await prisma.reimbursementFile.create({
      data: {
        reimbursementId: reimb.id,
        fileName:        f.originalname,
        mimeType:        up.mimeType,
        sizeBytes:       up.sizeBytes,
        blobKey:         up.key,
        blobUrl:         up.url,
        uploadedBy:      req.user!.id,
      },
    })
  }

  await createAuditLog({
    user: req.user!,
    action: AuditAction.CREATE,
    recordId: reimb.id,
    targetEmployeeId: employeeId,
    description: `SA added reimbursement: ${category} ₹${amt}${approve ? ' (approved)' : ''}`,
  })

  if (approve) {
    try {
      const { sendReimbursementAddedEmail } = await import('../services/employeeNotifications')
      sendReimbursementAddedEmail(reimb.id).catch(e => console.error('[REIMB EMAIL]', e))
    } catch {}
  }

  const full = await prisma.reimbursement.findUnique({
    where: { id: reimb.id },
    include: { files: true },
  })
  res.status(201).json({ success: true, data: full })
})

// ─── SA: APPROVE ─────────────────────────────────────────────────────────────

reimbursementRouter.post('/:id/approve', requireSuperAdmin, async (req, res) => {
  const { cycleId, payslipLabel, amount } = req.body
  if (!cycleId)       throw new AppError('cycleId required', 400)
  if (!payslipLabel || !String(payslipLabel).trim()) throw new AppError('payslipLabel required', 400)

  const r = await prisma.reimbursement.findUnique({ where: { id: req.params.id } })
  if (!r) throw new AppError('Not found', 404)
  if (r.status !== 'PENDING') throw new AppError(`Cannot approve — status is ${r.status}`, 400)

  const cycle = await prisma.payrollCycle.findUnique({ where: { id: cycleId }, select: { status: true } })
  if (!cycle) throw new AppError('Cycle not found', 404)
  if (cycle.status === 'DISBURSED') throw new AppError('Cycle is disbursed', 400)

  const finalAmount = amount !== undefined ? Number(amount) : Number(r.amount)
  if (!finalAmount || finalAmount <= 0) throw new AppError('Invalid amount', 400)

  const updated = await prisma.reimbursement.update({
    where: { id: r.id },
    data: {
      status:         'APPROVED',
      cycleId,
      payslipLabel:   String(payslipLabel).trim(),
      amount:         finalAmount,
      approvedBy:     req.user!.id,
      approvedByName: req.user!.name,
      approvedAt:     new Date(),
    },
  })

  await createAuditLog({
    user: req.user!,
    action: AuditAction.UPDATE,
    recordId: r.id,
    targetEmployeeId: r.employeeId,
    description: `Reimbursement approved: ₹${finalAmount} cycle ${cycleId}`,
  })

  try {
    const { sendReimbursementAddedEmail } = await import('../services/employeeNotifications')
    sendReimbursementAddedEmail(r.id).catch(e => console.error('[REIMB EMAIL]', e))
  } catch {}

  res.json({ success: true, data: updated })
})

// ─── SA: REJECT ──────────────────────────────────────────────────────────────

reimbursementRouter.post('/:id/reject', requireSuperAdmin, async (req, res) => {
  const { reason } = req.body
  if (!reason) throw new AppError('Rejection reason required', 400)

  const r = await prisma.reimbursement.findUnique({ where: { id: req.params.id } })
  if (!r) throw new AppError('Not found', 404)
  if (r.status !== 'PENDING') throw new AppError(`Cannot reject — status is ${r.status}`, 400)

  const updated = await prisma.reimbursement.update({
    where: { id: r.id },
    data: {
      status:          'REJECTED',
      rejectedBy:      req.user!.id,
      rejectedByName:  req.user!.name,
      rejectedAt:      new Date(),
      rejectionReason: reason,
    },
  })
  await createAuditLog({
    user: req.user!,
    action: AuditAction.UPDATE,
    recordId: r.id,
    targetEmployeeId: r.employeeId,
    description: `Reimbursement rejected: ${reason}`,
  })
  res.json({ success: true, data: updated })
})

// ─── SA: UPDATE CYCLE / LABEL / AMOUNT (while APPROVED, cycle not disbursed) ─

reimbursementRouter.patch('/:id', requireSuperAdmin, async (req, res) => {
  const { cycleId, payslipLabel, amount, notes } = req.body
  const r = await prisma.reimbursement.findUnique({
    where: { id: req.params.id },
    include: { cycle: { select: { status: true } } },
  })
  if (!r) throw new AppError('Not found', 404)
  if (r.status === 'PAID') throw new AppError('Cannot edit a PAID reimbursement', 400)
  if (r.cycle?.status === 'DISBURSED') throw new AppError('Attached cycle is disbursed', 400)

  const data: any = {}
  if (cycleId !== undefined)      data.cycleId      = cycleId || null
  if (payslipLabel !== undefined) data.payslipLabel = payslipLabel || null
  if (notes !== undefined)        data.notes        = notes || null
  if (amount !== undefined) {
    const a = Number(amount)
    if (!a || a <= 0) throw new AppError('Invalid amount', 400)
    data.amount = a
  }

  if (cycleId) {
    const c = await prisma.payrollCycle.findUnique({ where: { id: cycleId }, select: { status: true } })
    if (!c) throw new AppError('Cycle not found', 404)
    if (c.status === 'DISBURSED') throw new AppError('Cycle is disbursed', 400)
  }

  const updated = await prisma.reimbursement.update({ where: { id: r.id }, data })
  await createAuditLog({
    user: req.user!,
    action: AuditAction.UPDATE,
    recordId: r.id,
    targetEmployeeId: r.employeeId,
    description: `Reimbursement updated`,
  })
  res.json({ success: true, data: updated })
})

// ─── SA: DELETE ──────────────────────────────────────────────────────────────

reimbursementRouter.delete('/:id', requireSuperAdmin, async (req, res) => {
  const r = await prisma.reimbursement.findUnique({
    where: { id: req.params.id },
    include: { files: true, cycle: { select: { status: true } } },
  })
  if (!r) throw new AppError('Not found', 404)
  if (r.cycle?.status === 'DISBURSED') throw new AppError('Cycle disbursed — cannot delete', 400)

  for (const f of r.files) {
    try { await deleteReimbursementFile(f.blobKey) } catch {}
  }
  await prisma.reimbursement.delete({ where: { id: r.id } })
  await createAuditLog({
    user: req.user!,
    action: AuditAction.DELETE,
    recordId: r.id,
    targetEmployeeId: r.employeeId,
    description: `Reimbursement deleted`,
  })
  res.json({ success: true })
})

// ─── FILES: ADD MORE (request owner or SA) ───────────────────────────────────

reimbursementRouter.post('/:id/files', upload.array('files', MAX_FILES), async (req, res) => {
  const r = await prisma.reimbursement.findUnique({
    where: { id: req.params.id },
    include: { files: true, employee: { select: { employeeCode: true, name: true } } },
  })
  if (!r) throw new AppError('Not found', 404)
  if (!isSA(req) && r.employeeId !== req.user!.id) throw new AppError('Forbidden', 403)
  if (r.status === 'PAID') throw new AppError('Cannot modify paid reimbursement', 400)

  const files = (req.files as any[]) || []
  if (!files.length) throw new AppError('No files uploaded', 400)
  if (r.files.length + files.length > MAX_FILES) {
    throw new AppError(`Total files cannot exceed ${MAX_FILES}`, 400)
  }

  const created: any[] = []
  for (const f of files) {
    const up = await uploadReimbursementFile(f.buffer, f.originalname, r.employee.employeeCode, r.employee.name)
    const row = await prisma.reimbursementFile.create({
      data: {
        reimbursementId: r.id,
        fileName:        f.originalname,
        mimeType:        up.mimeType,
        sizeBytes:       up.sizeBytes,
        blobKey:         up.key,
        blobUrl:         up.url,
        uploadedBy:      req.user!.id,
      },
    })
    created.push(row)
  }
  res.status(201).json({ success: true, data: created })
})

// ─── FILES: DELETE (owner while PENDING, or SA anytime before PAID) ──────────

reimbursementRouter.delete('/:id/files/:fileId', async (req, res) => {
  const r = await prisma.reimbursement.findUnique({ where: { id: req.params.id } })
  if (!r) throw new AppError('Not found', 404)
  const f = await prisma.reimbursementFile.findUnique({ where: { id: req.params.fileId } })
  if (!f || f.reimbursementId !== r.id) throw new AppError('File not found', 404)

  const ownerAllowed = r.employeeId === req.user!.id && r.status === 'PENDING'
  const saAllowed    = isSA(req) && r.status !== 'PAID'
  if (!ownerAllowed && !saAllowed) throw new AppError('Forbidden', 403)

  try { await deleteReimbursementFile(f.blobKey) } catch {}
  await prisma.reimbursementFile.delete({ where: { id: f.id } })
  res.json({ success: true })
})

// ─── CYCLE SUMMARY (legacy path used by existing frontend) ───────────────────

reimbursementRouter.get('/cycle/:cycleId', requireSuperAdmin, async (req, res) => {
  const items = await prisma.reimbursement.findMany({
    where: { cycleId: req.params.cycleId, status: { in: ['APPROVED', 'PAID'] } },
    include: {
      employee: { select: { name: true, employeeCode: true } },
      files:    true,
    },
    orderBy: { createdAt: 'desc' },
  })
  res.json({ success: true, data: items })
})
