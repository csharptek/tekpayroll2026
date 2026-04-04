import { prisma } from '../utils/prisma'
import { generatePayslipHTML } from './payslipTemplate'

// ─── STUB ADAPTERS ────────────────────────────────────────────────────────────
// Real implementations swap in when credentials are provided.
// Each function logs what it WOULD do in dev mode.

async function generatePDF(html: string): Promise<Buffer> {
  // Production: uses Puppeteer
  // Dev stub: returns a small placeholder buffer
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

  // Dev: return a stub buffer with the HTML content
  console.log('[PAYSLIP] Dev mode — PDF generation stubbed, returning HTML as buffer')
  return Buffer.from(html)
}

async function uploadToR2(
  buffer: Buffer,
  key: string,
  contentType: string
): Promise<string> {
  if (
    process.env.R2_ACCOUNT_ID !== 'PLACEHOLDER' &&
    process.env.R2_ACCESS_KEY_ID !== 'PLACEHOLDER'
  ) {
    const AWS = await import('aws-sdk')
    const s3 = new AWS.default.S3({
      endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
      region: 'auto',
      signatureVersion: 'v4',
    })
    await s3.putObject({
      Bucket: process.env.R2_BUCKET_NAME || 'csharptek-payslips',
      Key: key,
      Body: buffer,
      ContentType: contentType,
    }).promise()
    return `${process.env.R2_PUBLIC_URL}/${key}`
  }

  // Dev stub
  console.log(`[R2] Dev mode — would upload ${key} to R2`)
  return `/dev-payslips/${key}`
}

async function sendPayslipEmail(
  toEmail: string,
  employeeName: string,
  payrollMonth: string,
  pdfBuffer: Buffer,
  filename: string
): Promise<void> {
  if (process.env.RESEND_API_KEY !== 'PLACEHOLDER') {
    const { Resend } = await import('resend')
    const resend = new Resend(process.env.RESEND_API_KEY)
    await resend.emails.send({
      from: process.env.EMAIL_FROM || 'payroll@csharptek.com',
      to: toEmail,
      subject: `Your Payslip for ${payrollMonth} — CSharpTek`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto;">
          <h2 style="color: #1f4e79;">CSharpTek Payroll</h2>
          <p>Hi ${employeeName},</p>
          <p>Your salary slip for <strong>${payrollMonth}</strong> is attached to this email.</p>
          <p>You can also download it anytime from the <a href="${process.env.FRONTEND_URL}/my/payslips" style="color: #2e75b6;">CSharpTek Payroll portal</a>.</p>
          <br />
          <p style="color: #64748b; font-size: 12px;">This is an automated email. Please do not reply.</p>
          <p style="color: #64748b; font-size: 12px;">CSharpTek · payroll@csharptek.com</p>
        </div>
      `,
      attachments: [
        {
          filename,
          content: pdfBuffer.toString('base64'),
        },
      ],
    })
    return
  }

  // Dev stub
  console.log(`[RESEND] Dev mode — would email payslip to ${toEmail} for ${payrollMonth}`)
}

// ─── MAIN FUNCTION ────────────────────────────────────────────────────────────

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
      // Generate HTML
      const html = generatePayslipHTML(entry as any)

      // Generate PDF
      const pdfBuffer = await generatePDF(html)

      // Build R2 key
      const filename = `payslip-${entry.employee.employeeCode}-${cycle.payrollMonth}.pdf`
      const r2Key    = `payslips/${cycle.payrollMonth}/${entry.employee.employeeCode}/${filename}`

      // Upload to R2
      const pdfUrl = await uploadToR2(pdfBuffer, r2Key, 'application/pdf')

      // Upsert payslip record
      const payslip = await prisma.payslip.upsert({
        where: { entryId: entry.id },
        create: {
          cycleId:      cycleId,
          employeeId:   entry.employeeId,
          entryId:      entry.id,
          pdfUrl,
          pdfKey:       r2Key,
          status:       'GENERATED',
          generatedAt:  new Date(),
          version:      1,
        },
        update: {
          pdfUrl,
          pdfKey:       r2Key,
          status:       'GENERATED',
          generatedAt:  new Date(),
          version:      { increment: 1 },
          regeneratedAt: new Date(),
        },
      })

      // Send email
      await sendPayslipEmail(
        entry.employee.email,
        entry.employee.name,
        cycle.payrollMonth,
        pdfBuffer,
        filename
      )

      // Update status to EMAILED
      await prisma.payslip.update({
        where: { id: payslip.id },
        data: { status: 'EMAILED', emailedAt: new Date(), emailStatus: 'delivered' },
      })

      success++
    } catch (err: any) {
      console.error(`[PAYSLIP] Failed for employee ${entry.employee.name}:`, err.message)
      errors.push({ employeeId: entry.employeeId, name: entry.employee.name, error: err.message })

      // Mark as FAILED
      await prisma.payslip.upsert({
        where: { entryId: entry.id },
        create: {
          cycleId:    cycleId,
          employeeId: entry.employeeId,
          entryId:    entry.id,
          status:     'FAILED',
        },
        update: { status: 'FAILED', emailStatus: err.message },
      })

      failed++
    }
  }

  return { success, failed, errors }
}
