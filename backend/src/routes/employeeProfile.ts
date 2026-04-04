import { Router } from 'express'
import { authenticate, requireHR } from '../middleware/auth'
import { prisma } from '../utils/prisma'
import { AppError } from '../middleware/errorHandler'
import { BlobServiceClient } from '@azure/storage-blob'
import multer from 'multer'
import { randomUUID } from 'crypto'
import path from 'path'

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

async function uploadToBlob(buffer: Buffer, originalName: string, folder: string): Promise<{ url: string; key: string }> {
  const connStr = process.env.AZURE_STORAGE_CONNECTION_STRING
  if (!connStr || connStr === 'PLACEHOLDER') {
    throw new AppError('Azure storage not configured', 500)
  }

  const client    = BlobServiceClient.fromConnectionString(connStr)
  const container = client.getContainerClient(process.env.AZURE_STORAGE_CONTAINER || 'payslips')
  await container.createIfNotExists({ access: 'blob' })

  const ext  = path.extname(originalName)
  const key  = `${folder}/${randomUUID()}${ext}`
  const blob = container.getBlockBlobClient(key)

  await blob.uploadData(buffer, {
    blobHTTPHeaders: { blobContentType: originalName.includes('.pdf') ? 'application/pdf' : 'image/jpeg' },
  })

  return { url: blob.url, key }
}

async function deleteBlob(key: string) {
  const connStr = process.env.AZURE_STORAGE_CONNECTION_STRING
  if (!connStr || connStr === 'PLACEHOLDER') return
  const client    = BlobServiceClient.fromConnectionString(connStr)
  const container = client.getContainerClient(process.env.AZURE_STORAGE_CONTAINER || 'payslips')
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
      gender, maritalStatus, bloodGroup,
    },
    update: {
      firstName, lastName, personalEmail,
      dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : undefined,
      gender, maritalStatus, bloodGroup,
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
  if (existing?.profilePhotoKey) await deleteBlob(existing.profilePhotoKey)

  const { url, key } = await uploadToBlob(req.file.buffer, req.file.originalname, 'photos')

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
  if (account?.documentKey) await deleteBlob(account.documentKey)
  await prisma.bankAccount.delete({ where: { id: req.params.accountId } })
  res.json({ success: true })
})

// ─── DOCUMENTS ────────────────────────────────────────────────────────────────

employeeProfileRouter.get('/:id/documents', async (req, res) => {
  const docs = await prisma.employeeDocument.findMany({
    where: { employeeId: req.params.id },
    orderBy: { uploadedAt: 'desc' },
  })
  res.json({ success: true, data: docs })
})

employeeProfileRouter.post('/:id/documents', requireHR, upload.single('file'), async (req, res) => {
  if (!req.file) throw new AppError('No file uploaded', 400)
  const { documentType, notes } = req.body
  if (!documentType) throw new AppError('Document type is required', 400)

  const { url, key } = await uploadToBlob(req.file.buffer, req.file.originalname, `docs/${req.params.id}`)

  const doc = await prisma.employeeDocument.create({
    data: {
      employeeId:   req.params.id,
      documentType,
      fileName:     req.file.originalname,
      fileUrl:      url,
      fileKey:      key,
      fileSize:     req.file.size,
      mimeType:     req.file.mimetype,
      notes,
      uploadedBy:   req.user!.id,
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
  if (doc?.fileKey) await deleteBlob(doc.fileKey)
  await prisma.employeeDocument.delete({ where: { id: req.params.docId } })
  res.json({ success: true })
})

