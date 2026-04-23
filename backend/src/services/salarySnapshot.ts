import { prisma } from '../utils/prisma'
import {
  computeSalaryStructure,
  getEsiConfig,
  getSalaryInputForDate,
  computePt,
} from './payrollEngine'

export interface SnapshotResult {
  employeeId: string
  name: string
  success: boolean
  error?: string
}

export async function computeAndSaveSnapshot(
  employeeId: string,
  computedBy: string,
  asOf: Date = new Date()
): Promise<void> {
  const esiConfig = await getEsiConfig()
  const emp = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: { id: true, state: true, annualCtc: true },
  })
  if (!emp) throw new Error('Employee not found')
  if (!emp.annualCtc || Number(emp.annualCtc) <= 0) throw new Error('No CTC set')

  const input = await getSalaryInputForDate(employeeId, asOf)
  const s = computeSalaryStructure(input, esiConfig)
  const pt = await computePt(s.grandTotalMonthly, emp.state || '')

  const employerPfCapped = Math.min(s.employerPfMonthly, 1800)
  const netMonthly =
    s.grandTotalMonthly - s.employeePfMonthly - s.employeeEsiMonthly - pt

  // Mark existing active snapshot as inactive
  await prisma.salaryStructureSnapshot.updateMany({
    where: { employeeId, isActive: true },
    data: { isActive: false },
  })

  await prisma.salaryStructureSnapshot.create({
    data: {
      employeeId,
      effectiveDate: asOf,
      annualCtc: input.annualCtc,
      basicMonthly: s.basicMonthly,
      hraMonthly: s.hraMonthly,
      transportMonthly: s.transportMonthly,
      fbpMonthly: s.fbpMonthly,
      hyiMonthly: s.hyiMonthly,
      grandTotalMonthly: s.grandTotalMonthly,
      employeePfMonthly: s.employeePfMonthly,
      employeeEsiMonthly: s.employeeEsiMonthly,
      employerPfMonthly: employerPfCapped,
      employerEsiMonthly: s.employerEsiMonthly,
      ptMonthly: pt,
      tdsMonthly: input.tdsMonthly,
      netMonthly,
      esiApplies: s.esiApplies,
      mediclaim: input.mediclaim,
      annualBonus: s.annualBonus,
      hasIncentive: input.hasIncentive,
      isActive: true,
      computedBy,
    },
  })
}

export async function migrateAllSalarySnapshots(
  computedBy: string
): Promise<{ total: number; success: number; failed: number; errors: SnapshotResult[] }> {
  const employees = await prisma.employee.findMany({
    where: { status: { in: ['ACTIVE', 'ON_NOTICE'] } },
    select: { id: true, name: true, annualCtc: true },
  })

  const asOf = new Date()
  let success = 0
  let failed = 0
  const errors: SnapshotResult[] = []

  for (const emp of employees) {
    try {
      if (!emp.annualCtc || Number(emp.annualCtc) <= 0) {
        failed++
        errors.push({ employeeId: emp.id, name: emp.name, success: false, error: 'No CTC set' })
        continue
      }
      await computeAndSaveSnapshot(emp.id, computedBy, asOf)
      success++
    } catch (err: any) {
      failed++
      errors.push({ employeeId: emp.id, name: emp.name, success: false, error: err.message })
    }
  }

  return { total: employees.length, success, failed, errors }
}
