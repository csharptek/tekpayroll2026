import { Router } from 'express'
import multer from 'multer'
import { prisma } from '../utils/prisma'
import { authenticate, requireHR, requireSuperAdmin } from '../middleware/auth'
import { AppError } from '../middleware/errorHandler'
import { randomUUID } from 'crypto'
import { sendEmail, sendEmailWithAttachment, getDocEmailConfig } from '../services/emailService'
import { computeSalaryStructure, getEsiConfig, getSalaryInputForDate, computePt } from '../services/payrollEngine'
import { saveFile, readFile, getFileUrl } from '../utils/fileStorage'

export const documentsRouter = Router()
documentsRouter.use(authenticate)

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } })

// ─── STORAGE HELPERS (Railway volume) ─────────────────────────────────────────

const DOCS_CONTAINER = 'emp-documents'

async function uploadBlob(buffer: Buffer, key: string, _mimeType: string) {
  await saveFile(DOCS_CONTAINER, key, buffer)
  return getFileUrl(DOCS_CONTAINER, key)
}

// ─── COMPANY LOGO UPLOAD ──────────────────────────────────────────────────────

documentsRouter.post('/company-logo', requireSuperAdmin, upload.single('logo'), async (req: any, res) => {
  if (!req.file) throw new AppError('No file uploaded', 400)
  const key = `company/logo-${randomUUID()}.png`
  const url = await uploadBlob(req.file.buffer, key, req.file.mimetype)
  await prisma.systemConfig.upsert({
    where:  { key: 'COMPANY_LOGO_URL' },
    create: { key: 'COMPANY_LOGO_URL', value: url, updatedBy: req.user!.id },
    update: { value: url, updatedBy: req.user!.id },
  })
  await prisma.systemConfig.upsert({
    where:  { key: 'COMPANY_LOGO_KEY' },
    create: { key: 'COMPANY_LOGO_KEY', value: key, updatedBy: req.user!.id },
    update: { value: key, updatedBy: req.user!.id },
  })
  res.json({ success: true, data: { url } })
})

// ─── COMPANY SIGN UPLOAD ─────────────────────────────────────────────────────

documentsRouter.post('/company-sign', requireSuperAdmin, upload.single('logo'), async (req: any, res) => {
  if (!req.file) throw new AppError('No file uploaded', 400)
  const key = `company/sign-${randomUUID()}.png`
  const url = await uploadBlob(req.file.buffer, key, req.file.mimetype)
  await prisma.systemConfig.upsert({
    where:  { key: 'COMPANY_SIGN_URL' },
    create: { key: 'COMPANY_SIGN_URL', value: url, updatedBy: req.user!.id },
    update: { value: url, updatedBy: req.user!.id },
  })
  res.json({ success: true, data: { url } })
})

// ─── GET SALARY SNAPSHOT FOR EMPLOYEE ─────────────────────────────────────────

documentsRouter.get('/salary-snapshot/:employeeId', requireSuperAdmin, async (req: any, res) => {
  const snapshot = await prisma.salaryStructureSnapshot.findFirst({
    where: { employeeId: req.params.employeeId, isActive: true },
  })
  res.json({ success: true, data: snapshot })
})

// ─── COMPUTE SALARY BREAKUP (for CTC override) ────────────────────────────────

documentsRouter.post('/compute-salary', async (req: any, res) => {
  const { employeeId, annualCtc } = req.body
  if (!employeeId) throw new AppError('employeeId required', 400)

  // Employees can only fetch their own salary
  if (req.user!.role === 'EMPLOYEE' && req.user!.id !== employeeId) {
    throw new AppError('Access denied', 403)
  }
  // Non-employee roles require HR or above
  if (req.user!.role !== 'EMPLOYEE' && !['HR', 'SUPER_ADMIN'].includes(req.user!.role)) {
    throw new AppError('Access denied', 403)
  }

  const esiConfig = await getEsiConfig()

  // Always read latest SalaryRevision — bypass snapshot to reflect latest salary update
  const emp = await prisma.employee.findUnique({ where: { id: employeeId } })
  if (!emp) throw new AppError('Employee not found', 404)

  const revision = await prisma.salaryRevision.findFirst({
    where: { employeeId, effectiveFrom: { lte: new Date() } },
    orderBy: { effectiveFrom: 'desc' },
  })

  const latestCtc = annualCtc
    ? Number(annualCtc)
    : revision
    ? Number(revision.newCtc)
    : Number((emp as any).annualCtc || 0)

  const baseInput = {
    annualCtc:        latestCtc,
    basicPercent:     Number((emp as any).basicPercent ?? 45),
    hraPercent:       Number((emp as any).hraPercent ?? 35),
    transportMonthly: (emp as any).transportMonthly != null ? Number((emp as any).transportMonthly) : null,
    fbpMonthly:       (emp as any).fbpMonthly != null ? Number((emp as any).fbpMonthly) : null,
    mediclaim:        Number((emp as any).mediclaim ?? 0),
    hasIncentive:     Boolean((emp as any).hasIncentive),
    incentivePercent: Number((emp as any).incentivePercent ?? 12),
    tdsMonthly:       Number((emp as any).tdsMonthly ?? 0),
  }

  const input = { ...baseInput, annualCtc: latestCtc }
  const s = computeSalaryStructure(input, esiConfig)
  const pt = await computePt(s.grandTotalMonthly, (emp as any).state || '')

  const netMonthly = s.grandTotalMonthly - s.employeePfMonthly - s.employeeEsiMonthly - pt

  res.json({
    success: true,
    data: {
      annualCtc: latestCtc,
      basicMonthly: s.basicMonthly,
      hraMonthly: s.hraMonthly,
      transportMonthly: s.transportMonthly,
      fbpMonthly: s.fbpMonthly,
      hyiMonthly: s.hyiMonthly,
      grandTotalMonthly: s.grandTotalMonthly,
      employeePfMonthly: s.employeePfMonthly,
      employeeEsiMonthly: s.employeeEsiMonthly,
      employerPfMonthly: Math.min(s.employerPfMonthly, 1800),
      employerEsiMonthly: s.employerEsiMonthly,
      ptMonthly: pt,
      netMonthly,
      esiApplies: s.esiApplies,
      annualBonus: s.annualBonus,
      mediclaim: input.mediclaim,
    },
  })
})

// ─── GENERATE + SAVE DOCUMENT ─────────────────────────────────────────────────

documentsRouter.post('/generate', requireSuperAdmin, async (req: any, res) => {
  const {
    employeeId, documentType, letterDate, effectiveDate,
    isPromotion, newDesignation, salaryData, htmlContent,
    sendEmailFlag,
  } = req.body

  if (!employeeId || !documentType || !letterDate || !effectiveDate || !htmlContent) {
    throw new AppError('Missing required fields', 400)
  }

  const emp = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: { id: true, name: true, email: true, employeeCode: true },
  })
  if (!emp) throw new AppError('Employee not found', 404)

  // Save HTML as blob
  // Convert HTML → PDF and save
  const safeName  = emp.name.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase()
  const dateStr   = new Date().toISOString().slice(0, 10)
  const key       = `generated-docs/${emp.employeeCode}-${safeName}/${documentType}-${dateStr}-${randomUUID()}.pdf`
  const pdfBase64 = await htmlToPdfBase64(htmlContent)
  const buffer    = Buffer.from(pdfBase64, 'base64')
  const url       = await uploadBlob(buffer, key, 'application/pdf')

  // Save to EmployeeDocument
  const doc = await prisma.employeeDocument.create({
    data: {
      employeeId,
      documentType:   (documentType as any) || 'OTHER',
      fileName:       `${documentType}-${dateStr}.pdf`,
      fileUrl:        url,
      fileKey:        key,
      fileSize:       buffer.length,
      mimeType:       'application/pdf',
      notes:          documentType,
      uploadedBy:     req.user!.id,
      uploadedByRole: req.user!.role,
      isVerified:     true,
    },
  })

  res.json({ success: true, data: { docId: doc.id, url } })
})

// ─── SHARED: HTML → PDF ────────────────────────────────────────────────────────

async function htmlToPdfBase64(html: string): Promise<string> {
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
    margin: { top: '15mm', bottom: '20mm', left: '20mm', right: '20mm' },
  })
  await browser.close()
  return Buffer.from(pdf).toString('base64')
}

function resolveEmailPlaceholders(template: string, emp: { name: string; employeeCode?: string | null; jobTitle?: string | null }) {
  return template
    .replace(/\{employeeName\}/g, emp.name)
    .replace(/\{employeeCode\}/g, emp.employeeCode || '')
    .replace(/\{firstName\}/g, emp.name.split(' ')[0])
    .replace(/\{designation\}/g, emp.jobTitle || '')
}

// ─── SEND INCREMENT EMAIL ──────────────────────────────────────────────────────

documentsRouter.post('/send-email', requireSuperAdmin, async (req: any, res) => {
  const { employeeId, htmlContent, subject } = req.body
  if (!employeeId || !htmlContent) throw new AppError('employeeId and htmlContent required', 400)

  const emp = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: { id: true, name: true, email: true, employeeCode: true, jobTitle: true },
  })
  if (!emp) throw new AppError('Employee not found', 404)
  if (!emp.email) throw new AppError('Employee has no email address', 400)

  const configs = await prisma.systemConfig.findMany({
    where: { key: { in: ['INCREMENT_EMAIL_SUBJECT', 'INCREMENT_EMAIL_BODY'] } }
  })
  const cfgMap = Object.fromEntries(configs.map(c => [c.key, c.value]))

  const resolvedSubject = resolveEmailPlaceholders(
    subject || cfgMap['INCREMENT_EMAIL_SUBJECT'] || 'Your Increment Letter — {employeeName}',
    emp
  )

  const emailBodyTemplate = cfgMap['INCREMENT_EMAIL_BODY'] || ''
  const bodyHtml = emailBodyTemplate
    ? resolveEmailPlaceholders(emailBodyTemplate, emp)
    : `<p>Dear ${emp.name.split(' ')[0]},</p><p>Please find your increment letter attached.</p><p>Regards,<br/>HR Team</p>`

  const docCfg = await getDocEmailConfig()

  // Generate PDF from letter HTML and attach
  const pdfBase64 = await htmlToPdfBase64(htmlContent)
  const attachmentName = `Increment_Letter_${emp.employeeCode || emp.id}.pdf`

  await sendEmailWithAttachment(emp.email, resolvedSubject, bodyHtml, attachmentName, pdfBase64, 'application/pdf', docCfg.cc, docCfg.senderEmail || undefined)
  res.json({ success: true, message: `Email sent to ${emp.email}` })
})

// ─── TEST INCREMENT EMAIL ──────────────────────────────────────────────────────

documentsRouter.post('/test-email', requireSuperAdmin, async (req: any, res) => {
  const { toEmail, employeeId, htmlContent } = req.body
  if (!toEmail) throw new AppError('toEmail required', 400)

  const emp = employeeId
    ? await prisma.employee.findUnique({
        where: { id: employeeId },
        select: { name: true, email: true, employeeCode: true, jobTitle: true },
      })
    : null

  const mockEmp = emp || { name: 'John Doe', employeeCode: 'EMP001', jobTitle: 'Software Developer' }

  const configs = await prisma.systemConfig.findMany({
    where: { key: { in: ['INCREMENT_EMAIL_SUBJECT', 'INCREMENT_EMAIL_BODY'] } }
  })
  const cfgMap = Object.fromEntries(configs.map(c => [c.key, c.value]))

  const resolvedSubject = `[TEST] ${resolveEmailPlaceholders(
    cfgMap['INCREMENT_EMAIL_SUBJECT'] || 'Your Increment Letter — {employeeName}',
    mockEmp
  )}`

  const emailBodyTemplate = cfgMap['INCREMENT_EMAIL_BODY'] || ''
  const bodyHtml = emailBodyTemplate
    ? resolveEmailPlaceholders(emailBodyTemplate, mockEmp)
    : `<p>Dear ${mockEmp.name.split(' ')[0]},</p><p>Please find your increment letter attached.</p><p>Regards,<br/>HR Team</p>`

  const letterHtml = htmlContent || `<html><body><p>This is a test increment letter for ${mockEmp.name}.</p></body></html>`
  const pdfBase64 = await htmlToPdfBase64(letterHtml)
  const attachmentName = `TEST_Increment_Letter_${mockEmp.employeeCode || 'SAMPLE'}.pdf`

  await sendEmailWithAttachment(toEmail, resolvedSubject, bodyHtml, attachmentName, pdfBase64)
  res.json({ success: true, message: `Test email sent to ${toEmail}` })
})


// ─── MIGRATE HTML DOCS → PDF ───────────────────────────────────────────────────

// Preview: list all HTML documents
documentsRouter.get('/migrate-html-preview', requireSuperAdmin, async (req: any, res) => {
  const docs = await prisma.employeeDocument.findMany({
    where: { mimeType: 'text/html' },
    include: { employee: { select: { name: true, employeeCode: true } } },
    orderBy: { createdAt: 'desc' },
  })
  res.json({
    success: true,
    data: {
      total: docs.length,
      documents: docs.map(d => ({
        id: d.id,
        employeeName: d.employee?.name,
        employeeCode: d.employee?.employeeCode,
        fileName: d.fileName,
        documentType: d.documentType,
        fileSize: d.fileSize,
        createdAt: d.createdAt,
      })),
    },
  })
})

// Execute: convert all HTML docs to PDF
// NOTE: disabled — legacy Azure Blob source is gone. Any remaining
// text/html EmployeeDocument rows predate the Railway volume migration
// and are no longer retrievable; re-upload affected documents manually.
documentsRouter.post('/migrate-html-to-pdf', requireSuperAdmin, async (req: any, res) => {
  throw new AppError('Migration source (Azure Blob) no longer available. Re-upload affected documents instead.', 410)

  // eslint-disable-next-line no-unreachable
  const docs: any[] = []
  let success = 0
  let failed = 0
  const errors: string[] = []

  res.json({
    success: true,
    data: {
      total: docs.length,
      success,
      failed,
      errors: errors.slice(0, 20),
    },
  })
})
