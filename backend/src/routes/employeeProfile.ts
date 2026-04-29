import { Router } from 'express'
import { authenticate, requireHR, requireSuperAdmin } from '../middleware/auth'
import { prisma } from '../utils/prisma'
import { AppError } from '../middleware/errorHandler'
import { BlobServiceClient, BlobSASPermissions, generateBlobSASQueryParameters, StorageSharedKeyCredential } from '@azure/storage-blob'
import multer from 'multer'
import { randomUUID } from 'crypto'
import path from 'path'
import bcrypt from 'bcryptjs'

export const employeeProfileRouter = Router()
employeeProfileRouter.use(authenticate)

// ─── AZURE BLOB UPLOAD HELPER ─────────────────────────────────────────────────

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (_req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
    cb(null, allowed.includes(file.mimetype))
  },
})

// ─── ENV CONTAINER NAMES ─────────────────────────────────────────────────────
// AZURE_PHOTOS_CONTAINER — for employee profile photos      (default: emp-photos)
// AZURE_DOCS_CONTAINER   — for employee documents           (default: emp-documents)
// AZURE_STORAGE_CONTAINER — payslips only (untouched)

function getConnStr(): string {
  const connStr = process.env.AZURE_STORAGE_CONNECTION_STRING
  if (!connStr || connStr === 'PLACEHOLDER') throw new AppError('Azure storage not configured', 500)
  return connStr
}

// Parse account name + key from connection string for SAS generation
function getSharedKeyCredential(): { accountName: string; credential: StorageSharedKeyCredential } {
  const connStr = getConnStr()
  const accountNameMatch = connStr.match(/AccountName=([^;]+)/)
  const accountKeyMatch  = connStr.match(/AccountKey=([^;]+)/)
  if (!accountNameMatch || !accountKeyMatch) throw new AppError('Invalid Azure connection string', 500)
  return {
    accountName: accountNameMatch[1],
    credential:  new StorageSharedKeyCredential(accountNameMatch[1], accountKeyMatch[1]),
  }
}

// Generate a SAS URL valid for 3 years (photos/docs don't change often)
function generateSasUrl(
  containerName: string,
  blobKey: string,
  accountName: string,
  credential: StorageSharedKeyCredential,
): string {
  const expiresOn = new Date()
  expiresOn.setFullYear(expiresOn.getFullYear() + 3)

  const sasQuery = generateBlobSASQueryParameters(
    {
      containerName,
      blobName:   blobKey,
      permissions: BlobSASPermissions.parse('r'), // read-only
      expiresOn,
    },
    credential,
  ).toString()

  return `https://${accountName}.blob.core.windows.net/${containerName}/${blobKey}?${sasQuery}`
}

function sanitizeName(name: string): string {
  // Azure blob folder name safe: lowercase, alphanumeric + hyphens only
  return name.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').slice(0, 40)
}

async function getEmpFolder(employeeId: string): Promise<string> {
  const emp = await prisma.employee.findUnique({
    where:  { id: employeeId },
    select: { employeeCode: true, name: true },
  })
  if (!emp) throw new AppError('Employee not found', 404)
  return `${sanitizeName(emp.employeeCode)}-${sanitizeName(emp.name)}`
}

async function uploadToBlob(
  buffer: Buffer,
  originalName: string,
  containerEnvKey: 'AZURE_PHOTOS_CONTAINER' | 'AZURE_DOCS_CONTAINER',
  blobPath: string,   // full path inside container e.g. "c-tek186-john-doe/profile/uuid.jpg"
): Promise<{ url: string; key: string }> {
  const connStr       = getConnStr()
  const containerName = process.env[containerEnvKey] ||
    (containerEnvKey === 'AZURE_PHOTOS_CONTAINER' ? 'emp-photos' : 'emp-documents')
  const client        = BlobServiceClient.fromConnectionString(connStr)
  const container     = client.getContainerClient(containerName)

  // Create container as PRIVATE (no public access — works on all Azure storage accounts)
  await container.createIfNotExists()

  const ext      = path.extname(originalName)
  const key      = `${blobPath}/${randomUUID()}${ext}`
  const blob     = container.getBlockBlobClient(key)
  const mimeType = originalName.toLowerCase().endsWith('.pdf') ? 'application/pdf'
    : originalName.toLowerCase().match(/\.(png|webp)$/) ? `image/${originalName.split('.').pop()}`
    : 'image/jpeg'

  await blob.uploadData(buffer, { blobHTTPHeaders: { blobContentType: mimeType } })

  // Generate a 3-year SAS URL (private blob — no public access needed)
  const { accountName, credential } = getSharedKeyCredential()
  const url = generateSasUrl(containerName, key, accountName, credential)

  return { url, key }
}

async function deleteBlob(
  key: string,
  containerEnvKey: 'AZURE_PHOTOS_CONTAINER' | 'AZURE_DOCS_CONTAINER',
): Promise<void> {
  const connStr       = getConnStr()
  const containerName = process.env[containerEnvKey] ||
    (containerEnvKey === 'AZURE_PHOTOS_CONTAINER' ? 'emp-photos' : 'emp-documents')
  const client    = BlobServiceClient.fromConnectionString(connStr)
  const container = client.getContainerClient(containerName)
  await container.getBlockBlobClient(key).deleteIfExists()
}

// ─── MANAGERS LIST (for reporting manager dropdown) ────────────────────────────

employeeProfileRouter.get('/managers/list', requireHR, async (_req, res) => {
  const managers = await prisma.employee.findMany({
    where:  { status: 'ACTIVE' },
    select: { id: true, name: true, employeeCode: true, jobTitle: true, department: true },
    orderBy: { name: 'asc' },
  })
  res.json({ success: true, data: managers })
})

// ─── GET FULL PROFILE ─────────────────────────────────────────────────────────

employeeProfileRouter.get('/:id/full', async (req, res) => {
  const emp = await prisma.employee.findUnique({
    where: { id: req.params.id },
    include: {
      profile:           true,
      address:           true,
      emergencyContacts: { orderBy: { createdAt: 'asc' } },
      educationRecords:  { orderBy: { yearOfPassing: 'desc' } },
      workExperiences:   { orderBy: { startDate: 'desc' } },
      employmentDetail:  true,
      bankAccounts:      { orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }] },
      documents:         { orderBy: { uploadedAt: 'desc' } },
      governmentId:      true,
      bankDetail:        true,
      salaryRevisions:   { orderBy: { effectiveFrom: 'desc' }, take: 10 },
    },
  })
  if (!emp) throw new AppError('Employee not found', 404)
  res.json({ success: true, data: emp })
})

// ─── PROFILE (personal info) ──────────────────────────────────────────────────

employeeProfileRouter.put('/:id/profile', requireHR, async (req, res) => {
  const {
    firstName, lastName, personalEmail, dateOfBirth,
    gender, maritalStatus, bloodGroup,
  } = req.body

  const profile = await prisma.employeeProfile.upsert({
    where:  { employeeId: req.params.id },
    create: {
      employeeId: req.params.id,
      firstName, lastName, personalEmail,
      dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : undefined,
      gender, maritalStatus,
      bloodGroup: bloodGroup || null,
    },
    update: {
      firstName, lastName, personalEmail,
      dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : undefined,
      gender, maritalStatus,
      bloodGroup: bloodGroup || null,
    },
  })

  // Also update core employee name fields if provided
  if (firstName || lastName) {
    const existing = await prisma.employee.findUnique({ where: { id: req.params.id }, select: { name: true } })
    const fullName = [firstName || existing?.name?.split(' ')[0], lastName].filter(Boolean).join(' ')
    if (fullName) await prisma.employee.update({ where: { id: req.params.id }, data: { name: fullName } })
  }

  res.json({ success: true, data: profile })
})

// Photo upload
employeeProfileRouter.post('/:id/profile/photo', requireHR, upload.single('photo'), async (req, res) => {
  if (!req.file) throw new AppError('No file uploaded', 400)

  // Delete old photo
  const existing = await prisma.employeeProfile.findUnique({ where: { employeeId: req.params.id } })
  if (existing?.profilePhotoKey) await deleteBlob(existing.profilePhotoKey, 'AZURE_PHOTOS_CONTAINER')

  const empFolder = await getEmpFolder(req.params.id)
  const { url, key } = await uploadToBlob(req.file.buffer, req.file.originalname, 'AZURE_PHOTOS_CONTAINER', `${empFolder}/profile`)

  const profile = await prisma.employeeProfile.upsert({
    where:  { employeeId: req.params.id },
    create: { employeeId: req.params.id, profilePhotoUrl: url, profilePhotoKey: key },
    update: { profilePhotoUrl: url, profilePhotoKey: key },
  })

  res.json({ success: true, data: profile })
})

// ─── ADDRESS ─────────────────────────────────────────────────────────────────

employeeProfileRouter.put('/:id/address', requireHR, async (req, res) => {
  const {
    currentLine1, currentLine2, currentCity, currentState, currentPin, currentCountry,
    sameAsCurrent,
    permanentLine1, permanentLine2, permanentCity, permanentState, permanentPin, permanentCountry,
  } = req.body

  const address = await prisma.employeeAddress.upsert({
    where:  { employeeId: req.params.id },
    create: {
      employeeId: req.params.id,
      currentLine1, currentLine2, currentCity, currentState, currentPin, currentCountry,
      sameAsCurrent: Boolean(sameAsCurrent),
      permanentLine1: sameAsCurrent ? currentLine1 : permanentLine1,
      permanentLine2: sameAsCurrent ? currentLine2 : permanentLine2,
      permanentCity:  sameAsCurrent ? currentCity  : permanentCity,
      permanentState: sameAsCurrent ? currentState : permanentState,
      permanentPin:   sameAsCurrent ? currentPin   : permanentPin,
      permanentCountry: sameAsCurrent ? currentCountry : permanentCountry,
    },
    update: {
      currentLine1, currentLine2, currentCity, currentState, currentPin, currentCountry,
      sameAsCurrent: Boolean(sameAsCurrent),
      permanentLine1: sameAsCurrent ? currentLine1 : permanentLine1,
      permanentLine2: sameAsCurrent ? currentLine2 : permanentLine2,
      permanentCity:  sameAsCurrent ? currentCity  : permanentCity,
      permanentState: sameAsCurrent ? currentState : permanentState,
      permanentPin:   sameAsCurrent ? currentPin   : permanentPin,
      permanentCountry: sameAsCurrent ? currentCountry : permanentCountry,
    },
  })

  res.json({ success: true, data: address })
})

// ─── GOVERNMENT IDS ───────────────────────────────────────────────────────────

employeeProfileRouter.put('/:id/government-id', requireHR, async (req, res) => {
  const { panNumber, aadhaarNumber, passportNumber, passportExpiry, uanNumber, esicNumber } = req.body

  // Validate PAN format
  if (panNumber && !/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/.test(panNumber.toUpperCase())) {
    throw new AppError('Invalid PAN format. Expected format: ABCDE1234F', 400)
  }

  // Validate Aadhaar (12 digits)
  if (aadhaarNumber && !/^\d{12}$/.test(aadhaarNumber.replace(/\s/g, ''))) {
    throw new AppError('Invalid Aadhaar number. Must be 12 digits.', 400)
  }

  const govId = await prisma.governmentId.upsert({
    where:  { employeeId: req.params.id },
    create: {
      employeeId: req.params.id,
      panNumber:      panNumber?.toUpperCase(),
      aadhaarNumber:  aadhaarNumber ? aadhaarNumber.replace(/\s/g, '') : undefined,
      passportNumber, passportExpiry: passportExpiry ? new Date(passportExpiry) : undefined,
      uanNumber, esicNumber,
    },
    update: {
      panNumber:      panNumber?.toUpperCase(),
      aadhaarNumber:  aadhaarNumber ? aadhaarNumber.replace(/\s/g, '') : undefined,
      passportNumber, passportExpiry: passportExpiry ? new Date(passportExpiry) : undefined,
      uanNumber, esicNumber,
    },
  })

  // Sync back to employee core fields
  await prisma.employee.update({
    where: { id: req.params.id },
    data: {
      panNumber:    panNumber?.toUpperCase(),
      aadhaarNumber: aadhaarNumber ? aadhaarNumber.replace(/\s/g, '') : undefined,
      pfNumber:     uanNumber,
      esiNumber:    esicNumber,
      uanNumber,
    },
  })

  res.json({ success: true, data: govId })
})

// ─── EMPLOYMENT DETAIL ────────────────────────────────────────────────────────

employeeProfileRouter.put('/:id/employment', requireHR, async (req, res) => {
  const { employmentType, reportingManagerId, workLocation, probationMonths } = req.body

  // Validate reporting manager exists
  if (reportingManagerId) {
    const mgr = await prisma.employee.findUnique({ where: { id: reportingManagerId } })
    if (!mgr) throw new AppError('Reporting manager not found', 404)
    if (reportingManagerId === req.params.id) throw new AppError('Employee cannot report to themselves', 400)
  }

  const detail = await prisma.employmentDetail.upsert({
    where:  { employeeId: req.params.id },
    create: { employeeId: req.params.id, employmentType, reportingManagerId, workLocation, probationMonths },
    update: { employmentType, reportingManagerId, workLocation, probationMonths },
  })

  res.json({ success: true, data: detail })
})

// ─── EMERGENCY CONTACTS ───────────────────────────────────────────────────────

employeeProfileRouter.get('/:id/contacts', async (req, res) => {
  const contacts = await prisma.emergencyContact.findMany({
    where: { employeeId: req.params.id },
    orderBy: { createdAt: 'asc' },
  })
  res.json({ success: true, data: contacts })
})

employeeProfileRouter.post('/:id/contacts', requireHR, async (req, res) => {
  const { name, relationship, contactType, phone, alternatePhone, email, address } = req.body
  if (!name || !phone) throw new AppError('Name and phone are required', 400)

  const contact = await prisma.emergencyContact.create({
    data: { employeeId: req.params.id, name, relationship, contactType, phone, alternatePhone, email, address },
  })
  res.status(201).json({ success: true, data: contact })
})

employeeProfileRouter.put('/:id/contacts/:contactId', requireHR, async (req, res) => {
  const { name, relationship, contactType, phone, alternatePhone, email, address } = req.body
  const contact = await prisma.emergencyContact.update({
    where: { id: req.params.contactId },
    data:  { name, relationship, contactType, phone, alternatePhone, email, address },
  })
  res.json({ success: true, data: contact })
})

employeeProfileRouter.delete('/:id/contacts/:contactId', requireHR, async (req, res) => {
  await prisma.emergencyContact.delete({ where: { id: req.params.contactId } })
  res.json({ success: true })
})

// ─── EDUCATION ────────────────────────────────────────────────────────────────

employeeProfileRouter.get('/:id/education', async (req, res) => {
  const records = await prisma.educationRecord.findMany({
    where: { employeeId: req.params.id },
    orderBy: { yearOfPassing: 'desc' },
  })
  res.json({ success: true, data: records })
})

employeeProfileRouter.post('/:id/education', requireHR, async (req, res) => {
  const { degree, institution, specialization, yearOfPassing, percentageGrade } = req.body
  if (!degree || !institution) throw new AppError('Degree and institution are required', 400)

  const record = await prisma.educationRecord.create({
    data: { employeeId: req.params.id, degree, institution, specialization, yearOfPassing: yearOfPassing ? Number(yearOfPassing) : undefined, percentageGrade },
  })
  res.status(201).json({ success: true, data: record })
})

employeeProfileRouter.put('/:id/education/:recordId', requireHR, async (req, res) => {
  const { degree, institution, specialization, yearOfPassing, percentageGrade } = req.body
  const record = await prisma.educationRecord.update({
    where: { id: req.params.recordId },
    data:  { degree, institution, specialization, yearOfPassing: yearOfPassing ? Number(yearOfPassing) : undefined, percentageGrade },
  })
  res.json({ success: true, data: record })
})

employeeProfileRouter.delete('/:id/education/:recordId', requireHR, async (req, res) => {
  await prisma.educationRecord.delete({ where: { id: req.params.recordId } })
  res.json({ success: true })
})

// ─── WORK EXPERIENCE ──────────────────────────────────────────────────────────

employeeProfileRouter.get('/:id/experience', async (req, res) => {
  const records = await prisma.workExperience.findMany({
    where: { employeeId: req.params.id },
    orderBy: { startDate: 'desc' },
  })
  res.json({ success: true, data: records })
})

employeeProfileRouter.post('/:id/experience', requireHR, async (req, res) => {
  const { companyName, designation, startDate, endDate, lastDrawnSalary, reasonForLeaving } = req.body
  if (!companyName || !designation || !startDate) throw new AppError('Company, designation and start date are required', 400)

  const record = await prisma.workExperience.create({
    data: {
      employeeId: req.params.id, companyName, designation,
      startDate: new Date(startDate),
      endDate: endDate ? new Date(endDate) : undefined,
      lastDrawnSalary: lastDrawnSalary ? Number(lastDrawnSalary) : undefined,
      reasonForLeaving,
    },
  })
  res.status(201).json({ success: true, data: record })
})

employeeProfileRouter.put('/:id/experience/:recordId', requireHR, async (req, res) => {
  const { companyName, designation, startDate, endDate, lastDrawnSalary, reasonForLeaving } = req.body
  const record = await prisma.workExperience.update({
    where: { id: req.params.recordId },
    data: {
      companyName, designation,
      startDate: startDate ? new Date(startDate) : undefined,
      endDate: endDate ? new Date(endDate) : undefined,
      lastDrawnSalary: lastDrawnSalary ? Number(lastDrawnSalary) : undefined,
      reasonForLeaving,
    },
  })
  res.json({ success: true, data: record })
})

employeeProfileRouter.delete('/:id/experience/:recordId', requireHR, async (req, res) => {
  await prisma.workExperience.delete({ where: { id: req.params.recordId } })
  res.json({ success: true })
})

// ─── BANK ACCOUNTS ────────────────────────────────────────────────────────────

employeeProfileRouter.get('/:id/bank-accounts', async (req, res) => {
  const accounts = await prisma.bankAccount.findMany({
    where: { employeeId: req.params.id },
    orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
  })
  res.json({ success: true, data: accounts })
})

employeeProfileRouter.post('/:id/bank-accounts', requireHR, async (req, res) => {
  const { accountHolderName, accountNumber, ifscCode, bankName, branchName, accountType, isPrimary } = req.body
  if (!accountHolderName || !accountNumber || !ifscCode || !bankName) {
    throw new AppError('Account holder name, account number, IFSC and bank name are required', 400)
  }

  // Validate IFSC format
  if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifscCode.toUpperCase())) {
    throw new AppError('Invalid IFSC code format', 400)
  }

  // If marking as primary, unset others
  if (isPrimary) {
    await prisma.bankAccount.updateMany({
      where: { employeeId: req.params.id },
      data:  { isPrimary: false },
    })
  }

  const account = await prisma.bankAccount.create({
    data: {
      employeeId: req.params.id,
      accountHolderName, accountNumber, ifscCode: ifscCode.toUpperCase(),
      bankName, branchName, accountType: accountType || 'SAVINGS',
      isPrimary: Boolean(isPrimary),
    },
  })
  res.status(201).json({ success: true, data: account })
})

employeeProfileRouter.put('/:id/bank-accounts/:accountId', requireHR, async (req, res) => {
  const { accountHolderName, accountNumber, ifscCode, bankName, branchName, accountType, isPrimary } = req.body

  if (isPrimary) {
    await prisma.bankAccount.updateMany({
      where: { employeeId: req.params.id, id: { not: req.params.accountId } },
      data:  { isPrimary: false },
    })
  }

  const account = await prisma.bankAccount.update({
    where: { id: req.params.accountId },
    data:  {
      accountHolderName, accountNumber,
      ifscCode: ifscCode?.toUpperCase(),
      bankName, branchName, accountType,
      isPrimary: Boolean(isPrimary),
    },
  })
  res.json({ success: true, data: account })
})

employeeProfileRouter.delete('/:id/bank-accounts/:accountId', requireHR, async (req, res) => {
  const account = await prisma.bankAccount.findUnique({ where: { id: req.params.accountId } })
  if (account?.documentKey) await deleteBlob(account.documentKey, 'AZURE_DOCS_CONTAINER')
  await prisma.bankAccount.delete({ where: { id: req.params.accountId } })
  res.json({ success: true })
})

// ─── DOCUMENTS ────────────────────────────────────────────────────────────────

// ─── DOCUMENT ROUTES ─────────────────────────────────────────────────────────

// EMPLOYEE_SELF_UPLOAD doc types that can be locked
const SELF_UPLOAD_TYPES = ['PAN_CARD', 'AADHAAR_CARD', 'PASSPORT', 'OFFER_LETTER', 'RELIEVING_LETTER']

employeeProfileRouter.get('/:id/documents', async (req, res) => {
  const docs = await prisma.employeeDocument.findMany({
    where: { employeeId: req.params.id },
    orderBy: { uploadedAt: 'desc' },
  })
  // Regenerate fresh SAS URLs from stored fileKey (avoids stale/truncated URLs in DB)
  const { accountName, credential } = getSharedKeyCredential()
  const docsWithFreshUrls = docs.map(doc => {
    if (!doc.fileKey) return doc
    const containerName = doc.fileKey.startsWith('generated-docs/')
      ? (process.env.AZURE_DOCS_CONTAINER || 'emp-documents')
      : (process.env.AZURE_DOCS_CONTAINER || 'emp-documents')
    try {
      const freshUrl = generateSasUrl(containerName, doc.fileKey, accountName, credential)
      return { ...doc, fileUrl: freshUrl }
    } catch {
      return doc
    }
  })
  res.json({ success: true, data: docsWithFreshUrls })
})

// HR/SA upload — never locks
employeeProfileRouter.post('/:id/documents', requireHR, upload.single('file'), async (req, res) => {
  if (!req.file) throw new AppError('No file uploaded', 400)
  const { documentType, notes, referenceNumber } = req.body
  if (!documentType) throw new AppError('Document type is required', 400)

  const empFolder = await getEmpFolder(req.params.id)
  const { url, key } = await uploadToBlob(req.file.buffer, req.file.originalname, 'AZURE_DOCS_CONTAINER', empFolder)

  const doc = await prisma.employeeDocument.create({
    data: {
      employeeId:     req.params.id,
      documentType,
      fileName:       req.file.originalname,
      fileUrl:        url,
      fileKey:        key,
      fileSize:       req.file.size,
      mimeType:       req.file.mimetype,
      notes,
      referenceNumber: referenceNumber || null,
      isLocked:        false,
      uploadedByRole:  req.user!.role,
      uploadedBy:      req.user!.id,
    },
  })
  res.status(201).json({ success: true, data: doc })
})

// Employee self-upload — locks on submission
employeeProfileRouter.post('/:id/documents/self', upload.single('file'), async (req, res) => {
  // Only the employee themselves can upload
  const employee = await prisma.employee.findUnique({ where: { id: req.params.id } })
  if (!employee) throw new AppError('Employee not found', 404)
  if (req.user!.id !== employee.id && req.user!.role === 'EMPLOYEE') {
    throw new AppError('Forbidden', 403)
  }

  if (!req.file) throw new AppError('No file uploaded', 400)
  const { documentType, referenceNumber } = req.body
  if (!documentType) throw new AppError('Document type is required', 400)
  if (!SELF_UPLOAD_TYPES.includes(documentType)) throw new AppError('Invalid document type for self-upload', 400)

  // PAN and AADHAAR: only one allowed (check not already locked)
  const singleTypes = ['PAN_CARD', 'AADHAAR_CARD', 'PASSPORT']
  if (singleTypes.includes(documentType)) {
    const existing = await prisma.employeeDocument.findFirst({
      where: { employeeId: req.params.id, documentType: documentType as any, isLocked: true },
    })
    if (existing) throw new AppError('Document already submitted and locked. Contact HR to update.', 400)
  }

  const empFolder = await getEmpFolder(req.params.id)
  const { url, key } = await uploadToBlob(req.file.buffer, req.file.originalname, 'AZURE_DOCS_CONTAINER', empFolder)

  const doc = await prisma.employeeDocument.create({
    data: {
      employeeId:      req.params.id,
      documentType,
      fileName:        req.file.originalname,
      fileUrl:         url,
      fileKey:         key,
      fileSize:        req.file.size,
      mimeType:        req.file.mimetype,
      referenceNumber: referenceNumber || null,
      isLocked:        true,
      uploadedByRole:  'EMPLOYEE',
      uploadedBy:      req.user!.id,
    },
  })
  res.status(201).json({ success: true, data: doc })
})

employeeProfileRouter.put('/:id/documents/:docId/verify', requireHR, async (req, res) => {
  const doc = await prisma.employeeDocument.update({
    where: { id: req.params.docId },
    data:  { isVerified: true, verifiedBy: req.user!.id, verifiedAt: new Date() },
  })
  res.json({ success: true, data: doc })
})

employeeProfileRouter.delete('/:id/documents/:docId', requireHR, async (req, res) => {
  const doc = await prisma.employeeDocument.findUnique({ where: { id: req.params.docId } })
  if (doc?.fileKey) await deleteBlob(doc.fileKey, 'AZURE_DOCS_CONTAINER')
  await prisma.employeeDocument.delete({ where: { id: req.params.docId } })
  res.json({ success: true })
})


// ─── PAYSLIP PASSWORD — EMPLOYEE SELF-SERVICE ─────────────────────────────────

// Get password status for current user
employeeProfileRouter.get('/my/payslip-password-status', async (req: any, res) => {
  const profile = await prisma.employeeProfile.findUnique({ where: { employeeId: req.user!.id } })
  res.json({
    success: true,
    data: {
      hasPassword: !!profile?.payslipPassword,
      resetAllowed: profile?.payslipPasswordResetAllowed ?? false,
    }
  })
})

// Verify password
employeeProfileRouter.post('/my/verify-payslip-password', async (req: any, res) => {
  const { password } = req.body
  if (!password) throw new AppError('Password required', 400)
  const profile = await prisma.employeeProfile.findUnique({ where: { employeeId: req.user!.id } })
  if (!profile?.payslipPassword) throw new AppError('No password set', 400)
  const ok = await bcrypt.compare(password, profile.payslipPassword)
  if (!ok) throw new AppError('Incorrect password', 401)
  res.json({ success: true })
})

// Set / change password
employeeProfileRouter.post('/my/set-payslip-password', async (req: any, res) => {
  const { oldPassword, newPassword } = req.body
  if (!newPassword || newPassword.length < 4) throw new AppError('Password must be at least 4 characters', 400)

  const empId = req.user!.id
  const profile = await prisma.employeeProfile.findUnique({ where: { employeeId: empId } })
  const hasExisting = !!profile?.payslipPassword
  const resetAllowed = profile?.payslipPasswordResetAllowed ?? false

  if (hasExisting && !resetAllowed) {
    if (!oldPassword) throw new AppError('Current password required', 400)
    const ok = await bcrypt.compare(oldPassword, profile.payslipPassword!)
    if (!ok) throw new AppError('Current password is incorrect', 401)
  }

  const hashed = await bcrypt.hash(newPassword, 10)

  await prisma.employeeProfile.upsert({
    where:  { employeeId: empId },
    create: { employeeId: empId, payslipPassword: hashed, payslipPasswordResetAllowed: false },
    update: { payslipPassword: hashed, payslipPasswordResetAllowed: false },
  })

  res.json({ success: true })
})

// ─── PAYSLIP PASSWORD — HR / SUPER ADMIN ──────────────────────────────────────

// Get password reset status for any employee (HR+)
employeeProfileRouter.get('/:id/payslip-password-info', requireHR, async (req, res) => {
  const profile = await prisma.employeeProfile.findUnique({ where: { employeeId: req.params.id } })
  res.json({
    success: true,
    data: {
      hasPassword: !!profile?.payslipPassword,
      resetAllowed: profile?.payslipPasswordResetAllowed ?? false,
    }
  })
})

// Allow employee to reset password without old password (Super Admin only)
employeeProfileRouter.patch('/:id/allow-password-reset', requireSuperAdmin, async (req: any, res) => {
  const { allow } = req.body
  await prisma.employeeProfile.upsert({
    where: { employeeId: req.params.id },
    create: {
      employeeId: req.params.id,
      payslipPasswordResetAllowed: allow !== false,
    },
    update: {
      payslipPasswordResetAllowed: allow !== false,
    },
  })
  res.json({ success: true })
})
