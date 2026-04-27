import { Router } from 'express'
import multer from 'multer'
import { prisma } from '../utils/prisma'
import { authenticate, requireHR } from '../middleware/auth'
import { AppError } from '../middleware/errorHandler'
import { BlobServiceClient, BlobSASPermissions, generateBlobSASQueryParameters, StorageSharedKeyCredential } from '@azure/storage-blob'
import { randomUUID } from 'crypto'
import { sendEmail, sendEmailWithAttachment } from '../services/emailService'
import { computeSalaryStructure, getEsiConfig, getSalaryInputForDate, computePt } from '../services/payrollEngine'

export const documentsRouter = Router()
documentsRouter.use(authenticate)

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } })

// ─── BLOB HELPERS ─────────────────────────────────────────────────────────────

function getConnStr() {
  const c = process.env.AZURE_STORAGE_CONNECTION_STRING
  if (!c || c === 'PLACEHOLDER') throw new AppError('Azure storage not configured', 500)
  return c
}

function getCredential() {
  const connStr = getConnStr()
  const nameM = connStr.match(/AccountName=([^;]+)/)
  const keyM  = connStr.match(/AccountKey=([^;]+)/)
  if (!nameM || !keyM) throw new AppError('Invalid Azure connection string', 500)
  return { accountName: nameM[1], credential: new StorageSharedKeyCredential(nameM[1], keyM[1]) }
}

function makeSasUrl(containerName: string, blobKey: string) {
  const { accountName, credential } = getCredential()
  const expiresOn = new Date()
  expiresOn.setFullYear(expiresOn.getFullYear() + 3)
  const sas = generateBlobSASQueryParameters(
    { containerName, blobName: blobKey, permissions: BlobSASPermissions.parse('r'), expiresOn, protocol: undefined as any },
    credential,
  ).toString()
  return `https://${accountName}.blob.core.windows.net/${containerName}/${blobKey}?${sas}`
}

async function uploadBlob(buffer: Buffer, key: string, mimeType: string) {
  const connStr = getConnStr()
  const containerName = process.env.AZURE_DOCS_CONTAINER || 'emp-documents'
  const client = BlobServiceClient.fromConnectionString(connStr)
  const container = client.getContainerClient(containerName)
  await container.createIfNotExists()
  const blob = container.getBlockBlobClient(key)
  await blob.uploadData(buffer, { blobHTTPHeaders: { blobContentType: mimeType } })
  return makeSasUrl(containerName, key)
}

// ─── COMPANY LOGO UPLOAD ──────────────────────────────────────────────────────

documentsRouter.post('/company-logo', requireHR, upload.single('logo'), async (req: any, res) => {
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

documentsRouter.post('/company-sign', requireHR, upload.single('logo'), async (req: any, res) => {
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

documentsRouter.get('/salary-snapshot/:employeeId', requireHR, async (req: any, res) => {
  const snapshot = await prisma.salaryStructureSnapshot.findFirst({
    where: { employeeId: req.params.employeeId, isActive: true },
  })
  res.json({ success: true, data: snapshot })
})

// ─── COMPUTE SALARY BREAKUP (for CTC override) ────────────────────────────────

documentsRouter.post('/compute-salary', requireHR, async (req: any, res) => {
  const { employeeId, annualCtc } = req.body
  if (!employeeId || !annualCtc) throw new AppError('employeeId and annualCtc required', 400)

  const esiConfig = await getEsiConfig()
  const baseInput = await getSalaryInputForDate(employeeId, new Date())
  const input = { ...baseInput, annualCtc: Number(annualCtc) }
  const s = computeSalaryStructure(input, esiConfig)
  const emp = await prisma.employee.findUnique({ where: { id: employeeId }, select: { state: true } })
  const pt = await computePt(s.grandTotalMonthly, emp?.state || '')

  const netMonthly = s.grandTotalMonthly - s.employeePfMonthly - s.employeeEsiMonthly - pt

  res.json({
    success: true,
    data: {
      annualCtc: Number(annualCtc),
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

documentsRouter.post('/generate', requireHR, async (req: any, res) => {
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
  const safeName = emp.name.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase()
  const dateStr  = new Date().toISOString().slice(0, 10)
  const key      = `generated-docs/${emp.employeeCode}-${safeName}/${documentType}-${dateStr}-${randomUUID()}.html`
  const buffer   = Buffer.from(htmlContent, 'utf-8')
  const url      = await uploadBlob(buffer, key, 'text/html')

  // Save to EmployeeDocument
  const doc = await prisma.employeeDocument.create({
    data: {
      employeeId,
      documentType:   (documentType as any) || 'OTHER',
      fileName:       `${documentType}-${dateStr}.html`,
      fileUrl:        url,
      fileKey:        key,
      fileSize:       buffer.length,
      mimeType:       'text/html',
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
  await page.setContent(html, { waitUntil: 'networkidle0' })
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

documentsRouter.post('/send-email', requireHR, async (req: any, res) => {
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

  // Generate PDF from letter HTML and attach
  const pdfBase64 = await htmlToPdfBase64(htmlContent)
  const attachmentName = `Increment_Letter_${emp.employeeCode || emp.id}.pdf`

  await sendEmailWithAttachment(emp.email, resolvedSubject, bodyHtml, attachmentName, pdfBase64)
  res.json({ success: true, message: `Email sent to ${emp.email}` })
})

// ─── TEST INCREMENT EMAIL ──────────────────────────────────────────────────────

documentsRouter.post('/test-email', requireHR, async (req: any, res) => {
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

