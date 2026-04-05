import { Router } from 'express'
import { authenticate, requireHR, requireSuperAdmin } from '../middleware/auth'
import { prisma } from '../utils/prisma'
import { AppError } from '../middleware/errorHandler'
import { LeaveKind, HalfDaySlot, CancellationStatus } from '@prisma/client'
import {
  getLeavePolicy, getEmployeeBalance, applyLeave, approveLeave, declineLeave,
  requestCancellation, cancelLeaveDirectly, approveCancellationRequest,
  declineCancellationRequest, triggerYearEndRollover, seedDefaultLeaveReasons,
  grantJoiningLeaves, getCurrentLeaveYear,
} from '../services/leaveService'

export const leaveRouter = Router()
leaveRouter.use(authenticate)

// ─── LEAVE POLICY ─────────────────────────────────────────────────────────────

// GET /api/leave/policy
leaveRouter.get('/policy', async (_req, res) => {
  const policy = await getLeavePolicy()
  res.json({ success: true, data: policy })
})

// PUT /api/leave/policy — HR can update quotas + advance days
leaveRouter.put('/policy', requireHR, async (req, res) => {
  const policy = await getLeavePolicy()
  const {
    sickDaysPerYear, casualDaysPerYear, plannedDaysPerYear,
    sickAdvanceDays, casualAdvanceDays, plannedAdvanceDays,
    // SUPER_ADMIN only fields:
    plannedCarryForwardMax, plannedBalanceCap,
    firstHalfStart, firstHalfEnd, secondHalfStart, secondHalfEnd,
  } = req.body

  const data: any = {}
  if (sickDaysPerYear   !== undefined) data.sickDaysPerYear   = sickDaysPerYear
  if (casualDaysPerYear !== undefined) data.casualDaysPerYear = casualDaysPerYear
  if (plannedDaysPerYear !== undefined) data.plannedDaysPerYear = plannedDaysPerYear
  if (sickAdvanceDays   !== undefined) data.sickAdvanceDays   = sickAdvanceDays
  if (casualAdvanceDays !== undefined) data.casualAdvanceDays = casualAdvanceDays
  if (plannedAdvanceDays !== undefined) data.plannedAdvanceDays = plannedAdvanceDays
  if (firstHalfStart !== undefined) data.firstHalfStart = firstHalfStart
  if (firstHalfEnd   !== undefined) data.firstHalfEnd   = firstHalfEnd
  if (secondHalfStart !== undefined) data.secondHalfStart = secondHalfStart
  if (secondHalfEnd   !== undefined) data.secondHalfEnd   = secondHalfEnd

  // Carry forward rules — SUPER_ADMIN only
  if (plannedCarryForwardMax !== undefined || plannedBalanceCap !== undefined) {
    if (req.user!.role !== 'SUPER_ADMIN') throw new AppError('Only Super Admin can change carry forward rules', 403)
    if (plannedCarryForwardMax !== undefined) data.plannedCarryForwardMax = plannedCarryForwardMax
    if (plannedBalanceCap      !== undefined) data.plannedBalanceCap      = plannedBalanceCap
  }

  const updated = await prisma.leavePolicy.update({ where: { id: policy.id }, data })
  res.json({ success: true, data: updated })
})

// ─── LEAVE REASONS ────────────────────────────────────────────────────────────

// GET /api/leave/reasons?kind=SICK|CASUAL|PLANNED
leaveRouter.get('/reasons', async (req, res) => {
  const where: any = { isActive: true }
  if (req.query.kind) where.leaveKind = req.query.kind as LeaveKind
  const reasons = await prisma.leaveReason.findMany({ where, orderBy: [{ leaveKind: 'asc' }, { sortOrder: 'asc' }] })
  res.json({ success: true, data: reasons })
})

// POST /api/leave/reasons — HR/admin
leaveRouter.post('/reasons', requireHR, async (req, res) => {
  const { leaveKind, label, sortOrder } = req.body
  if (!leaveKind || !label) throw new AppError('leaveKind and label are required', 400)
  const reason = await prisma.leaveReason.create({ data: { leaveKind, label, sortOrder: sortOrder || 0 } })
  res.status(201).json({ success: true, data: reason })
})

// PUT /api/leave/reasons/:id — HR/admin
leaveRouter.put('/reasons/:id', requireHR, async (req, res) => {
  const { label, isActive, sortOrder } = req.body
  const reason = await prisma.leaveReason.update({
    where: { id: req.params.id },
    data: { label, isActive, sortOrder },
  })
  res.json({ success: true, data: reason })
})

// DELETE /api/leave/reasons/:id — HR/admin (soft delete)
leaveRouter.delete('/reasons/:id', requireHR, async (req, res) => {
  await prisma.leaveReason.update({ where: { id: req.params.id }, data: { isActive: false } })
  res.json({ success: true })
})

// ─── PUBLIC HOLIDAYS ─────────────────────────────────────────────────────────

// GET /api/leave/holidays?year=2026
leaveRouter.get('/holidays', async (req, res) => {
  const year = req.query.year ? parseInt(req.query.year as string) : new Date().getFullYear()
  const holidays = await prisma.publicHoliday.findMany({ where: { year }, orderBy: { date: 'asc' } })
  res.json({ success: true, data: holidays })
})

// POST /api/leave/holidays — HR/admin
leaveRouter.post('/holidays', requireHR, async (req, res) => {
  const { date, name, description, greetingMessage } = req.body
  if (!date || !name) throw new AppError('date and name are required', 400)
  const d = new Date(date)
  const holiday = await prisma.publicHoliday.create({
    data: { date: d, name, description, greetingMessage, year: d.getFullYear() },
  })
  res.status(201).json({ success: true, data: holiday })
})

// PUT /api/leave/holidays/:id — HR/admin
leaveRouter.put('/holidays/:id', requireHR, async (req, res) => {
  const { date, name, description, greetingMessage } = req.body
  const data: any = { name, description, greetingMessage }
  if (date) { const d = new Date(date); data.date = d; data.year = d.getFullYear() }
  const holiday = await prisma.publicHoliday.update({ where: { id: req.params.id }, data })
  res.json({ success: true, data: holiday })
})

// DELETE /api/leave/holidays/:id — HR/admin
leaveRouter.delete('/holidays/:id', requireHR, async (req, res) => {
  await prisma.publicHoliday.delete({ where: { id: req.params.id } })
  res.json({ success: true })
})

// ─── LEAVE BALANCE ────────────────────────────────────────────────────────────

// GET /api/leave/balance/my — employee's own balance  (MUST be before /:employeeId)
leaveRouter.get('/balance/my', async (req, res) => {
  const year = req.query.year ? parseInt(req.query.year as string) : getCurrentLeaveYear()
  const balance = await getEmployeeBalance(req.user!.id, year)
  res.json({ success: true, data: balance })
})

// GET /api/leave/balance — all employees (MUST be before /:employeeId)
leaveRouter.get('/balance', requireHR, async (req, res) => {
  const year = req.query.year ? parseInt(req.query.year as string) : getCurrentLeaveYear()
  const employees = await prisma.employee.findMany({
    where: { status: { in: ['ACTIVE', 'ON_NOTICE'] } },
    select: { id: true, name: true, employeeCode: true, department: true },
    orderBy: { name: 'asc' },
  })
  const result = await Promise.all(
    employees.map(async emp => ({
      ...emp,
      balance: await getEmployeeBalance(emp.id, year),
    }))
  )
  res.json({ success: true, data: result })
})

// GET /api/leave/balance/:employeeId/history — month snapshots (MUST be before /:employeeId)
leaveRouter.get('/balance/:employeeId/history', requireHR, async (req, res) => {
  const snapshots = await prisma.leaveBalanceSnapshot.findMany({
    where: { employeeId: req.params.employeeId },
    orderBy: { snapshotMonth: 'desc' },
  })
  res.json({ success: true, data: snapshots })
})

// GET /api/leave/balance/:employeeId — HR/admin (parameterised — always last)
leaveRouter.get('/balance/:employeeId', requireHR, async (req, res) => {
  const year = req.query.year ? parseInt(req.query.year as string) : getCurrentLeaveYear()
  const balance = await getEmployeeBalance(req.params.employeeId, year)
  res.json({ success: true, data: balance })
})

// ─── LEAVE APPLICATIONS ───────────────────────────────────────────────────────

// POST /api/leave/apply — employee applies
leaveRouter.post('/apply', async (req, res) => {
  const {
    leaveKind, startDate, endDate, isHalfDay, halfDaySlot,
    reasonId, reasonLabel, customReason,
  } = req.body

  if (!leaveKind || !startDate || !reasonLabel) {
    throw new AppError('leaveKind, startDate, and reasonLabel are required', 400)
  }

  const start = new Date(startDate)
  const end   = endDate ? new Date(endDate) : new Date(startDate)

  const application = await applyLeave({
    employeeId:   req.user!.id,
    leaveKind:    leaveKind as LeaveKind,
    startDate:    start,
    endDate:      end,
    isHalfDay:    Boolean(isHalfDay),
    halfDaySlot:  halfDaySlot as HalfDaySlot | undefined,
    reasonId, reasonLabel, customReason,
  })

  res.status(201).json({ success: true, data: application })
})

// GET /api/leave/my — employee's own applications
leaveRouter.get('/my', async (req, res) => {
  const { status, year } = req.query
  const where: any = { employeeId: req.user!.id }
  if (status) where.status = status
  if (year) {
    const y = parseInt(year as string)
    where.startDate = { gte: new Date(`${y}-01-01`), lte: new Date(`${y}-12-31`) }
  }
  const applications = await prisma.lvApplication.findMany({
    where,
    include: { cancellationRequests: { orderBy: { createdAt: 'desc' }, take: 1 } },
    orderBy: { startDate: 'desc' },
  })
  res.json({ success: true, data: applications })
})

// GET /api/leave/applications — HR/admin, all employees
leaveRouter.get('/applications', requireHR, async (req, res) => {
  const { status, leaveKind, employeeId, page = '1', limit = '50' } = req.query
  const where: any = {}
  if (status)     where.status     = status
  if (leaveKind)  where.leaveKind  = leaveKind
  if (employeeId) where.employeeId = employeeId

  const pageNum  = parseInt(page as string)
  const limitNum = parseInt(limit as string)

  const [applications, total] = await Promise.all([
    prisma.lvApplication.findMany({
      where,
      include: {
        employee: { select: { name: true, employeeCode: true, department: true } },
        cancellationRequests: { where: { status: CancellationStatus.PENDING }, take: 1 },
      },
      orderBy: { createdAt: 'desc' },
      skip: (pageNum - 1) * limitNum,
      take: limitNum,
    }),
    prisma.lvApplication.count({ where }),
  ])

  res.json({ success: true, data: applications, pagination: { page: pageNum, limit: limitNum, total } })
})

// PUT /api/leave/applications/:id/approve — HR/admin
leaveRouter.put('/applications/:id/approve', requireHR, async (req, res) => {
  const app = await approveLeave(req.params.id, req.user!.id, req.user!.name)
  res.json({ success: true, data: app })
})

// PUT /api/leave/applications/:id/decline — HR/admin
leaveRouter.put('/applications/:id/decline', requireHR, async (req, res) => {
  const { reason } = req.body
  if (!reason) throw new AppError('Decline reason is required', 400)
  const app = await declineLeave(req.params.id, req.user!.id, req.user!.name, reason)
  res.json({ success: true, data: app })
})

// PUT /api/leave/applications/:id/cancel-direct — HR/admin direct cancel (no request)
leaveRouter.put('/applications/:id/cancel-direct', requireHR, async (req, res) => {
  const { newEndDate } = req.body
  await cancelLeaveDirectly(
    req.params.id,
    req.user!.id,
    req.user!.name,
    undefined,
    newEndDate ? new Date(newEndDate) : undefined
  )
  res.json({ success: true })
})

// ─── EMPLOYEE CANCELLATION REQUESTS ──────────────────────────────────────────

// POST /api/leave/applications/:id/cancel — employee requests cancel
leaveRouter.post('/applications/:id/cancel', async (req, res) => {
  const app = await prisma.lvApplication.findUnique({ where: { id: req.params.id } })
  if (!app) throw new AppError('Application not found', 404)
  if (app.employeeId !== req.user!.id) throw new AppError('Access denied', 403)

  const result = await requestCancellation({
    applicationId:   req.params.id,
    requestedById:   req.user!.id,
    requestedByName: req.user!.name,
    requestedByRole: req.user!.role,
    reason:          req.body.reason,
  })
  res.json({ success: true, data: result })
})

// GET /api/leave/cancellations — HR/admin sees all pending cancellation requests
leaveRouter.get('/cancellations', requireHR, async (_req, res) => {
  const requests = await prisma.lvCancellationRequest.findMany({
    where: { status: CancellationStatus.PENDING },
    include: {
      application: {
        include: {
          employee: { select: { name: true, employeeCode: true, department: true } },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  })
  res.json({ success: true, data: requests })
})

// PUT /api/leave/cancellations/:id/approve — HR/admin
leaveRouter.put('/cancellations/:id/approve', requireHR, async (req, res) => {
  const { newEndDate } = req.body
  await approveCancellationRequest(
    req.params.id,
    req.user!.id,
    req.user!.name,
    newEndDate ? new Date(newEndDate) : undefined
  )
  res.json({ success: true })
})

// PUT /api/leave/cancellations/:id/decline — HR/admin
leaveRouter.put('/cancellations/:id/decline', requireHR, async (req, res) => {
  const { reason } = req.body
  if (!reason) throw new AppError('Reason is required', 400)
  await declineCancellationRequest(req.params.id, req.user!.id, req.user!.name, reason)
  res.json({ success: true })
})

// ─── ROLLOVER ─────────────────────────────────────────────────────────────────

// POST /api/leave/rollover — SUPER_ADMIN only, window 28 Dec – 5 Jan
leaveRouter.post('/rollover', requireSuperAdmin, async (req, res) => {
  const result = await triggerYearEndRollover(req.user!.id, req.user!.name)
  res.json({ success: true, data: result })
})

// GET /api/leave/rollover/history — HR/admin
leaveRouter.get('/rollover/history', requireHR, async (_req, res) => {
  const history = await prisma.leaveRolloverHistory.findMany({ orderBy: { triggeredAt: 'desc' } })
  res.json({ success: true, data: history })
})

// GET /api/leave/rollover/status — can rollover be triggered now?
leaveRouter.get('/rollover/status', requireHR, async (_req, res) => {
  const today = new Date()
  const month = today.getMonth()
  const day   = today.getDate()
  const inWindow = (month === 11 && day >= 28) || (month === 0 && day <= 5)
  const fromYear = month === 11 ? today.getFullYear() : today.getFullYear() - 1
  const existing = await prisma.leaveRolloverHistory.findFirst({ where: { fromYear } })
  res.json({ success: true, data: { inWindow, alreadyDone: !!existing, fromYear, toYear: fromYear + 1, existing } })
})

// ─── SEED REASONS (one-time) ─────────────────────────────────────────────────

leaveRouter.post('/seed-reasons', requireSuperAdmin, async (_req, res) => {
  await seedDefaultLeaveReasons()
  res.json({ success: true, message: 'Default reasons seeded' })
})
