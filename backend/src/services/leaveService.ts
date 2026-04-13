import { AppError } from '../middleware/errorHandler'
import { prisma } from '../utils/prisma'
import { LeaveKind, LeaveStatus, HalfDaySlot, CancellationStatus } from '@prisma/client'

// ─── CONSTANTS ────────────────────────────────────────────────────────────────

export const LEAVE_YEAR_START_MONTH = 0  // January (0-indexed)
export const LEAVE_YEAR_END_MONTH   = 11 // December

// ─── HELPERS ──────────────────────────────────────────────────────────────────

export function getCurrentLeaveYear(): number {
  return new Date().getFullYear()
}

export function getLeaveYear(date: Date): number {
  return date.getFullYear()
}

// Get all public holidays for a given year as Set of date strings "YYYY-MM-DD"
async function getHolidaySet(year: number): Promise<Set<string>> {
  const holidays = await prisma.publicHoliday.findMany({ where: { year } })
  return new Set(holidays.map(h => h.date.toISOString().slice(0, 10)))
}

// Count working days between two dates (inclusive), excluding weekends + public holidays
export async function countWorkingDays(
  startDate: Date,
  endDate:   Date,
  isHalfDay: boolean = false
): Promise<number> {
  if (isHalfDay) return 0.5

  const holidaySet = await getHolidaySet(startDate.getFullYear())
  let count = 0
  const cur = new Date(startDate)
  cur.setHours(12, 0, 0, 0)
  const end = new Date(endDate)
  end.setHours(12, 0, 0, 0)

  while (cur <= end) {
    const dow = cur.getDay()
    const dateStr = cur.toISOString().slice(0, 10)
    if (dow !== 0 && dow !== 6 && !holidaySet.has(dateStr)) {
      count++
    }
    cur.setDate(cur.getDate() + 1)
  }
  return count
}

// Pro-rata calculation on joining
// FY: Jan–Dec. If joined before/on 15th = full month counted, after 15th = 0.5 month
export function calculateProRataLeaves(
  joiningDate:      Date,
  annualAllocation: number,
  year:             number
): number {
  const fyEnd = new Date(year, 11, 31) // Dec 31
  if (joiningDate > fyEnd) return 0

  const fyStart = new Date(year, 0, 1) // Jan 1
  const effectiveStart = joiningDate > fyStart ? joiningDate : fyStart

  let months = 0
  const startMonth = effectiveStart.getMonth()
  const startDay   = effectiveStart.getDate()
  const endMonth   = 11 // December

  for (let m = startMonth; m <= endMonth; m++) {
    if (m === startMonth) {
      if (startDay <= 15) months += 1
      else months += 0.5
    } else {
      months += 1
    }
  }

  const allocation = (annualAllocation / 12) * months
  // Round to nearest 0.5
  return Math.round(allocation * 2) / 2
}

// Get or create leave policy for company
export async function getLeavePolicy() {
  const company = await prisma.company.findFirst()
  if (!company) throw new AppError('Company not configured', 500)

  let policy = await prisma.leavePolicy.findUnique({ where: { companyId: company.id } })
  if (!policy) {
    policy = await prisma.leavePolicy.create({
      data: { companyId: company.id },
    })
  }
  return policy
}

// ─── GRANT JOINING LEAVES ─────────────────────────────────────────────────────
// Called when employee is created.
// Trainees: no entitlements (all LWP).
// Probation employees: entitlements created with activatesOn = probationEndDate,
//   pro-rata calculated from probation end date.
// Normal employees: immediate, pro-rata from joining date.

export async function grantJoiningLeaves(
  employeeId: string,
  joiningDate: Date,
  isTrainee: boolean = false,
  probationMonthsOverride?: number
) {
  if (isTrainee) return // Trainees get no leave entitlements

  const policy = await getLeavePolicy()
  const probationMonths = probationMonthsOverride ?? policy.probationMonths

  // Calculate probation end date
  const probationEndDate = new Date(joiningDate)
  probationEndDate.setMonth(probationEndDate.getMonth() + probationMonths)

  const today = new Date(); today.setHours(0, 0, 0, 0)
  const onProbation = probationEndDate > today

  // Pro-rata calculated from probation end date
  const effectiveDate = probationEndDate
  const year = getLeaveYear(effectiveDate)

  const kinds: { kind: LeaveKind; annual: number }[] = [
    { kind: LeaveKind.SICK,    annual: policy.sickDaysPerYear    },
    { kind: LeaveKind.CASUAL,  annual: policy.casualDaysPerYear  },
    { kind: LeaveKind.PLANNED, annual: policy.plannedDaysPerYear },
  ]

  for (const { kind, annual } of kinds) {
    const totalDays = calculateProRataLeaves(effectiveDate, annual, year)
    await prisma.leaveEntitlement.upsert({
      where:  { employeeId_leaveKind_year: { employeeId, leaveKind: kind, year } },
      create: {
        employeeId, leaveKind: kind, year, totalDays,
        activatesOn: onProbation ? probationEndDate : null,
      },
      update: {
        totalDays,
        activatesOn: onProbation ? probationEndDate : null,
      },
    })
  }
}

// ─── EMPLOYEE LEAVE STATUS ────────────────────────────────────────────────────
// Returns restriction info for the employee.

export type LeaveRestriction =
  | { type: 'TRAINEE' }
  | { type: 'PROBATION'; probationEndDate: Date }
  | { type: 'NOTICE' }
  | { type: 'NONE' }

export async function getEmployeeLeaveRestriction(employeeId: string): Promise<LeaveRestriction> {
  const emp = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: {
      status: true,
      isTrainee: true,
      joiningDate: true,
      employmentDetail: { select: { probationMonths: true } },
    },
  })
  if (!emp) return { type: 'NONE' }

  if (emp.isTrainee) return { type: 'TRAINEE' }
  if (emp.status === 'ON_NOTICE') return { type: 'NOTICE' }

  const policy = await getLeavePolicy()
  const probMonths = emp.employmentDetail?.probationMonths ?? policy.probationMonths
  const probEnd = new Date(emp.joiningDate)
  probEnd.setMonth(probEnd.getMonth() + probMonths)
  const today = new Date(); today.setHours(0, 0, 0, 0)

  if (probEnd > today) return { type: 'PROBATION', probationEndDate: probEnd }
  return { type: 'NONE' }
}

// ─── GET EMPLOYEE BALANCE ─────────────────────────────────────────────────────

export async function getEmployeeBalance(employeeId: string, year?: number) {
  const y = year || getCurrentLeaveYear()
  const today = new Date(); today.setHours(0, 0, 0, 0)

  const restriction = await getEmployeeLeaveRestriction(employeeId)

  // Trainee, notice, or on probation → show zero balance
  if (restriction.type !== 'NONE') {
    return {
      SICK:    { total: 0, carryForward: 0, used: 0, pending: 0, lop: 0, remaining: 0 },
      CASUAL:  { total: 0, carryForward: 0, used: 0, pending: 0, lop: 0, remaining: 0 },
      PLANNED: { total: 0, carryForward: 0, used: 0, pending: 0, lop: 0, remaining: 0 },
      _restriction: restriction,
    }
  }

  const entitlements = await prisma.leaveEntitlement.findMany({
    where: {
      employeeId, year: y,
      OR: [
        { activatesOn: null },
        { activatesOn: { lte: today } },
      ],
    },
  })

  const balance: Record<string, any> = {}
  for (const e of entitlements) {
    const remaining = Number(e.totalDays) + Number(e.carryForward) - Number(e.usedDays) - Number(e.pendingDays)
    balance[e.leaveKind] = {
      total:        Number(e.totalDays),
      carryForward: Number(e.carryForward),
      used:         Number(e.usedDays),
      pending:      Number(e.pendingDays),
      lop:          Number(e.lopDays),
      remaining:    Math.max(0, remaining),
    }
  }
  // Fill missing kinds with zero
  for (const kind of ['SICK', 'CASUAL', 'PLANNED']) {
    if (!balance[kind]) balance[kind] = { total: 0, carryForward: 0, used: 0, pending: 0, lop: 0, remaining: 0 }
  }
  balance._restriction = restriction
  return balance
}

// ─── VALIDATE LEAVE APPLICATION ───────────────────────────────────────────────

export async function validateLeaveApplication(params: {
  employeeId: string
  leaveKind:  LeaveKind
  startDate:  Date
  endDate:    Date
  isHalfDay:   boolean
  halfDaySlot?: string | null
  isBackdated: boolean
}) {
  const { employeeId, leaveKind, startDate, endDate, isHalfDay, halfDaySlot, isBackdated } = params
  const policy = await getLeavePolicy()
  const today  = new Date(); today.setHours(0, 0, 0, 0)

  // 1. Advance notice check (skip for backdated sick leave)
  const advanceDays = {
    SICK:    policy.sickAdvanceDays,
    CASUAL:  policy.casualAdvanceDays,
    PLANNED: policy.plannedAdvanceDays,
  }[leaveKind]

  const applyFrom = new Date(today)
  applyFrom.setDate(applyFrom.getDate() + advanceDays)

  if (!isBackdated && startDate < applyFrom) {
    throw new AppError(`${leaveKind} leave requires at least ${advanceDays} day(s) advance notice`, 400)
  }

  // 2. Backdated casual — never auto-approve, handled in apply logic
  // 3. Check for overlapping applications
  const overlaps = await prisma.lvApplication.findMany({
    where: {
      employeeId,
      status: { in: [LeaveStatus.PENDING, LeaveStatus.APPROVED, LeaveStatus.AUTO_APPROVED] },
      startDate: { lte: endDate },
      endDate:   { gte: startDate },
    },
    select: { id: true, isHalfDay: true, halfDaySlot: true, startDate: true, endDate: true },
  })

  for (const existing of overlaps) {
    // Allow two half-days on the same single date if slots are different
    const singleDaySame =
      isHalfDay &&
      existing.isHalfDay &&
      startDate.getTime() === endDate.getTime() &&
      existing.startDate.getTime() === existing.endDate.getTime() &&
      startDate.getTime() === existing.startDate.getTime()

    if (singleDaySame) {
      // Block if same slot already taken
      if (halfDaySlot && existing.halfDaySlot && halfDaySlot === existing.halfDaySlot) {
        throw new AppError(`You already have a ${halfDaySlot.replace('_', ' ').toLowerCase()} leave on this date`, 400)
      }
      continue
    }

    throw new AppError('You already have a leave application overlapping these dates', 400)
  }

  return true
}

// ─── APPLY LEAVE ──────────────────────────────────────────────────────────────

export async function applyLeave(params: {
  employeeId:   string
  leaveKind:    LeaveKind
  startDate:    Date
  endDate:      Date
  isHalfDay:    boolean
  halfDaySlot?: HalfDaySlot
  reasonId?:    string
  reasonLabel:  string
  customReason?: string
}) {
  const { employeeId, leaveKind, startDate, endDate, isHalfDay, halfDaySlot,
          reasonId, reasonLabel, customReason } = params

  const today = new Date(); today.setHours(0, 0, 0, 0)
  const isBackdated = startDate < today

  // Check restriction status
  const restriction = await getEmployeeLeaveRestriction(employeeId)
  const isOnNotice   = restriction.type === 'NOTICE'
  const isOnProbation = restriction.type === 'PROBATION'
  const isTrainee    = restriction.type === 'TRAINEE'
  // All three force LOP — leave can still be applied
  const forceLop = isOnNotice || isOnProbation || isTrainee

  await validateLeaveApplication({ employeeId, leaveKind, startDate, endDate, isHalfDay, halfDaySlot, isBackdated })

  const totalDays = await countWorkingDays(startDate, endDate, isHalfDay)
  if (totalDays === 0) throw new AppError('No working days in the selected date range. Please avoid weekends and public holidays.', 400)

  const year = getLeaveYear(startDate)
  const policy = await getLeavePolicy()

  // Check balance
  // For forced-LOP cases (probation/trainee/notice), find entitlement ignoring activatesOn
  let entitlement = await prisma.leaveEntitlement.findUnique({
    where: { employeeId_leaveKind_year: { employeeId, leaveKind, year } },
  })
  if (!entitlement) {
    // Grant full year allocation if missing (e.g. employee existed before module)
    const annual = {
      SICK:    policy.sickDaysPerYear,
      CASUAL:  policy.casualDaysPerYear,
      PLANNED: policy.plannedDaysPerYear,
    }[leaveKind]
    entitlement = await prisma.leaveEntitlement.create({
      data: { employeeId, leaveKind, year, totalDays: forceLop ? 0 : annual },
    })
  }

  const available = Number(entitlement.totalDays) + Number(entitlement.carryForward)
                  - Number(entitlement.usedDays) - Number(entitlement.pendingDays)
  // Force LOP for probation/trainee/notice regardless of balance
  const isLop  = forceLop ? true : available < totalDays
  const lopDays = forceLop ? totalDays : (available < totalDays ? totalDays - Math.max(0, available) : 0)

  // Determine status
  // Sick: auto-approve (unless backdated — also auto-approve for sick)
  // Casual backdated: PENDING (manual only)
  // Others: PENDING
  let status: LeaveStatus = LeaveStatus.PENDING
  if (leaveKind === LeaveKind.SICK) {
    status = LeaveStatus.AUTO_APPROVED
  }

  const application = await prisma.lvApplication.create({
    data: {
      employeeId, leaveKind, startDate, endDate, totalDays, isHalfDay,
      halfDaySlot: isHalfDay ? halfDaySlot : null,
      reasonId, reasonLabel, customReason, isBackdated,
      status, isLop, lopDays,
    },
  })

  // Update entitlement
  if (status === LeaveStatus.AUTO_APPROVED) {
    // Deduct immediately for auto-approved
    await prisma.leaveEntitlement.update({
      where: { employeeId_leaveKind_year: { employeeId, leaveKind, year } },
      data: {
        usedDays: { increment: totalDays - lopDays },
        lopDays:  { increment: lopDays },
      },
    })
    // Create LOP entry if needed
    if (isLop && lopDays > 0) {
      await createLopFromLeave(employeeId, application.id, lopDays)
    }
  } else {
    // Pending — reserve as pending days
    await prisma.leaveEntitlement.update({
      where: { employeeId_leaveKind_year: { employeeId, leaveKind, year } },
      data: { pendingDays: { increment: totalDays } },
    })
  }

  return application
}

// ─── APPROVE LEAVE ────────────────────────────────────────────────────────────

export async function approveLeave(
  applicationId: string,
  approvedById:  string,
  approvedByName: string
) {
  const app = await prisma.lvApplication.findUnique({ where: { id: applicationId } })
  if (!app) throw new AppError('Leave application not found', 404)
  if (app.status !== LeaveStatus.PENDING) throw new AppError('Only pending applications can be approved', 400)

  const year = getLeaveYear(app.startDate)

  await prisma.lvApplication.update({
    where: { id: applicationId },
    data: {
      status: LeaveStatus.APPROVED,
      approvedById, approvedByName,
      approvedAt: new Date(),
    },
  })

  // Move from pending → used
  await prisma.leaveEntitlement.update({
    where: { employeeId_leaveKind_year: { employeeId: app.employeeId, leaveKind: app.leaveKind, year } },
    data: {
      pendingDays: { decrement: Number(app.totalDays) },
      usedDays:    { increment: Number(app.totalDays) - Number(app.lopDays) },
      lopDays:     { increment: Number(app.lopDays) },
    },
  })

  if (app.isLop && Number(app.lopDays) > 0) {
    await createLopFromLeave(app.employeeId, applicationId, Number(app.lopDays))
  }

  return app
}

// ─── DECLINE LEAVE ────────────────────────────────────────────────────────────

export async function declineLeave(
  applicationId:  string,
  declinedById:   string,
  declinedByName: string,
  reason:         string
) {
  const app = await prisma.lvApplication.findUnique({ where: { id: applicationId } })
  if (!app) throw new AppError('Leave application not found', 404)
  if (app.status !== LeaveStatus.PENDING) throw new AppError('Only pending applications can be declined', 400)

  const year = getLeaveYear(app.startDate)

  await prisma.lvApplication.update({
    where: { id: applicationId },
    data: { status: LeaveStatus.DECLINED, declineReason: reason, approvedById: declinedById, approvedByName: declinedByName, approvedAt: new Date() },
  })

  // Release pending days
  await prisma.leaveEntitlement.update({
    where: { employeeId_leaveKind_year: { employeeId: app.employeeId, leaveKind: app.leaveKind, year } },
    data: { pendingDays: { decrement: Number(app.totalDays) } },
  })

  return app
}

// ─── CANCEL LEAVE (employee request) ─────────────────────────────────────────

export async function requestCancellation(params: {
  applicationId:   string
  requestedById:   string
  requestedByName: string
  requestedByRole: string
  reason?:         string
}) {
  const { applicationId, requestedById, requestedByName, requestedByRole, reason } = params
  const app = await prisma.lvApplication.findUnique({ where: { id: applicationId } })
  if (!app) throw new AppError('Leave application not found', 404)
  if (!([LeaveStatus.PENDING, LeaveStatus.APPROVED, LeaveStatus.AUTO_APPROVED] as string[]).includes(app.status as string)) {
    throw new AppError('This leave cannot be cancelled', 400)
  }

  const today = new Date(); today.setHours(0, 0, 0, 0)
  const notStarted = app.startDate > today

  if (notStarted) {
    // Auto-cancel immediately
    await cancelLeaveDirectly(applicationId, requestedById, requestedByName, LeaveStatus.CANCELLED)
    return { autoCancelled: true }
  }

  // Leave has started — create cancellation request for HR
  const year = getLeaveYear(app.startDate)
  const daysToRestore = await countWorkingDays(
    today > app.startDate ? today : app.startDate,
    app.endDate
  )

  const req = await prisma.lvCancellationRequest.create({
    data: {
      applicationId, requestedById, requestedByName, requestedByRole,
      type: 'FULL', daysToRestore, reason,
      status: CancellationStatus.PENDING,
    },
  })
  return { autoCancelled: false, request: req }
}

// ─── CANCEL LEAVE DIRECTLY (HR/admin) ────────────────────────────────────────

export async function cancelLeaveDirectly(
  applicationId:  string,
  cancelledById:  string,
  cancelledByName: string,
  statusOverride?: LeaveStatus,
  newEndDate?:    Date  // for partial cancellation
) {
  const app = await prisma.lvApplication.findUnique({ where: { id: applicationId } })
  if (!app) throw new AppError('Leave application not found', 404)

  const year = getLeaveYear(app.startDate)
  const today = new Date(); today.setHours(0, 0, 0, 0)

  let daysToRestore: number

  if (newEndDate && newEndDate < app.endDate) {
    // Partial — restore days from newEndDate+1 to original endDate
    const restoreStart = new Date(newEndDate)
    restoreStart.setDate(restoreStart.getDate() + 1)
    daysToRestore = await countWorkingDays(restoreStart, app.endDate)

    // Update application to partial
    await prisma.lvApplication.update({
      where: { id: applicationId },
      data: {
        endDate: newEndDate,
        totalDays: { decrement: daysToRestore },
        status: LeaveStatus.APPROVED,
      },
    })
  } else {
    // Full cancel
    daysToRestore = Number(app.totalDays)
    await prisma.lvApplication.update({
      where: { id: applicationId },
      data: { status: (statusOverride as any) || LeaveStatus.CANCELLED },
    })
  }

  // Restore balance
  const wasApproved = ([LeaveStatus.APPROVED, LeaveStatus.AUTO_APPROVED] as string[]).includes(app.status as string)
  await prisma.leaveEntitlement.update({
    where: { employeeId_leaveKind_year: { employeeId: app.employeeId, leaveKind: app.leaveKind, year } },
    data: wasApproved
      ? { usedDays: { decrement: daysToRestore } }
      : { pendingDays: { decrement: daysToRestore } },
  })
}

// ─── APPROVE CANCELLATION REQUEST ────────────────────────────────────────────

export async function approveCancellationRequest(
  requestId:      string,
  respondedById:  string,
  respondedByName: string,
  newEndDate?:    Date
) {
  const req = await prisma.lvCancellationRequest.findUnique({ where: { id: requestId } })
  if (!req) throw new AppError('Cancellation request not found', 404)

  await cancelLeaveDirectly(req.applicationId, respondedById, respondedByName, undefined, newEndDate)

  await prisma.lvCancellationRequest.update({
    where: { id: requestId },
    data: { status: CancellationStatus.APPROVED, respondedById, respondedByName, respondedAt: new Date() },
  })
}

// ─── DECLINE CANCELLATION REQUEST ────────────────────────────────────────────

export async function declineCancellationRequest(
  requestId:      string,
  respondedById:  string,
  respondedByName: string,
  declineReason:  string
) {
  await prisma.lvCancellationRequest.update({
    where: { id: requestId },
    data: { status: CancellationStatus.DECLINED, respondedById, respondedByName, respondedAt: new Date(), declineReason },
  })
}

// ─── AUTO-APPROVE PENDING LEAVES ─────────────────────────────────────────────
// Called on payroll run. Approves all non-backdated-casual pending leaves.

export async function autoApprovePendingLeaves() {
  const pending = await prisma.lvApplication.findMany({
    where: {
      status: LeaveStatus.PENDING,
      NOT: {
        AND: [
          { leaveKind: LeaveKind.CASUAL },
          { isBackdated: true },
        ],
      },
    },
  })

  for (const app of pending) {
    await approveLeave(app.id, 'SYSTEM', 'Auto-Approve (Payroll Run)')
  }

  return pending.length
}

// ─── MONTHLY SNAPSHOT ─────────────────────────────────────────────────────────
// Called on payroll run. Saves balance snapshot for each employee.

export async function takeMonthlySnapshot(payrollCycleId: string, payrollMonth: string) {
  const year = getCurrentLeaveYear()
  const employees = await prisma.employee.findMany({
    where: { status: { in: ['ACTIVE', 'ON_NOTICE'] } },
    select: { id: true },
  })

  for (const emp of employees) {
    const bal = await getEmployeeBalance(emp.id, year)
    const s = (kind: string) => bal[kind] || { total: 0, carryForward: 0, used: 0, pending: 0, remaining: 0 }

    await prisma.leaveBalanceSnapshot.upsert({
      where: { employeeId_snapshotMonth: { employeeId: emp.id, snapshotMonth: payrollMonth } },
      create: {
        employeeId: emp.id, payrollCycleId, snapshotMonth: payrollMonth, year,
        sickTotal:     s('SICK').total,    sickUsed:    s('SICK').used,    sickPending:    s('SICK').pending,    sickBalance:    s('SICK').remaining,
        casualTotal:   s('CASUAL').total,  casualUsed:  s('CASUAL').used,  casualPending:  s('CASUAL').pending,  casualBalance:  s('CASUAL').remaining,
        plannedTotal:  s('PLANNED').total, plannedUsed: s('PLANNED').used, plannedPending: s('PLANNED').pending, plannedBalance: s('PLANNED').remaining,
        plannedCarry:  s('PLANNED').carryForward,
      },
      update: {
        sickTotal:     s('SICK').total,    sickUsed:    s('SICK').used,    sickPending:    s('SICK').pending,    sickBalance:    s('SICK').remaining,
        casualTotal:   s('CASUAL').total,  casualUsed:  s('CASUAL').used,  casualPending:  s('CASUAL').pending,  casualBalance:  s('CASUAL').remaining,
        plannedTotal:  s('PLANNED').total, plannedUsed: s('PLANNED').used, plannedPending: s('PLANNED').pending, plannedBalance: s('PLANNED').remaining,
        plannedCarry:  s('PLANNED').carryForward,
      },
    })
  }
}

// ─── YEAR-END ROLLOVER ────────────────────────────────────────────────────────
// Manual trigger. Window: 28 Dec – 5 Jan.

export async function triggerYearEndRollover(triggeredById: string, triggeredByName: string) {
  const today = new Date()
  const month = today.getMonth() // 0=Jan, 11=Dec
  const day   = today.getDate()

  const inWindow = (month === 11 && day >= 28) || (month === 0 && day <= 5)
  if (!inWindow) throw new AppError('Rollover can only be triggered between 28 December and 5 January', 400)

  const fromYear = month === 11 ? today.getFullYear() : today.getFullYear() - 1
  const toYear   = fromYear + 1
  const policy   = await getLeavePolicy()

  // Check not already done
  const existing = await prisma.leaveRolloverHistory.findFirst({ where: { fromYear } })
  if (existing) throw new AppError(`Rollover for ${fromYear} → ${toYear} already completed on ${existing.triggeredAt.toDateString()}`, 400)

  const employees = await prisma.employee.findMany({
    where: { status: { in: ['ACTIVE', 'ON_NOTICE'] } },
    select: { id: true, name: true, joiningDate: true },
  })

  const summary: any[] = []

  for (const emp of employees) {
    // Get current year planned entitlement
    const planned = await prisma.leaveEntitlement.findUnique({
      where: { employeeId_leaveKind_year: { employeeId: emp.id, leaveKind: LeaveKind.PLANNED, year: fromYear } },
    })

    const currentBalance = planned
      ? Math.max(0, Number(planned.totalDays) + Number(planned.carryForward) - Number(planned.usedDays) - Number(planned.pendingDays))
      : 0

    const carryForward = Math.min(currentBalance, policy.plannedCarryForwardMax)

    // New year allocation (full year — pro-rata only applies on joining)
    const newPlannedTotal = Math.min(
      policy.plannedDaysPerYear + carryForward,
      policy.plannedBalanceCap
    )

    // Create new year entitlements
    await prisma.leaveEntitlement.upsert({
      where: { employeeId_leaveKind_year: { employeeId: emp.id, leaveKind: LeaveKind.PLANNED, year: toYear } },
      create: { employeeId: emp.id, leaveKind: LeaveKind.PLANNED, year: toYear, totalDays: policy.plannedDaysPerYear, carryForward },
      update: { totalDays: policy.plannedDaysPerYear, carryForward },
    })
    await prisma.leaveEntitlement.upsert({
      where: { employeeId_leaveKind_year: { employeeId: emp.id, leaveKind: LeaveKind.SICK, year: toYear } },
      create: { employeeId: emp.id, leaveKind: LeaveKind.SICK, year: toYear, totalDays: policy.sickDaysPerYear },
      update: { totalDays: policy.sickDaysPerYear },
    })
    await prisma.leaveEntitlement.upsert({
      where: { employeeId_leaveKind_year: { employeeId: emp.id, leaveKind: LeaveKind.CASUAL, year: toYear } },
      create: { employeeId: emp.id, leaveKind: LeaveKind.CASUAL, year: toYear, totalDays: policy.casualDaysPerYear },
      update: { totalDays: policy.casualDaysPerYear },
    })

    summary.push({ employeeId: emp.id, name: emp.name, plannedCarried: carryForward, newPlannedTotal })
  }

  await prisma.leaveRolloverHistory.create({
    data: { fromYear, toYear, triggeredById, triggeredByName, employeeCount: employees.length, summary },
  })

  return { fromYear, toYear, employeeCount: employees.length, summary }
}

// ─── LOP HELPER ───────────────────────────────────────────────────────────────
// Creates a LOP entry in the existing LOP table linked to leave

async function createLopFromLeave(employeeId: string, leaveApplicationId: string, lopDays: number) {
  // Find the current payroll cycle (DRAFT or CALCULATED)
  const cycle = await prisma.payrollCycle.findFirst({
    where: { status: { in: ['DRAFT', 'CALCULATED'] } },
    orderBy: { cycleStart: 'desc' },
  })
  if (!cycle) return // No active cycle — LOP will be picked up next cycle

  await prisma.lopEntry.upsert({
    where: { cycleId_employeeId: { cycleId: cycle.id, employeeId } },
    create: {
      cycleId: cycle.id,
      employeeId,
      lopDays: Math.round(lopDays),
      reason: `Auto-LOP from leave application`,
    },
    update: {
      lopDays: { increment: Math.round(lopDays) },
    },
  })
}

// ─── SEED DEFAULT REASONS ────────────────────────────────────────────────────

export async function seedDefaultLeaveReasons() {
  const existing = await prisma.leaveReason.count()
  if (existing > 0) return // already seeded

  const reasons = [
    // SICK
    { leaveKind: LeaveKind.SICK, label: 'Fever / Cold',            sortOrder: 1 },
    { leaveKind: LeaveKind.SICK, label: 'Stomach Illness',         sortOrder: 2 },
    { leaveKind: LeaveKind.SICK, label: 'Headache / Migraine',     sortOrder: 3 },
    { leaveKind: LeaveKind.SICK, label: 'Medical Appointment',     sortOrder: 4 },
    { leaveKind: LeaveKind.SICK, label: 'Hospitalization',         sortOrder: 5 },
    { leaveKind: LeaveKind.SICK, label: 'Surgery / Recovery',      sortOrder: 6 },
    { leaveKind: LeaveKind.SICK, label: 'Chronic Condition',       sortOrder: 7 },
    { leaveKind: LeaveKind.SICK, label: 'Mental Health Day',       sortOrder: 8 },
    { leaveKind: LeaveKind.SICK, label: 'COVID / Viral Infection', sortOrder: 9 },
    { leaveKind: LeaveKind.SICK, label: 'Maternity / Paternity',   sortOrder: 10 },
    { leaveKind: LeaveKind.SICK, label: 'Other',                   sortOrder: 11 },
    // CASUAL
    { leaveKind: LeaveKind.CASUAL, label: 'Personal Work',               sortOrder: 1 },
    { leaveKind: LeaveKind.CASUAL, label: 'Family Function',             sortOrder: 2 },
    { leaveKind: LeaveKind.CASUAL, label: 'Home Emergency',              sortOrder: 3 },
    { leaveKind: LeaveKind.CASUAL, label: 'Civic Duty (Voting)',         sortOrder: 4 },
    { leaveKind: LeaveKind.CASUAL, label: 'Bank / Government Work',      sortOrder: 5 },
    { leaveKind: LeaveKind.CASUAL, label: 'Vehicle Breakdown',           sortOrder: 6 },
    { leaveKind: LeaveKind.CASUAL, label: 'Utility / Repair at Home',    sortOrder: 7 },
    { leaveKind: LeaveKind.CASUAL, label: "Child's School Event",        sortOrder: 8 },
    { leaveKind: LeaveKind.CASUAL, label: 'Maternity / Paternity',       sortOrder: 9 },
    { leaveKind: LeaveKind.CASUAL, label: 'Other',                       sortOrder: 10 },
    // PLANNED
    { leaveKind: LeaveKind.PLANNED, label: 'Vacation / Travel',      sortOrder: 1 },
    { leaveKind: LeaveKind.PLANNED, label: 'Wedding (Self)',          sortOrder: 2 },
    { leaveKind: LeaveKind.PLANNED, label: 'Wedding (Family)',        sortOrder: 3 },
    { leaveKind: LeaveKind.PLANNED, label: 'Festival Celebration',   sortOrder: 4 },
    { leaveKind: LeaveKind.PLANNED, label: 'Religious Observance',   sortOrder: 5 },
    { leaveKind: LeaveKind.PLANNED, label: 'Bereavement',            sortOrder: 6 },
    { leaveKind: LeaveKind.PLANNED, label: 'House Shifting',         sortOrder: 7 },
    { leaveKind: LeaveKind.PLANNED, label: 'Exam / Study Leave',     sortOrder: 8 },
    { leaveKind: LeaveKind.PLANNED, label: 'Maternity / Paternity',  sortOrder: 9 },
    { leaveKind: LeaveKind.PLANNED, label: 'Other',                  sortOrder: 10 },
  ]

  await prisma.leaveReason.createMany({ data: reasons })
}
