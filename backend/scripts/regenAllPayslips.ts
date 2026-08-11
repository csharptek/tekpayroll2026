import { prisma } from '../src/utils/prisma'
import { generateAndDeliverPayslips } from '../src/services/payslipService'

async function main() {
  const cycles = await prisma.payrollCycle.findMany({
    where: {
      payrollMonth: { gte: '2026-04' },
      status: { in: ['CALCULATED', 'LOCKED', 'DISBURSED'] },
    },
    orderBy: { payrollMonth: 'asc' },
  })

  console.log(`Found ${cycles.length} cycles from 2026-04 onward`)

  let totalSuccess = 0
  let totalFailed = 0

  for (const cycle of cycles) {
    console.log(`\n--- ${cycle.payrollMonth} (${cycle.id}) ---`)
    const result = await generateAndDeliverPayslips(cycle.id)
    console.log(`${cycle.payrollMonth}: ${result.success} success, ${result.failed} failed`)
    if (result.errors.length) {
      result.errors.forEach(e => console.log(`  ✗ ${e.name}: ${e.error}`))
    }
    totalSuccess += result.success
    totalFailed += result.failed
  }

  console.log(`\n=== DONE: ${totalSuccess} success, ${totalFailed} failed across ${cycles.length} cycles ===`)
  await prisma.$disconnect()
}

main().catch(async (e) => {
  console.error(e)
  await prisma.$disconnect()
  process.exit(1)
})
