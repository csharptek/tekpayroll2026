import { prisma } from '../utils/prisma'

// ─── PAYROLL ELIGIBILITY ─────────────────────────────────────────────────────
// Single source of truth for which employees a payroll cycle picks up.
// Excluded:
//   • SEPARATED / INACTIVE employees
//   • F&F already done (wizard COMPLETED, or settlement APPROVED / SETTLED)
//   • Last working day before the cycle starts

export async function getPayrollEligibleEmployees(cycleStart: Date, extraWhere: any = {}) {
  const employees = await prisma.employee.findMany({
    where: { status: { in: ['ACTIVE', 'ON_NOTICE'] }, ...extraWhere },
    include: {
      fnfWizardSession: { select: { status: true } },
      fnfSettlement:    { select: { status: true } },
    },
    orderBy: { name: 'asc' },
  })
  return employees.filter(e => isPayrollEligible(e, cycleStart))
}

export function isPayrollEligible(emp: any, cycleStart: Date): boolean {
  if (!['ACTIVE', 'ON_NOTICE'].includes(emp.status)) return false
  if (emp.fnfWizardSession?.status === 'COMPLETED') return false
  if (emp.fnfSettlement && ['APPROVED', 'SETTLED'].includes(emp.fnfSettlement.status)) return false
  if (emp.lastWorkingDay && new Date(emp.lastWorkingDay) < new Date(cycleStart)) return false
  return true
}

// ─── LEAVE → LOP SYNC ────────────────────────────────────────────────────────
// Leave LOP applied before a cycle exists used to land in an older open cycle.
// This rebuilds the floor from approved LOP leaves whose start date falls in
// the cycle range. Never lowers an existing (possibly manual) LOP entry.

export async function syncLeaveLopForCycle(cycle: { id: string; cycleStart: Date; cycleEnd: Date; status: string }) {
  if (!['DRAFT', 'CALCULATED'].includes(cycle.status)) return

  const end = new Date(cycle.cycleEnd)
  end.setHours(23, 59, 59, 999)

  const apps = await prisma.lvApplication.findMany({
    where: {
      status:    { in: ['APPROVED', 'AUTO_APPROVED'] },
      isLop:     true,
      startDate: { gte: cycle.cycleStart, lte: end },
    },
    select: { employeeId: true, lopDays: true },
  })

  const sums = new Map<string, number>()
  for (const a of apps) {
    sums.set(a.employeeId, (sums.get(a.employeeId) || 0) + Number(a.lopDays || 0))
  }

  for (const [employeeId, leaveLop] of sums) {
    if (leaveLop <= 0) continue
    const existing = await prisma.lopEntry.findUnique({
      where: { cycleId_employeeId: { cycleId: cycle.id, employeeId } },
    })
    if (existing && Number(existing.lopDays) >= leaveLop) continue
    await prisma.lopEntry.upsert({
      where:  { cycleId_employeeId: { cycleId: cycle.id, employeeId } },
      create: { cycleId: cycle.id, employeeId, lopDays: leaveLop },
      update: { lopDays: leaveLop },
    })
  }
}
