import { Router } from 'express'
import { authenticate, requireHR, requireSuperAdmin } from '../middleware/auth'
import { prisma } from '../utils/prisma'
import { AppError } from '../middleware/errorHandler'
import { z } from 'zod'
import {
  sendResignationSubmittedToHR,
  sendExitInitiatedToEmployee,
  sendWithdrawalEnabledToEmployee,
  sendWithdrawalToHR,
  sendAllClearanceDoneToSuperAdmin,
  sendSeparatedToEmployee,
} from '../services/emailService'

export const exitRouter = Router()
exitRouter.use(authenticate)

// ─── HELPERS ──────────────────────────────────────────────────────────────────

async function getNoticeDays(exitType: string): Promise<number> {
  const keyMap: Record<string, string> = {
    RESIGNED:   'NOTICE_DAYS_RESIGNED',
    TERMINATED: 'NOTICE_DAYS_TERMINATED',
    ABSCONDED:  'NOTICE_DAYS_ABSCONDED',
  }
  const key = keyMap[exitType] || 'NOTICE_DAYS_RESIGNED'
  const cfg = await prisma.systemConfig.findUnique({ where: { key } })
  return cfg ? parseInt(cfg.value) || 90 : (exitType === 'RESIGNED' ? 90 : 0)
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date)
  d.setDate(d.getDate() + days)
  return d
}

function fmtDate(d: Date) {
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

async function getHREmails(): Promise<string[]> {
  const hrs = await prisma.employee.findMany({
    where: { role: { in: ['HR', 'SUPER_ADMIN'] }, status: 'ACTIVE' },
    select: { email: true },
  })
  return hrs.map(h => h.email)
}

async function getSuperAdminEmails(): Promise<string[]> {
  const admins = await prisma.employee.findMany({
    where: { role: 'SUPER_ADMIN', status: 'ACTIVE' },
    select: { email: true },
  })
  return admins.map(a => a.email)
}

async function logHistory(employeeId: string, action: string, userId: string, userName: string, userRole: string, notes?: string) {
  await prisma.resignationHistory.create({
    data: { employeeId, action, performedById: userId, performedByName: userName, performedByRole: userRole, notes },
  })
}

// ─── GET RESIGNATION DETAILS ──────────────────────────────────────────────────
// GET /api/exit/:id

exitRouter.get('/:id', async (req, res) => {
  const emp = await prisma.employee.findUnique({
    where: { id: req.params.id },
    select: {
      id: true, name: true, email: true, employeeCode: true, status: true,
      exitType: true, resignationDate: true, lastWorkingDay: true,
      expectedLwd: true, noticePeriodDays: true,
      resignationSubmittedAt: true, resignationReason: true, resignationRequests: true,
      resignationInitiatedBy: true, withdrawalEnabled: true, withdrawnAt: true,
      exitClearance: true,
      exitInterview: true,
      resignationHistory: { orderBy: { createdAt: 'asc' } },
    },
  })
  if (!emp) throw new AppError('Employee not found', 404)

  // Only HR/admin or the employee themselves
  const me = req.user!
  if (me.role === 'EMPLOYEE' && me.id !== emp.id) throw new AppError('Access denied', 403)

  res.json({ success: true, data: emp })
})

// ─── EMPLOYEE SELF-RESIGNATION ────────────────────────────────────────────────
// POST /api/exit/:id/resign  (employee submits own resignation)

exitRouter.post('/:id/resign', async (req, res) => {
  const me = req.user!
  if (me.id !== req.params.id) throw new AppError('You can only resign yourself', 403)

  const { reason, requests } = z.object({
    reason:   z.string().min(10, 'Please provide a detailed reason (min 10 characters)'),
    requests: z.string().optional(),
  }).parse(req.body)

  const emp = await prisma.employee.findUnique({ where: { id: req.params.id } })
  if (!emp) throw new AppError('Employee not found', 404)
  if (emp.status !== 'ACTIVE') throw new AppError('Only active employees can submit resignation', 400)

  const noticeDays  = await getNoticeDays('RESIGNED')
  const now         = new Date()
  const expectedLwd = addDays(now, noticeDays)

  await prisma.employee.update({
    where: { id: emp.id },
    data: {
      status:                'ON_NOTICE',
      exitType:              'RESIGNED',
      resignationDate:       now,
      resignationSubmittedAt:now,
      resignationReason:     reason,
      resignationRequests:   requests || null,
      resignationInitiatedBy:'SELF',
      resignationInitiatorId: me.id,
      noticePeriodDays:      noticeDays,
      expectedLwd,
    },
  })

  // Create clearance record
  await prisma.exitClearance.upsert({
    where:  { employeeId: emp.id },
    create: { employeeId: emp.id },
    update: {},
  })

  await logHistory(emp.id, 'SUBMITTED', me.id, me.name, me.role, `Self-resignation. Notice: ${noticeDays} days`)

  // Email HR + super admin
  const hrEmails = await getHREmails()
  await sendResignationSubmittedToHR(hrEmails, emp.name, emp.employeeCode, fmtDate(now), fmtDate(expectedLwd))

  res.json({ success: true, data: { expectedLwd, noticePeriodDays: noticeDays } })
})

// ─── HR/SUPER ADMIN INITIATE EXIT ────────────────────────────────────────────
// POST /api/exit/:id/initiate

exitRouter.post('/:id/initiate', requireHR, async (req, res) => {
  const me = req.user!
  const { exitType, reason, resignationDate } = z.object({
    exitType:        z.enum(['RESIGNED', 'TERMINATED', 'ABSCONDED']),
    reason:          z.string().min(1),
    resignationDate: z.string().optional(),
  }).parse(req.body)

  const emp = await prisma.employee.findUnique({ where: { id: req.params.id } })
  if (!emp) throw new AppError('Employee not found', 404)
  if (emp.status !== 'ACTIVE') throw new AppError('Employee is not active', 400)

  const noticeDays  = await getNoticeDays(exitType)
  const resDate     = resignationDate ? new Date(resignationDate) : new Date()
  const expectedLwd = addDays(resDate, noticeDays)

  await prisma.employee.update({
    where: { id: emp.id },
    data: {
      status:                'ON_NOTICE',
      exitType,
      resignationDate:       resDate,
      resignationSubmittedAt:resDate,
      resignationReason:     reason,
      resignationInitiatedBy: me.role,
      resignationInitiatorId: me.id,
      noticePeriodDays:      noticeDays,
      expectedLwd,
    },
  })

  await prisma.exitClearance.upsert({
    where:  { employeeId: emp.id },
    create: { employeeId: emp.id },
    update: {},
  })

  await logHistory(emp.id, `INITIATED_BY_${me.role}`, me.id, me.name, me.role, `${exitType} — ${reason}`)

  // Email employee
  await sendExitInitiatedToEmployee(emp.email, emp.name, exitType, me.name, fmtDate(expectedLwd))

  res.json({ success: true, data: { expectedLwd, noticePeriodDays: noticeDays } })
})

// ─── UPDATE EXIT DETAILS (HR/SA) ──────────────────────────────────────────────
// PATCH /api/exit/:id/details

exitRouter.patch('/:id/details', requireHR, async (req, res) => {
  const me = req.user!
  const { lastWorkingDay, exitType, noticePeriodServed, buyoutAmount, resignationDate } = req.body

  const emp = await prisma.employee.findUnique({ where: { id: req.params.id } })
  if (!emp) throw new AppError('Employee not found', 404)

  const data: any = {}
  if (lastWorkingDay   !== undefined) data.lastWorkingDay   = new Date(lastWorkingDay)
  if (exitType         !== undefined) data.exitType         = exitType
  if (resignationDate  !== undefined) data.resignationDate  = new Date(resignationDate)
  if (noticePeriodServed !== undefined) data.noticePeriodServed = noticePeriodServed
  if (buyoutAmount     !== undefined) data.buyoutAmount     = buyoutAmount

  await prisma.employee.update({ where: { id: req.params.id }, data })
  await logHistory(emp.id, 'UPDATED', me.id, me.name, me.role, 'Exit details updated')

  res.json({ success: true })
})

// ─── UPDATE CLEARANCE ────────────────────────────────────────────────────────
// PATCH /api/exit/:id/clearance

exitRouter.patch('/:id/clearance', requireHR, async (req, res) => {
  const me = req.user!
  const { itClearance, assetReturned, financeClearance, managerClearance } = req.body

  const clearance = await prisma.exitClearance.upsert({
    where:  { employeeId: req.params.id },
    create: { employeeId: req.params.id },
    update: {},
  })

  const data: any = {}
  const now = new Date()

  if (itClearance !== undefined) {
    data.itClearance = itClearance
    if (itClearance) { data.itClearedAt = now; data.itClearedBy = me.id; data.itClearedByName = me.name }
  }
  if (assetReturned !== undefined) {
    data.assetReturned = assetReturned
    if (assetReturned) { data.assetReturnedAt = now; data.assetReturnedBy = me.id; data.assetReturnedByName = me.name }
  }
  if (financeClearance !== undefined) {
    data.financeClearance = financeClearance
    if (financeClearance) { data.financeClearedAt = now; data.financeClearedBy = me.id; data.financeClearedByName = me.name }
  }
  if (managerClearance !== undefined) {
    data.managerClearance = managerClearance
    if (managerClearance) { data.managerClearedAt = now; data.managerClearedBy = me.id; data.managerClearedByName = me.name }
  }

  const updated = await prisma.exitClearance.update({ where: { id: clearance.id }, data })

  // Check if all clearances done
  if (updated.itClearance && updated.assetReturned && updated.financeClearance && updated.managerClearance) {
    const emp = await prisma.employee.findUnique({ where: { id: req.params.id }, select: { name: true, employeeCode: true } })
    const adminEmails = await getSuperAdminEmails()
    if (emp) await sendAllClearanceDoneToSuperAdmin(adminEmails, emp.name, emp.employeeCode)
  }

  res.json({ success: true, data: updated })
})

// ─── UPDATE EXIT INTERVIEW ────────────────────────────────────────────────────
// PATCH /api/exit/:id/interview

exitRouter.patch('/:id/interview', requireHR, async (req, res) => {
  const me = req.user!
  const { isDone, interviewDate, notes } = req.body

  const data: any = {}
  if (isDone        !== undefined) { data.isDone = isDone; if (isDone) { data.conductedBy = me.id; data.conductedByName = me.name } }
  if (interviewDate !== undefined) data.interviewDate = new Date(interviewDate)
  if (notes         !== undefined) data.notes = notes

  const interview = await prisma.exitInterview.upsert({
    where:  { employeeId: req.params.id },
    create: { employeeId: req.params.id, ...data },
    update: data,
  })

  res.json({ success: true, data: interview })
})

// ─── UNLOCK F&F (SUPER ADMIN ONLY) ────────────────────────────────────────────
// PATCH /api/exit/:id/ff-unlock

exitRouter.patch('/:id/ff-unlock', requireSuperAdmin, async (req, res) => {
  const me = req.user!

  const clearance = await prisma.exitClearance.findUnique({ where: { employeeId: req.params.id } })
  if (!clearance) throw new AppError('No clearance record found', 404)
  if (!clearance.itClearance || !clearance.assetReturned || !clearance.financeClearance || !clearance.managerClearance) {
    throw new AppError('All clearances must be completed before unlocking F&F', 400)
  }

  await prisma.exitClearance.update({
    where: { employeeId: req.params.id },
    data:  { ffUnlocked: true, ffUnlockedAt: new Date(), ffUnlockedBy: me.id, ffUnlockedByName: me.name },
  })

  await logHistory(req.params.id, 'FF_UNLOCKED', me.id, me.name, me.role)
  res.json({ success: true })
})

// ─── ENABLE WITHDRAWAL (SUPER ADMIN ONLY) ────────────────────────────────────
// PATCH /api/exit/:id/enable-withdrawal

exitRouter.patch('/:id/enable-withdrawal', requireSuperAdmin, async (req, res) => {
  const me = req.user!
  const { enabled } = z.object({ enabled: z.boolean() }).parse(req.body)

  const emp = await prisma.employee.findUnique({ where: { id: req.params.id } })
  if (!emp) throw new AppError('Employee not found', 404)
  if (emp.status !== 'ON_NOTICE') throw new AppError('Employee is not on notice', 400)

  await prisma.employee.update({ where: { id: req.params.id }, data: { withdrawalEnabled: enabled } })
  await logHistory(emp.id, enabled ? 'WITHDRAWAL_ENABLED' : 'WITHDRAWAL_DISABLED', me.id, me.name, me.role)

  if (enabled) await sendWithdrawalEnabledToEmployee(emp.email, emp.name)

  res.json({ success: true })
})

// ─── EMPLOYEE WITHDRAWAL ─────────────────────────────────────────────────────
// POST /api/exit/:id/withdraw

exitRouter.post('/:id/withdraw', async (req, res) => {
  const me = req.user!
  if (me.id !== req.params.id) throw new AppError('Access denied', 403)

  const emp = await prisma.employee.findUnique({ where: { id: req.params.id } })
  if (!emp) throw new AppError('Employee not found', 404)
  if (emp.status !== 'ON_NOTICE') throw new AppError('No active resignation to withdraw', 400)
  if (!emp.withdrawalEnabled) throw new AppError('Withdrawal is not enabled for your resignation', 403)

  await prisma.employee.update({
    where: { id: emp.id },
    data: {
      status:           'ACTIVE',
      exitType:         null,
      resignationDate:  null,
      lastWorkingDay:   null,
      expectedLwd:      null,
      noticePeriodDays: null,
      resignationSubmittedAt: null,
      resignationReason:null,
      resignationRequests: null,
      resignationInitiatedBy: null,
      resignationInitiatorId: null,
      withdrawalEnabled:false,
      withdrawnAt:      new Date(),
    },
  })

  await prisma.exitClearance.deleteMany({ where: { employeeId: emp.id } })
  await prisma.exitInterview.deleteMany({ where: { employeeId: emp.id } })
  await logHistory(emp.id, 'WITHDRAWN', me.id, me.name, me.role)

  const hrEmails = await getHREmails()
  await sendWithdrawalToHR(hrEmails, emp.name, emp.employeeCode)

  res.json({ success: true })
})

// ─── CONVERT LOP → PAID LEAVE (SUPER ADMIN ONLY) ─────────────────────────────
// POST /api/exit/:id/convert-lop

exitRouter.post('/:id/convert-lop', requireSuperAdmin, async (req, res) => {
  const me = req.user!
  const { applicationId } = z.object({ applicationId: z.string() }).parse(req.body)

  const app = await prisma.lvApplication.findUnique({ where: { id: applicationId } })
  if (!app) throw new AppError('Leave application not found', 404)
  if (app.employeeId !== req.params.id) throw new AppError('Application does not belong to this employee', 400)
  if (!app.isLop) throw new AppError('This is not an LOP application', 400)

  // Convert to paid — remove LOP flag, restore from lopDays to usedDays properly
  const year = new Date(app.startDate).getFullYear()
  await prisma.$transaction([
    prisma.lvApplication.update({
      where: { id: applicationId },
      data: { isLop: false, lopDays: 0, status: 'APPROVED', approvedById: me.id, approvedByName: me.name, approvedAt: new Date() },
    }),
    prisma.leaveEntitlement.update({
      where: { employeeId_leaveKind_year: { employeeId: req.params.id, leaveKind: app.leaveKind, year } },
      data: {
        lopDays:  { decrement: app.lopDays },
        usedDays: { increment: app.lopDays },
      },
    }),
  ])

  await logHistory(req.params.id, 'LOP_CONVERTED_TO_PAID', me.id, me.name, me.role, `Application ${applicationId}`)
  res.json({ success: true })
})

// ─── SEPARATE EMPLOYEE (SUPER ADMIN ONLY) ────────────────────────────────────
// POST /api/exit/:id/separate

exitRouter.post('/:id/separate', requireSuperAdmin, async (req, res) => {
  const me = req.user!

  const emp = await prisma.employee.findUnique({
    where: { id: req.params.id },
    include: { exitClearance: true },
  })
  if (!emp) throw new AppError('Employee not found', 404)
  if (emp.status !== 'ON_NOTICE') throw new AppError('Employee must be ON_NOTICE to separate', 400)

  const cl = emp.exitClearance
  if (!cl || !cl.itClearance || !cl.assetReturned || !cl.financeClearance || !cl.managerClearance) {
    throw new AppError('All clearances must be completed before separation', 400)
  }
  if (!cl.ffUnlocked) throw new AppError('F&F must be unlocked before separation', 400)

  const lwd = emp.lastWorkingDay || emp.expectedLwd || new Date()
  await prisma.employee.update({
    where: { id: emp.id },
    data:  { status: 'SEPARATED', lastWorkingDay: lwd, withdrawalEnabled: false },
  })

  await logHistory(emp.id, 'SEPARATED', me.id, me.name, me.role)
  await sendSeparatedToEmployee(emp.email, emp.name, fmtDate(lwd))

  res.json({ success: true })
})

// ─── GET LOP LEAVES FOR NOTICE PERIOD (SUPER ADMIN) ─────────────────────────
// GET /api/exit/:id/lop-leaves

exitRouter.get('/:id/lop-leaves', requireSuperAdmin, async (req, res) => {
  const emp = await prisma.employee.findUnique({ where: { id: req.params.id } })
  if (!emp) throw new AppError('Employee not found', 404)

  const apps = await prisma.lvApplication.findMany({
    where: {
      employeeId: req.params.id,
      isLop:      true,
      startDate:  { gte: emp.resignationDate || emp.resignationSubmittedAt || new Date() },
    },
    orderBy: { createdAt: 'desc' },
  })

  res.json({ success: true, data: apps })
})
