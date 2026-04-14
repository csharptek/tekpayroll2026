/**
 * One-time script: fix negative usedDays/pendingDays for an employee.
 * Run: npx ts-node scripts/fix-leave-balance.ts
 *
 * It recalculates usedDays and pendingDays from actual APPROVED/AUTO_APPROVED
 * and PENDING applications, then writes correct values to LeaveEntitlement.
 */

import { PrismaClient, LeaveStatus } from '@prisma/client'

const prisma = new PrismaClient()

const EMPLOYEE_CODE = 'C#TEK157'
const YEAR = 2026

async function main() {
  const employee = await prisma.employee.findUnique({
    where: { employeeCode: EMPLOYEE_CODE },
    select: { id: true, name: true },
  })
  if (!employee) throw new Error(`Employee ${EMPLOYEE_CODE} not found`)
  console.log(`Found: ${employee.name} (${employee.id})`)

  const entitlements = await prisma.leaveEntitlement.findMany({
    where: { employeeId: employee.id, year: YEAR },
  })

  for (const ent of entitlements) {
    // Sum actual approved (used) days
    const approvedAgg = await prisma.lvApplication.aggregate({
      where: {
        employeeId: employee.id,
        leaveKind: ent.leaveKind,
        status: { in: [LeaveStatus.APPROVED, LeaveStatus.AUTO_APPROVED] },
        startDate: { gte: new Date(`${YEAR}-01-01`), lte: new Date(`${YEAR}-12-31`) },
      },
      _sum: { totalDays: true, lopDays: true },
    })

    // Sum actual pending days
    const pendingAgg = await prisma.lvApplication.aggregate({
      where: {
        employeeId: employee.id,
        leaveKind: ent.leaveKind,
        status: LeaveStatus.PENDING,
        startDate: { gte: new Date(`${YEAR}-01-01`), lte: new Date(`${YEAR}-12-31`) },
      },
      _sum: { totalDays: true },
    })

    const correctUsed    = Number(approvedAgg._sum.totalDays ?? 0) - Number(approvedAgg._sum.lopDays ?? 0)
    const correctPending = Number(pendingAgg._sum.totalDays ?? 0)

    console.log(`\n[${ent.leaveKind}]`)
    console.log(`  Current  usedDays=${ent.usedDays}  pendingDays=${ent.pendingDays}`)
    console.log(`  Correct  usedDays=${correctUsed}  pendingDays=${correctPending}`)

    await prisma.leaveEntitlement.update({
      where: { id: ent.id },
      data: {
        usedDays:    Math.max(0, correctUsed),
        pendingDays: Math.max(0, correctPending),
      },
    })
    console.log(`  ✅ Fixed`)
  }

  console.log('\nDone.')
}

main()
  .catch(e => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
