import { prisma } from '../utils/prisma'
import { generatePayslipHTML } from './payslipTemplate'

// ─── PDF GENERATION ──────────────────────────────────────────────────────────

async function generatePDF(html: string): Promise<Buffer> {
  if (process.env.NODE_ENV === 'production' || process.env.PUPPETEER_ENABLED === 'true') {
    const puppeteer = await import('puppeteer')
    const browser = await puppeteer.default.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    })
    const page = await browser.newPage()
    await page.setContent(html, { waitUntil: 'networkidle0' })
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '10mm', bottom: '10mm', left: '10mm', right: '10mm' },
    })
    await browser.close()
    return Buffer.from(pdf)
  }
  console.log('[PAYSLIP] Dev mode — PDF generation stubbed')
  return Buffer.from(html)
}

// ─── AZURE BLOB UPLOAD ───────────────────────────────────────────────────────

async function uploadToAzureBlob(buffer: Buffer, blobName: string): Promise<string> {
  const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING

  if (!connectionString || connectionString === 'PLACEHOLDER') {
    console.log(`[BLOB] Dev mode — would upload ${blobName} to Azure Blob`)
    return `/dev-payslips/${blobName}`
  }

  const { BlobServiceClient } = await import('@azure/storage-blob')
  const blobServiceClient = BlobServiceClient.fromConnectionString(connectionString)
  const containerName = process.env.AZURE_STORAGE_CONTAINER || 'payslips'
  const containerClient = blobServiceClient.getContainerClient(containerName)
  await containerClient.createIfNotExists({ access: 'blob' })
  const blockBlobClient = containerClient.getBlockBlobClient(blobName)
  await blockBlobClient.uploadData(buffer, {
    blobHTTPHeaders: { blobContentType: 'application/pdf' },
  })
  console.log(`[BLOB] Uploaded: ${blobName}`)
  return blockBlobClient.url
}

// ─── DELETE FROM BLOB (for regeneration cleanup) ─────────────────────────────

export async function deleteFromAzureBlob(blobName: string): Promise<void> {
  const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING
  if (!connectionString || connectionString === 'PLACEHOLDER') return
  const { BlobServiceClient } = await import('@azure/storage-blob')
  const blobServiceClient = BlobServiceClient.fromConnectionString(connectionString)
  const containerClient = blobServiceClient.getContainerClient(
    process.env.AZURE_STORAGE_CONTAINER || 'payslips'
  )
  await containerClient.getBlockBlobClient(blobName).deleteIfExists()
}

// ─── EMAIL ───────────────────────────────────────────────────────────────────

async function sendPayslipEmail(
  toEmail: string,
  employeeName: string,
  payrollMonth: string,
  pdfBuffer: Buffer,
  filename: string,
  pdfUrl: string
): Promise<void> {
  if (!process.env.RESEND_API_KEY || process.env.RESEND_API_KEY === 'PLACEHOLDER') {
    console.log(`[RESEND] Dev mode — would email payslip to ${toEmail} for ${payrollMonth}`)
    return
  }

  const { Resend } = await import('resend')
  const resend = new Resend(process.env.RESEND_API_KEY)

  await resend.emails.send({
    from: process.env.EMAIL_FROM || 'payroll@csharptek.com',
    to: toEmail,
    subject: `Your Payslip for ${payrollMonth} — CSharpTek`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:540px;margin:0 auto;padding:24px;">
        <div style="border-bottom:2px solid #1f4e79;padding-bottom:16px;margin-bottom:24px;">
          <h2 style="color:#1f4e79;margin:0;">CSharpTek Payroll</h2>
        </div>
        <p style="color:#374151;">Hi <strong>${employeeName}</strong>,</p>
        <p style="color:#374151;">Your salary slip for <strong>${payrollMonth}</strong> is ready.</p>
        <p style="margin:24px 0;">
          <a href="${pdfUrl}" style="background:#1f4e79;color:#fff;padding:12px 24px;
             border-radius:6px;text-decoration:none;font-weight:600;font-size:14px;">
            Download Payslip PDF
          </a>
        </p>
        <p style="color:#374151;">
          You can also view all payslips on the
          <a href="${process.env.FRONTEND_URL}/my/payslips" style="color:#2e75b6;">
            CSharpTek Payroll portal
          </a>.
        </p>
        <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;" />
        <p style="color:#9ca3af;font-size:12px;margin:0;">
          Automated email — please do not reply. CSharpTek Payroll System.
        </p>
      </div>
    `,
    attachments: [{ filename, content: pdfBuffer.toString('base64') }],
  })
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

export async function generateAndDeliverPayslips(
  cycleId: string,
  employeeIds?: string[]
): Promise<{
  success: number
  failed: number
  errors: { employeeId: string; name: string; error: string }[]
}> {
  const cycle = await prisma.payrollCycle.findUnique({ where: { id: cycleId } })
  if (!cycle) throw new Error('Payroll cycle not found')

  const where: any = { cycleId }
  if (employeeIds?.length) where.employeeId = { in: employeeIds }

  const entries = await prisma.payrollEntry.findMany({
    where,
    include: {
      employee: { include: { bankDetail: true } },
      cycle: true,
    },
  })

  let success = 0
  let failed  = 0
  const errors: { employeeId: string; name: string; error: string }[] = []

  for (const entry of entries) {
    try {
      // Fetch leave balance for payslip
      let leaveBalance: any = undefined
      try {
        const { getEmployeeBalance, getCurrentLeaveYear } = await import('./leaveService')
        const bal = await getEmployeeBalance(entry.employeeId, getCurrentLeaveYear())
        const s = (kind: string) => bal[kind]
        leaveBalance = {
          sick:    s('SICK')    ? { total: s('SICK').total,    used: s('SICK').used,    remaining: s('SICK').remaining }    : undefined,
          casual:  s('CASUAL')  ? { total: s('CASUAL').total,  used: s('CASUAL').used,  remaining: s('CASUAL').remaining }  : undefined,
          planned: s('PLANNED') ? { total: s('PLANNED').total, used: s('PLANNED').used, remaining: s('PLANNED').remaining, carryForward: s('PLANNED').carryForward } : undefined,
        }
      } catch { /* leave module not yet set up — skip */ }

      const html      = generatePayslipHTML(entry as any, leaveBalance)
      const pdfBuffer = await generatePDF(html)

      // Blob path: payslips/2025-04/CST-001/payslip-CST-001-2025-04.pdf
      const filename = `payslip-${entry.employee.employeeCode}-${cycle.payrollMonth}.pdf`
      const blobName = `payslips/${cycle.payrollMonth}/${entry.employee.employeeCode}/${filename}`

      const pdfUrl = await uploadToAzureBlob(pdfBuffer, blobName)

      const payslip = await prisma.payslip.upsert({
        where:  { entryId: entry.id },
        create: {
          cycleId, employeeId: entry.employeeId, entryId: entry.id,
          pdfUrl, pdfKey: blobName, status: 'GENERATED', generatedAt: new Date(), version: 1,
        },
        update: {
          pdfUrl, pdfKey: blobName, status: 'GENERATED',
          generatedAt: new Date(), version: { increment: 1 }, regeneratedAt: new Date(),
        },
      })

      await sendPayslipEmail(
        entry.employee.email, entry.employee.name,
        cycle.payrollMonth, pdfBuffer, filename, pdfUrl
      )

      await prisma.payslip.update({
        where: { id: payslip.id },
        data:  { status: 'EMAILED', emailedAt: new Date(), emailStatus: 'delivered' },
      })

      success++
      console.log(`[PAYSLIP] ✓ ${entry.employee.name} — ${cycle.payrollMonth}`)
    } catch (err: any) {
      console.error(`[PAYSLIP] ✗ ${entry.employee.name}:`, err.message)
      errors.push({ employeeId: entry.employeeId, name: entry.employee.name, error: err.message })

      await prisma.payslip.upsert({
        where:  { entryId: entry.id },
        create: { cycleId, employeeId: entry.employeeId, entryId: entry.id, status: 'FAILED' },
        update: { status: 'FAILED', emailStatus: err.message.slice(0, 200) },
      })

      failed++
    }
  }

  console.log(`[PAYSLIP] Complete — ${success} success, ${failed} failed`)
  return { success, failed, errors }
}
