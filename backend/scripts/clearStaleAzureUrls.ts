// One-time cleanup: null out fields still holding old Azure blob URLs/keys
// so the UI shows "no file" instead of a broken link. Run once after migration.
// Usage: npx ts-node scripts/clearStaleAzureUrls.ts   (or node dist/scripts/... in prod)

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const isStale = (val: string | null) =>
  !!val && (val.includes('blob.core.windows.net') || val.includes('.azure'))

async function main() {
  let total = 0

  const photos = await prisma.employeeProfile.updateMany({
    where: { profilePhotoUrl: { contains: 'blob.core.windows.net' } },
    data: { profilePhotoUrl: null, profilePhotoKey: null },
  })
  total += photos.count

  const docs = await prisma.employeeDocument.findMany({
    where: { documentUrl: { contains: 'blob.core.windows.net' } },
    select: { id: true },
  })
  if (docs.length) {
    await prisma.employeeDocument.updateMany({
      where: { id: { in: docs.map(d => d.id) } },
      data: { documentUrl: null, documentKey: null },
    })
    total += docs.length
  }

  const payslips = await prisma.payslip.updateMany({
    where: { pdfUrl: { contains: 'blob.core.windows.net' } },
    data: { pdfUrl: null, pdfKey: null },
  })
  total += payslips.count

  const fnf = await prisma.fnfSettlement.updateMany({
    where: { pdfUrl: { contains: 'blob.core.windows.net' } },
    data: { pdfUrl: null, pdfKey: null },
  })
  total += fnf.count

  const govIds = await prisma.governmentId.findMany({
    where: {
      OR: [
        { panDocUrl: { contains: 'blob.core.windows.net' } },
        { aadhaarDocUrl: { contains: 'blob.core.windows.net' } },
        { passportDocUrl: { contains: 'blob.core.windows.net' } },
      ],
    },
  })
  for (const g of govIds) {
    await prisma.governmentId.update({
      where: { id: g.id },
      data: {
        panDocUrl: isStale(g.panDocUrl) ? null : g.panDocUrl,
        aadhaarDocUrl: isStale(g.aadhaarDocUrl) ? null : g.aadhaarDocUrl,
        passportDocUrl: isStale(g.passportDocUrl) ? null : g.passportDocUrl,
      },
    })
  }
  total += govIds.length

  console.log(`Cleared stale Azure URLs on ${total} rows.`)
}

main()
  .catch(e => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
