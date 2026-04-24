import { Router } from 'express'
import multer from 'multer'
import { prisma } from '../utils/prisma'
import { authenticate, requireHR } from '../middleware/auth'
import { AppError } from '../middleware/errorHandler'
import { BlobServiceClient, BlobSASPermissions, generateBlobSASQueryParameters, StorageSharedKeyCredential } from '@azure/storage-blob'
import { randomUUID } from 'crypto'
import { sendEmail } from '../services/emailService'
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
      documentType:   'OTHER',
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

  // Send email if requested
  if (sendEmailFlag && emp.email) {
    const subject = documentType === 'INCREMENT_LETTER'
      ? 'Your Increment Letter'
      : `Your ${documentType.replace(/_/g, ' ')}`
    await sendEmail(emp.email, subject, htmlContent)
  }

  res.json({ success: true, data: { docId: doc.id, url } })
})
