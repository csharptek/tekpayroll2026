import { Router } from 'express'
import { authenticate, requireHR, requireSuperAdmin } from '../middleware/auth'
import { prisma } from '../utils/prisma'
import { AppError } from '../middleware/errorHandler'
import { LeaveKind, HalfDaySlot, CancellationStatus } from '@prisma/client'
import {
  getLeavePolicy, getEmployeeBalance, applyLeave, approveLeave, declineLeave,
  requestCancellation, cancelLeaveDirectly, approveCancellationRequest,
  declineCancellationRequest, triggerYearEndRollover, seedDefaultLeaveReasons,
  grantJoiningLeaves, getCurrentLeaveYear, countWorkingDays,
  getEmployeeLeaveRestriction, getLeaveYear,
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
  const restriction = (balance as any)._restriction || { type: 'NONE' }
  delete (balance as any)._restriction
  res.json({ success: true, data: { balance, restriction } })
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
    reasonId, reasonLabel, customReason, description,
  } = req.body

  if (!leaveKind || !startDate || !reasonLabel) {
    throw new AppError('leaveKind, startDate, and reasonLabel are required', 400)
  }

  if (!description || description.trim().split(/\s+/).filter(Boolean).length < 10) {
    throw new AppError('Description must be at least 10 words', 400)
  }

  const toUtcDay = (s: string) => new Date(s.slice(0, 10) + 'T00:00:00.000Z')
  const start = toUtcDay(startDate as string)
  const end   = endDate ? toUtcDay(endDate as string) : toUtcDay(startDate as string)

  const application = await applyLeave({
    employeeId:   req.user!.id,
    leaveKind:    leaveKind as LeaveKind,
    startDate:    start,
    endDate:      end,
    isHalfDay:    Boolean(isHalfDay),
    halfDaySlot:  halfDaySlot as HalfDaySlot | undefined,
    reasonId, reasonLabel, customReason, description,
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
leaveRouter.get('/applications', async (req, res) => {
  // All authenticated users can view applications (for calendar)
  // HR/SuperAdmin see all; others also see all for calendar purposes
  const { status, leaveKind, employeeId, year, month, page = '1', limit = '50' } = req.query
  const where: any = {}
  if (status)     where.status     = status
  if (leaveKind)  where.leaveKind  = leaveKind
  if (employeeId) where.employeeId = employeeId

  // Month/year filter for calendar
  if (year && month) {
    const y = parseInt(year as string)
    const m = parseInt(month as string)
    const monthStart = new Date(y, m - 1, 1)
    const monthEnd   = new Date(y, m, 0, 23, 59, 59)
    // Applications that overlap with this month
    where.OR = [
      { startDate: { gte: monthStart, lte: monthEnd } },
      { endDate:   { gte: monthStart, lte: monthEnd } },
      { AND: [{ startDate: { lte: monthStart } }, { endDate: { gte: monthEnd } }] },
    ]
  } else if (year) {
    const y = parseInt(year as string)
    where.startDate = { gte: new Date(`${y}-01-01`), lte: new Date(`${y}-12-31`) }
  }

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

// ─── ADJUST LEAVE BALANCE (Super Admin) ──────────────────────────────────────

leaveRouter.get('/balance-adjust/employees', requireSuperAdmin, async (req, res) => {
  const year = parseInt(req.query.year as string) || new Date().getFullYear()
  const employees = await prisma.employee.findMany({
    where: { status: 'ACTIVE' },
    select: { id: true, name: true, employeeCode: true },
    orderBy: { name: 'asc' },
  })
  const results = await Promise.all(employees.map(async emp => {
    const entitlements = await prisma.leaveEntitlement.findMany({
      where: { employeeId: emp.id, year },
    })
    const byKind: Record<string, any> = {}
    for (const e of entitlements) {
      byKind[e.leaveKind] = {
        id: e.id,
        totalDays: Number(e.totalDays),
        usedDays: Number(e.usedDays),
        pendingDays: Number(e.pendingDays),
        lopDays: Number(e.lopDays),
        carryForward: Number(e.carryForward),
      }
    }
    return { ...emp, balances: byKind }
  }))
  res.json({ success: true, data: results })
})

leaveRouter.put('/balance-adjust', requireSuperAdmin, async (req, res) => {
  const { employeeId, leaveKind, year, totalDays } = req.body
  if (!employeeId || !leaveKind || !year || totalDays === undefined) {
    throw new AppError('employeeId, leaveKind, year, totalDays are required', 400)
  }
  if (!['SICK', 'CASUAL', 'PLANNED'].includes(leaveKind)) {
    throw new AppError('Invalid leaveKind', 400)
  }
  if (Number(totalDays) < 0 || Number(totalDays) > 365) {
    throw new AppError('totalDays must be 0–365', 400)
  }
  const data = { totalDays: Number(totalDays) }
  const upserted = await prisma.leaveEntitlement.upsert({
    where: { employeeId_leaveKind_year: { employeeId, leaveKind, year } },
    update: data,
    create: { employeeId, leaveKind, year, ...data },
  })
  res.json({ success: true, data: upserted })
})

// ─── BULK LEAVE ENTRY (HR / Super Admin) ─────────────────────────────────────
// POST /api/leave/bulk-entry
// Body: { entries: Array<{ employeeId, leaveKind, startDate, endDate, isHalfDay, halfDaySlot, isLop, reasonLabel, customReason }> }

leaveRouter.post('/bulk-entry', requireHR, async (req, res) => {
  const { entries } = req.body
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new AppError('entries array is required', 400)
  }

  const results: Array<{ index: number; employeeId: string; status: 'success' | 'error'; message?: string; data?: any }> = []

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]
    try {
      const {
        employeeId, leaveKind, startDate: startDateStr, endDate: endDateStr,
        isHalfDay, halfDaySlot: rawHalfDaySlot, isLop: forceIsLop, reasonLabel, customReason,
      } = entry

      // Normalize legacy FIRST_HALF/SECOND_HALF values to FIRST/SECOND
      const halfDaySlot = rawHalfDaySlot === 'FIRST_HALF' ? 'FIRST'
                        : rawHalfDaySlot === 'SECOND_HALF' ? 'SECOND'
                        : rawHalfDaySlot

      if (!employeeId || !leaveKind || !startDateStr || !reasonLabel) {
        throw new Error('employeeId, leaveKind, startDate, reasonLabel are required')
      }
      if (!['SICK', 'CASUAL', 'PLANNED'].includes(leaveKind)) {
        throw new Error(`Invalid leaveKind: ${leaveKind}`)
      }

      const toUtcMidnight = (s: string) => new Date(s.slice(0, 10) + 'T00:00:00.000Z')
      const startDate = toUtcMidnight(startDateStr)
      const endDate   = endDateStr ? toUtcMidnight(endDateStr) : toUtcMidnight(startDateStr)

      if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
        throw new Error('Invalid date format')
      }
      if (startDate > endDate) {
        throw new Error('startDate must be before endDate')
      }

      // Check for overlap (allow two different half-day slots on same date)
      const overlaps = await prisma.lvApplication.findMany({
        where: {
          employeeId,
          status: { in: ['PENDING', 'APPROVED', 'AUTO_APPROVED'] },
          startDate: { lte: endDate },
          endDate:   { gte: startDate },
        },
        select: { id: true, isHalfDay: true, halfDaySlot: true, startDate: true, endDate: true },
      })

      for (const existing of overlaps) {
        const toDay = (d: Date) => d.toISOString().slice(0, 10)
        const newStart = toDay(startDate)
        const newEnd   = toDay(endDate)
        const exStart  = toDay(existing.startDate)
        const exEnd    = toDay(existing.endDate)
        const sameSingleDate = newStart === newEnd && exStart === exEnd && newStart === exStart

        if (sameSingleDate && Boolean(isHalfDay) && existing.isHalfDay) {
          // Both are half-days on same date — allow only if different slots
          if (halfDaySlot && existing.halfDaySlot && halfDaySlot === existing.halfDaySlot) {
            throw new Error(`Employee already has a ${halfDaySlot === 'FIRST' ? 'first half' : 'second half'} day leave on this date`)
          }
          // Slots differ or one slot unknown — allow through
          continue
        }
        // Existing is full-day, or new is full-day, or multi-day — block
        const existingType = existing.isHalfDay ? 'half-day' : 'full-day'
        const newType = Boolean(isHalfDay) ? 'half-day' : 'full-day'
        throw new Error(`Cannot add ${newType} leave — employee already has a ${existingType} leave overlapping these dates`)
      }

      const totalDays = await countWorkingDays(startDate, endDate, Boolean(isHalfDay))
      if (totalDays === 0) throw new Error('No working days in selected range')

      const year = startDate.getFullYear()
      const policy = await getLeavePolicy()

      // Get or create entitlement
      let entitlement = await prisma.leaveEntitlement.findUnique({
        where: { employeeId_leaveKind_year: { employeeId, leaveKind, year } },
      })
      if (!entitlement) {
        const annual = { SICK: policy.sickDaysPerYear, CASUAL: policy.casualDaysPerYear, PLANNED: policy.plannedDaysPerYear }[leaveKind as string] || 0
        entitlement = await prisma.leaveEntitlement.create({
          data: { employeeId, leaveKind, year, totalDays: annual },
        })
      }

      const available = Number(entitlement.totalDays) + Number(entitlement.carryForward)
                      - Number(entitlement.usedDays) - Number(entitlement.pendingDays)

      // Trainee/probation/notice always forced LOP regardless of balance
      const restriction = await getEmployeeLeaveRestriction(employeeId, startDate)
      const forceLop = ['TRAINEE', 'PROBATION', 'NOTICE'].includes(restriction.type)

      // Admin can force isLop; else forced by restriction; else auto-detect from balance
      const isLop   = forceLop ? true : (forceIsLop === true ? true : available < totalDays)
      const lopDays = isLop
        ? (forceLop || forceIsLop === true ? totalDays : Math.max(0, totalDays - Math.max(0, available)))
        : 0

      const application = await prisma.lvApplication.create({
        data: {
          employeeId,
          leaveKind,
          startDate,
          endDate,
          totalDays,
          isHalfDay:   Boolean(isHalfDay),
          ...(isHalfDay && halfDaySlot ? { halfDaySlot } : {}),
          reasonLabel,
          customReason: customReason || null,
          isBackdated:  startDate < new Date(),
          status:       'AUTO_APPROVED',
          isLop,
          lopDays,
          approvedById:   req.user!.id,
          approvedByName: req.user!.name,
          approvedAt:     new Date(),
        },
      })

      // Update entitlement (usedDays tracks all consumed days, LOP included)
      await prisma.leaveEntitlement.update({
        where: { employeeId_leaveKind_year: { employeeId, leaveKind, year } },
        data: {
          usedDays: { increment: totalDays },
          lopDays:  { increment: lopDays },
        },
      })

      // Create LOP entry in payroll if isLop
      if (isLop && lopDays > 0) {
        const matchedCycle = await prisma.payrollCycle.findFirst({
          where: { cycleStart: { lte: startDate }, cycleEnd: { gte: startDate } },
        })
        let cycle: typeof matchedCycle | null = null
        if (matchedCycle) {
          if (!['DRAFT', 'CALCULATED'].includes(matchedCycle.status)) {
            // Historical month already locked/processed — do not misattribute
            // this LOP to whatever cycle happens to be open right now.
            console.error(`[LOP] Cycle ${matchedCycle.payrollMonth} locked (${matchedCycle.status}) for backdated entry — LOP not applied, needs manual payroll correction`)
          } else {
            cycle = matchedCycle
          }
        } else {
          cycle = await prisma.payrollCycle.findFirst({
            where: { status: { in: ['DRAFT', 'CALCULATED'] } },
            orderBy: { cycleStart: 'desc' },
          })
        }
        if (cycle) {
          await prisma.lopEntry.upsert({
            where: { cycleId_employeeId: { cycleId: cycle.id, employeeId } },
            create: { cycleId: cycle.id, employeeId, lopDays },
            update: { lopDays: { increment: lopDays } },
          })
        }
      }

      results.push({ index: i, employeeId, status: 'success', data: { id: application.id, totalDays, isLop, lopDays } })
    } catch (err: any) {
      results.push({ index: i, employeeId: entry?.employeeId || '', status: 'error', message: err.message || 'Unknown error' })
    }
  }

  const successCount = results.filter(r => r.status === 'success').length
  const errorCount   = results.filter(r => r.status === 'error').length
  res.status(200).json({ success: true, data: { results, successCount, errorCount } })
})

// ─── LOP REBUILD (deterministic recompute of leave balances & LOP) ──────────
//
// Recomputes, from lvApplication rows (source of truth), the correct values of:
//   1. each application's isLop / lopDays
//   2. each leaveEntitlement's usedDays / pendingDays / lopDays  (SET, not increment)
//   3. each open payroll cycle's leave-derived lopEntry rows      (SET, not increment)
// totalDays / carryForward / activatesOn on entitlements are never modified.
// Locked/processed cycles are never modified — diffs are reported for manual action.

type RebuildPlan = {
  applications: Array<{
    applicationId: string, employeeId: string, employeeName: string, employeeCode: string,
    leaveKind: string, startDate: Date, endDate: Date, totalDays: number,
    currentLopDays: number, correctLopDays: number, reason: string,
  }>,
  entitlements: Array<{
    employeeId: string, employeeName: string, employeeCode: string, leaveKind: string, year: number,
    current: { usedDays: number, pendingDays: number, lopDays: number },
    correct: { usedDays: number, pendingDays: number, lopDays: number },
  }>,
  lopEntries: Array<{
    cycleId: string, payrollMonth: string, cycleStatus: string, editable: boolean,
    employeeId: string, employeeName: string, employeeCode: string,
    currentLopDays: number, correctLopDays: number,
  }>,
}

async function buildLopRebuildPlan(): Promise<RebuildPlan> {
  const apps = await prisma.lvApplication.findMany({
    where: { status: { in: ['PENDING', 'APPROVED', 'AUTO_APPROVED'] } },
    include: { employee: { select: { id: true, name: true, employeeCode: true } } },
    orderBy: { createdAt: 'asc' },
  })

  const entitlements = await prisma.leaveEntitlement.findMany({
    include: { employee: { select: { id: true, name: true, employeeCode: true } } },
  })
  const entMap = new Map<string, any>(entitlements.map((e: any) => [`${e.employeeId}::${e.leaveKind}::${e.year}`, e]))

  // ── Pass 1: replay approved apps chronologically per employee+kind+year ──
  const usedSoFar = new Map<string, number>()   // quota consumed incl. LOP
  const correctLopByApp = new Map<string, number>()
  const reasonByApp = new Map<string, string>()

  for (const app of apps) {
    if (app.status === 'PENDING') continue
    const year = getLeaveYear(app.startDate)
    const key = `${app.employeeId}::${app.leaveKind}::${year}`
    const ent = entMap.get(key)
    const totalDays = Number(app.totalDays)

    const restriction = await getEmployeeLeaveRestriction(app.employeeId, new Date(app.startDate))
    const forceLop = ['TRAINEE', 'PROBATION', 'NOTICE'].includes(restriction.type)

    let correctLop: number
    let reason: string
    if (forceLop) {
      correctLop = totalDays
      reason = `${restriction.type} as of leave date — fully LOP`
    } else if (!ent) {
      correctLop = totalDays
      reason = `No entitlement row for ${year} — fully LOP`
    } else {
      const quota = Number(ent.totalDays) + Number(ent.carryForward)
      const consumed = usedSoFar.get(key) ?? 0
      const available = Math.max(0, quota - consumed)
      correctLop = available < totalDays ? Math.round((totalDays - available) * 100) / 100 : 0
      reason = correctLop > 0 ? `Quota ${quota}, already consumed ${consumed} at apply time` : ''
    }

    usedSoFar.set(key, (usedSoFar.get(key) ?? 0) + totalDays)
    correctLopByApp.set(app.id, correctLop)
    if (reason) reasonByApp.set(app.id, reason)
  }

  // ── Pass 2: aggregate correct entitlement values ──
  const agg = new Map<string, { usedDays: number, pendingDays: number, lopDays: number }>()
  for (const app of apps) {
    const year = getLeaveYear(app.startDate)
    const key = `${app.employeeId}::${app.leaveKind}::${year}`
    if (!agg.has(key)) agg.set(key, { usedDays: 0, pendingDays: 0, lopDays: 0 })
    const a = agg.get(key)!
    const totalDays = Number(app.totalDays)
    if (app.status === 'PENDING') {
      a.pendingDays = Math.round((a.pendingDays + totalDays) * 100) / 100
    } else {
      a.usedDays = Math.round((a.usedDays + totalDays) * 100) / 100
      a.lopDays  = Math.round((a.lopDays + (correctLopByApp.get(app.id) ?? 0)) * 100) / 100
    }
  }

  // ── Pass 3: aggregate correct leave-derived LOP per payroll cycle ──
  const cycles = await prisma.payrollCycle.findMany()
  const lopByCycleEmp = new Map<string, number>()
  for (const app of apps) {
    if (app.status === 'PENDING') continue
    const lop = correctLopByApp.get(app.id) ?? 0
    if (lop <= 0) continue
    const cycle = cycles.find(c => c.cycleStart <= app.startDate && c.cycleEnd >= app.startDate)
    if (!cycle) continue
    const k = `${cycle.id}::${app.employeeId}`
    lopByCycleEmp.set(k, Math.round(((lopByCycleEmp.get(k) ?? 0) + lop) * 100) / 100)
  }

  const empInfo = new Map<string, any>(apps.map((a: any) => [a.employeeId, a.employee]))
  const plan: RebuildPlan = { applications: [], entitlements: [], lopEntries: [] }

  // Application diffs
  for (const app of apps) {
    if (app.status === 'PENDING') continue
    const correctLop = correctLopByApp.get(app.id) ?? 0
    const currentLop = Number(app.lopDays)
    if (Math.abs(correctLop - currentLop) > 0.01) {
      plan.applications.push({
        applicationId: app.id, employeeId: app.employeeId,
        employeeName: app.employee.name, employeeCode: app.employee.employeeCode,
        leaveKind: app.leaveKind, startDate: app.startDate, endDate: app.endDate,
        totalDays: Number(app.totalDays), currentLopDays: currentLop, correctLopDays: correctLop,
        reason: reasonByApp.get(app.id) || 'Recomputed by replay',
      })
    }
  }

  // Entitlement diffs (covers every entitlement row, incl. ones with zero apps)
  for (const ent of entitlements) {
    const key = `${ent.employeeId}::${ent.leaveKind}::${ent.year}`
    const correct = agg.get(key) ?? { usedDays: 0, pendingDays: 0, lopDays: 0 }
    const current = { usedDays: Number(ent.usedDays), pendingDays: Number(ent.pendingDays), lopDays: Number(ent.lopDays) }
    if (Math.abs(current.usedDays - correct.usedDays) > 0.01 ||
        Math.abs(current.pendingDays - correct.pendingDays) > 0.01 ||
        Math.abs(current.lopDays - correct.lopDays) > 0.01) {
      plan.entitlements.push({
        employeeId: ent.employeeId, employeeName: ent.employee.name, employeeCode: ent.employee.employeeCode,
        leaveKind: ent.leaveKind, year: ent.year, current, correct,
      })
    }
  }

  // LopEntry diffs — existing rows vs computed, plus computed rows that don't exist
  const existingLopEntries = await prisma.lopEntry.findMany()
  const seen = new Set<string>()
  for (const le of existingLopEntries) {
    const cycle = cycles.find(c => c.id === le.cycleId)
    if (!cycle) continue
    const k = `${le.cycleId}::${le.employeeId}`
    seen.add(k)
    const correct = lopByCycleEmp.get(k) ?? 0
    const current = Number(le.lopDays)
    if (Math.abs(correct - current) > 0.01) {
      const emp = empInfo.get(le.employeeId)
      plan.lopEntries.push({
        cycleId: cycle.id, payrollMonth: cycle.payrollMonth, cycleStatus: cycle.status,
        editable: ['DRAFT', 'CALCULATED'].includes(cycle.status),
        employeeId: le.employeeId, employeeName: emp?.name || le.employeeId, employeeCode: emp?.employeeCode || '',
        currentLopDays: current, correctLopDays: correct,
      })
    }
  }
  for (const [k, correct] of lopByCycleEmp) {
    if (seen.has(k) || correct <= 0) continue
    const [cycleId, employeeId] = k.split('::')
    const cycle = cycles.find(c => c.id === cycleId)!
    const emp = empInfo.get(employeeId)
    plan.lopEntries.push({
      cycleId, payrollMonth: cycle.payrollMonth, cycleStatus: cycle.status,
      editable: ['DRAFT', 'CALCULATED'].includes(cycle.status),
      employeeId, employeeName: emp?.name || employeeId, employeeCode: emp?.employeeCode || '',
      currentLopDays: 0, correctLopDays: correct,
    })
  }

  return plan
}

// GET /api/leave/admin/lop-correction/preview
leaveRouter.get('/admin/lop-correction/preview', requireSuperAdmin, async (_req, res) => {
  const plan = await buildLopRebuildPlan()
  res.json({ success: true, data: {
    ...plan,
    total: plan.applications.length + plan.entitlements.length + plan.lopEntries.filter(l => l.editable).length,
    lockedCycleChanges: plan.lopEntries.filter(l => !l.editable).length,
  } })
})

// POST /api/leave/admin/lop-correction/apply
leaveRouter.post('/admin/lop-correction/apply', requireSuperAdmin, async (_req, res) => {
  const plan = await buildLopRebuildPlan()
  const results: any[] = []

  for (const a of plan.applications) {
    try {
      await prisma.lvApplication.update({
        where: { id: a.applicationId },
        data: { isLop: a.correctLopDays > 0, lopDays: a.correctLopDays },
      })
      results.push({ type: 'application', id: a.applicationId, employeeName: a.employeeName, status: 'success', detail: `LOP ${a.currentLopDays} → ${a.correctLopDays}` })
    } catch (err: any) {
      results.push({ type: 'application', id: a.applicationId, status: 'error', message: err.message })
    }
  }

  for (const e of plan.entitlements) {
    try {
      await prisma.leaveEntitlement.update({
        where: { employeeId_leaveKind_year: { employeeId: e.employeeId, leaveKind: e.leaveKind as any, year: e.year } },
        data: { usedDays: e.correct.usedDays, pendingDays: e.correct.pendingDays, lopDays: e.correct.lopDays },
      })
      results.push({ type: 'entitlement', id: `${e.employeeCode}/${e.leaveKind}/${e.year}`, employeeName: e.employeeName, status: 'success', detail: `used ${e.current.usedDays}→${e.correct.usedDays}, pending ${e.current.pendingDays}→${e.correct.pendingDays}, lop ${e.current.lopDays}→${e.correct.lopDays}` })
    } catch (err: any) {
      results.push({ type: 'entitlement', id: `${e.employeeCode}/${e.leaveKind}/${e.year}`, status: 'error', message: err.message })
    }
  }

  for (const l of plan.lopEntries) {
    if (!l.editable) {
      results.push({ type: 'lopEntry', id: `${l.payrollMonth}/${l.employeeCode}`, employeeName: l.employeeName, status: 'skipped', detail: `Cycle ${l.payrollMonth} is ${l.cycleStatus} — LOP ${l.currentLopDays} should be ${l.correctLopDays}, correct manually` })
      continue
    }
    try {
      if (l.correctLopDays <= 0) {
        await prisma.lopEntry.deleteMany({ where: { cycleId: l.cycleId, employeeId: l.employeeId } })
      } else {
        await prisma.lopEntry.upsert({
          where: { cycleId_employeeId: { cycleId: l.cycleId, employeeId: l.employeeId } },
          create: { cycleId: l.cycleId, employeeId: l.employeeId, lopDays: l.correctLopDays },
          update: { lopDays: l.correctLopDays },
        })
      }
      results.push({ type: 'lopEntry', id: `${l.payrollMonth}/${l.employeeCode}`, employeeName: l.employeeName, status: 'success', detail: `LOP ${l.currentLopDays} → ${l.correctLopDays}` })
    } catch (err: any) {
      results.push({ type: 'lopEntry', id: `${l.payrollMonth}/${l.employeeCode}`, status: 'error', message: err.message })
    }
  }

  const successCount = results.filter(r => r.status === 'success').length
  const errorCount = results.filter(r => r.status === 'error').length
  const skippedCount = results.filter(r => r.status === 'skipped').length
  res.json({ success: true, data: { results, successCount, errorCount, skippedCount } })
})
