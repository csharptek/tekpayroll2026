import { prisma } from '../utils/prisma'
import { generatePayslipHTML } from './payslipTemplate'
import { uploadPayslipPdf, downloadPayslipPdf, payslipSasUrl } from '../utils/payslipBlob'

// ─── PDF GENERATION ──────────────────────────────────────────────────────────

async function generatePDF(html: string): Promise<Buffer> {
  if (process.env.NODE_ENV === 'production' || process.env.PUPPETEER_ENABLED === 'true') {
    const puppeteer = await import('puppeteer')
    const browser = await puppeteer.default.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    })
    const page = await browser.newPage()
    await page.setContent(html, { waitUntil: 'networkidle2', timeout: 15000 })
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

async function uploadToAzureBlob(buffer: Buffer, blobKey: string): Promise<string> {
  const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING
  if (!connectionString || connectionString === 'PLACEHOLDER') {
    console.log(`[BLOB] Dev mode — would upload ${blobKey} to Azure Blob`)
    return `/dev-payslips/${blobKey}`
  }
  const url = await uploadPayslipPdf(buffer, blobKey)
  console.log(`[BLOB] Uploaded: ${blobKey}`)
  return url
}

// ─── DELETE FROM BLOB (for regeneration cleanup) ─────────────────────────────

export async function deleteFromAzureBlob(blobKey: string): Promise<void> {
  const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING
  if (!connectionString || connectionString === 'PLACEHOLDER') return
  const { deletePayslipPdf } = await import('../utils/payslipBlob')
  await deletePayslipPdf(blobKey)
}

// ─── EMAIL ───────────────────────────────────────────────────────────────────


export async function sendPayslipEmail(
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
          <h2 style="color:#1f4e79;margin:0;">TEKONE</h2>
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
            TEKONE portal
          </a>.
        </p>
        <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;" />
        <p style="color:#9ca3af;font-size:12px;margin:0;">
          Automated email — please do not reply. TEKONE System.
        </p>
      </div>
    `,
    attachments: [{ filename, content: pdfBuffer.toString('base64') }],
  })
}

// ─── MAIN — GENERATE ONLY (no auto-email) ────────────────────────────────────

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

      const reimbItems = await prisma.reimbursement.findMany({
        where:  { cycleId: entry.cycleId, employeeId: entry.employeeId, status: { in: ['APPROVED', 'PAID'] } },
        select: { payslipLabel: true, category: true, amount: true },
        orderBy: { createdAt: 'asc' },
      })
      const reimbLines = reimbItems.map(r => ({
        label:  (r.payslipLabel && r.payslipLabel.trim()) || `${r.category} reimbursement`,
        amount: Number(r.amount),
      }))

      const html      = generatePayslipHTML(entry as any, leaveBalance, reimbLines)
      const pdfBuffer = await generatePDF(html)

      const filename = `payslip-${entry.employee.employeeCode}-${cycle.payrollMonth}.pdf`
      const blobName = `${cycle.payrollMonth}/${entry.employee.employeeCode}/${filename}`

      const pdfUrl = await uploadToAzureBlob(pdfBuffer, blobName)

      await prisma.payslip.upsert({
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

// ─── EMAIL SINGLE PAYSLIP ────────────────────────────────────────────────────

export async function emailSinglePayslip(payslipId: string): Promise<void> {
  const payslip = await prisma.payslip.findUnique({
    where: { id: payslipId },
    include: {
      employee: true,
      cycle: true,
      entry: true,
    },
  })
  if (!payslip) throw new Error('Payslip not found')
  if (!payslip.pdfKey) throw new Error('PDF not yet generated')

  // Download from blob to get buffer for attachment
  const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING
  let pdfBuffer: Buffer

  if (!connectionString || connectionString === 'PLACEHOLDER') {
    pdfBuffer = Buffer.from('dev-pdf')
  } else {
    pdfBuffer = await downloadPayslipPdf(payslip.pdfKey)
  }

  const filename = `payslip-${payslip.employee.employeeCode}-${payslip.cycle.payrollMonth}.pdf`
  const freshUrl = (!connectionString || connectionString === 'PLACEHOLDER')
    ? (payslip.pdfUrl || '')
    : payslipSasUrl(payslip.pdfKey)

  await sendPayslipEmail(
    payslip.employee.email,
    payslip.employee.name,
    payslip.cycle.payrollMonth,
    pdfBuffer,
    filename,
    freshUrl
  )

  await prisma.payslip.update({
    where: { id: payslipId },
    data: { status: 'EMAILED', emailedAt: new Date(), emailStatus: 'delivered' },
  })

  console.log(`[PAYSLIP EMAIL] ✓ ${payslip.employee.name} — ${payslip.cycle.payrollMonth}`)
}
