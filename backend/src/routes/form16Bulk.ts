import { Router } from 'express'
import { authenticate, requireSuperAdmin } from '../middleware/auth'
import { prisma } from '../utils/prisma'
import { AppError } from '../middleware/errorHandler'
import { BlobServiceClient, BlobSASPermissions, generateBlobSASQueryParameters, StorageSharedKeyCredential } from '@azure/storage-blob'
import multer from 'multer'
import { randomUUID } from 'crypto'
import { PDFDocument } from 'pdf-lib'
// pdf-parse v2 exports differently — use require to avoid ESM default-export issues
// eslint-disable-next-line @typescript-eslint/no-var-requires
const pdfParse = require('pdf-parse')

export const form16BulkRouter = Router()
form16BulkRouter.use(authenticate)
form16BulkRouter.use(requireSuperAdmin)

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024, files: 100 },
  fileFilter: (_req, file, cb) => cb(null, file.mimetype === 'application/pdf'),
})

// ─── AZURE BLOB HELPERS (temp container for staging) ──────────────────────────

function getConnStr(): string {
  const connStr = process.env.AZURE_STORAGE_CONNECTION_STRING
  if (!connStr || connStr === 'PLACEHOLDER') throw new AppError('Azure storage not configured', 500)
  return connStr
}

function getSharedKeyCredential(): { accountName: string; credential: StorageSharedKeyCredential } {
  const connStr = getConnStr()
  const accountNameMatch = connStr.match(/AccountName=([^;]+)/)
  const accountKeyMatch = connStr.match(/AccountKey=([^;]+)/)
  if (!accountNameMatch || !accountKeyMatch) throw new AppError('Invalid Azure connection string', 500)
  return {
    accountName: accountNameMatch[1],
    credential: new StorageSharedKeyCredential(accountNameMatch[1], accountKeyMatch[1]),
  }
}

function generateSasUrl(containerName: string, blobKey: string, accountName: string, credential: StorageSharedKeyCredential): string {
  const expiresOn = new Date()
  expiresOn.setFullYear(expiresOn.getFullYear() + 3)
  const sasQuery = generateBlobSASQueryParameters(
    { containerName, blobName: blobKey, permissions: BlobSASPermissions.parse('r'), expiresOn },
    credential,
  ).toString()
  return `https://${accountName}.blob.core.windows.net/${containerName}/${blobKey}?${sasQuery}`
}

async function uploadToBlob(buffer: Buffer, blobPath: string, containerEnvKey: string): Promise<{ url: string; key: string }> {
  const connStr = getConnStr()
  const containerName = process.env[containerEnvKey] || 'emp-documents'
  const client = BlobServiceClient.fromConnectionString(connStr)
  const container = client.getContainerClient(containerName)
  await container.createIfNotExists()
  const blockBlob = container.getBlockBlobClient(blobPath)
  await blockBlob.uploadData(buffer, { blobHTTPHeaders: { blobContentType: 'application/pdf' } })
  const { accountName, credential } = getSharedKeyCredential()
  const url = generateSasUrl(containerName, blobPath, accountName, credential)
  return { url, key: blobPath }
}

async function deleteBlob(blobPath: string, containerEnvKey: string): Promise<void> {
  try {
    const connStr = getConnStr()
    const containerName = process.env[containerEnvKey] || 'emp-documents'
    const client = BlobServiceClient.fromConnectionString(connStr)
    const container = client.getContainerClient(containerName)
    await container.getBlockBlobClient(blobPath).deleteIfExists()
  } catch { /* best effort cleanup */ }
}

function sanitizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').slice(0, 40)
}

// ─── TEXT EXTRACTION / MATCHING ────────────────────────────────────────────────

const PAN_REGEX = /\b([A-Z]{5}[0-9]{4}[A-Z])\b/

interface Extracted {
  pan: string | null
  rawText: string
  isPartA: boolean
  isPartB: boolean
}

async function extractPdfInfo(buffer: Buffer): Promise<Extracted> {
  let text = ''
  try {
    const parsed = await pdfParse(buffer)
    text = (parsed.text || '').replace(/\s+/g, ' ')
  } catch {
    text = ''
  }
  const panMatch = text.match(PAN_REGEX)
  const upper = text.toUpperCase()
  const isPartA = upper.includes('PART A') || upper.includes('PART-A')
  const isPartB = upper.includes('PART B') || upper.includes('PART-B')
  return { pan: panMatch ? panMatch[1] : null, rawText: text, isPartA, isPartB }
}

// Strip designation/parenthetical/extra tokens, normalize for fuzzy match
function normalizeName(raw: string): string[] {
  return raw
    .replace(/\(.*?\)/g, ' ')
    .replace(/[^a-zA-Z\s]/g, ' ')
    .toUpperCase()
    .split(/\s+/)
    .filter(Boolean)
}

const DESIGNATION_STOPWORDS = new Set([
  'ENGINEER', 'SOFTWARE', 'SENIOR', 'JUNIOR', 'LEAD', 'MANAGER', 'DEVELOPER',
  'ANALYST', 'EXECUTIVE', 'HEAD', 'DIRECTOR', 'CONSULTANT', 'ASSOCIATE',
  'INTERN', 'TRAINEE', 'SR', 'JR', 'HR', 'ADMIN', 'SUPPORT', 'DESIGNER',
])

function coreNameTokens(tokens: string[]): string[] {
  return tokens.filter(t => !DESIGNATION_STOPWORDS.has(t))
}

function nameMatchScore(extractedTokens: string[], employeeTokens: string[]): number {
  const a = new Set(coreNameTokens(extractedTokens))
  const b = new Set(coreNameTokens(employeeTokens))
  if (a.size === 0 || b.size === 0) return 0
  let overlap = 0
  for (const t of a) if (b.has(t)) overlap++
  const denom = Math.max(a.size, b.size)
  return Math.round((overlap / denom) * 100)
}

function guessNameFromText(text: string): string | null {
  const patterns = [
    /Name and address of the Employee[^:]*:?\s*([A-Za-z .]{4,60})/i,
    /Name of the Employee\s*:?\s*([A-Za-z .]{4,60})/i,
    /Employee Name\s*:?\s*([A-Za-z .]{4,60})/i,
  ]
  for (const p of patterns) {
    const m = text.match(p)
    if (m) return m[1].trim()
  }
  return null
}

// ─── ROUTES ─────────────────────────────────────────────────────────────────

form16BulkRouter.post('/bulk-upload', upload.array('files', 100), async (req: any, res, next) => {
  try {
    const files: any[] = req.files || []
    if (!files.length) throw new AppError('No files uploaded', 400)

    const employees = await prisma.employee.findMany({
      select: { id: true, name: true, employeeCode: true },
    })
    const employeeTokenMap = employees.map(e => ({ emp: e, tokens: normalizeName(e.name) }))

    const session = await prisma.form16BulkSession.create({
      data: { uploadedBy: req.user.id, totalFiles: files.length, status: 'REVIEWING' },
    })

    type FileInfo = { file: any; extracted: Extracted; blobKey: string }
    const infos: FileInfo[] = []
    for (const file of files) {
      const extracted = await extractPdfInfo(file.buffer)
      const blobKey = `form16-staging/${session.id}/${randomUUID()}-${file.originalname}`
      await uploadToBlob(file.buffer, blobKey, 'AZURE_DOCS_CONTAINER')
      infos.push({ file, extracted, blobKey })
    }

    const byPan = new Map<string, FileInfo[]>()
    const noPan: FileInfo[] = []
    for (const info of infos) {
      if (info.extracted.pan) {
        const arr = byPan.get(info.extracted.pan) || []
        arr.push(info)
        byPan.set(info.extracted.pan, arr)
      } else {
        noPan.push(info)
      }
    }

    const items: any[] = []

    for (const [pan, group] of byPan.entries()) {
      const partA = group.find(g => g.extracted.isPartA) || group[0]
      const partB = group.find(g => g.extracted.isPartB && g !== partA)

      const nameGuess = guessNameFromText(partA.extracted.rawText) || guessNameFromText(partB?.extracted.rawText || '')
      let bestMatch: { emp: typeof employees[0]; score: number } | null = null
      if (nameGuess) {
        const guessTokens = normalizeName(nameGuess)
        for (const { emp, tokens } of employeeTokenMap) {
          const score = nameMatchScore(guessTokens, tokens)
          if (!bestMatch || score > bestMatch.score) bestMatch = { emp, score }
        }
      }

      const matched = !!(bestMatch && bestMatch.score >= 60)
      items.push({
        sessionId: session.id,
        employeeId: matched ? bestMatch!.emp.id : null,
        matchedName: matched ? bestMatch!.emp.name : nameGuess,
        extractedPan: pan,
        matchConfidence: bestMatch ? bestMatch.score : 0,
        matchMethod: matched ? 'PAN_NAME' : 'NAME_FUZZY',
        partAFileKey: partA.blobKey,
        partAFileName: partA.file.originalname,
        partBFileKey: partB?.blobKey || null,
        partBFileName: partB?.file.originalname || null,
        status: matched ? 'MATCHED' : 'UNMATCHED',
      })
    }

    const noPanByEmployee = new Map<string, FileInfo[]>()
    const noPanUnresolved: FileInfo[] = []
    for (const info of noPan) {
      const nameGuess = guessNameFromText(info.extracted.rawText)
      if (!nameGuess) { noPanUnresolved.push(info); continue }
      const guessTokens = normalizeName(nameGuess)
      let bestMatch: { emp: typeof employees[0]; score: number } | null = null
      for (const { emp, tokens } of employeeTokenMap) {
        const score = nameMatchScore(guessTokens, tokens)
        if (!bestMatch || score > bestMatch.score) bestMatch = { emp, score }
      }
      if (bestMatch && bestMatch.score >= 60) {
        const arr = noPanByEmployee.get(bestMatch.emp.id) || []
        arr.push(info)
        noPanByEmployee.set(bestMatch.emp.id, arr)
      } else {
        noPanUnresolved.push(info)
      }
    }

    for (const [empId, group] of noPanByEmployee.entries()) {
      const emp = employees.find(e => e.id === empId)!
      const partA = group.find(g => g.extracted.isPartA) || group[0]
      const partB = group.find(g => g.extracted.isPartB && g !== partA)
      items.push({
        sessionId: session.id,
        employeeId: emp.id,
        matchedName: emp.name,
        extractedPan: null,
        matchConfidence: 60,
        matchMethod: 'NAME_FUZZY',
        partAFileKey: partA.blobKey,
        partAFileName: partA.file.originalname,
        partBFileKey: partB?.blobKey || null,
        partBFileName: partB?.file.originalname || null,
        status: 'MATCHED',
      })
    }

    for (const info of noPanUnresolved) {
      items.push({
        sessionId: session.id,
        employeeId: null,
        matchedName: null,
        extractedPan: null,
        matchConfidence: 0,
        matchMethod: null,
        partAFileKey: info.blobKey,
        partAFileName: info.file.originalname,
        status: 'UNMATCHED',
      })
    }

    await prisma.form16BulkItem.createMany({ data: items })

    const fullItems = await prisma.form16BulkItem.findMany({
      where: { sessionId: session.id },
      include: { employee: { select: { id: true, name: true, employeeCode: true } } },
      orderBy: { createdAt: 'asc' },
    })

    res.json({ data: { sessionId: session.id, items: fullItems } })
  } catch (err) { next(err) }
})

form16BulkRouter.put('/bulk-items/:id', async (req: any, res, next) => {
  try {
    const { employeeId } = req.body
    if (!employeeId) throw new AppError('employeeId required', 400)
    const emp = await prisma.employee.findUnique({ where: { id: employeeId }, select: { id: true, name: true } })
    if (!emp) throw new AppError('Employee not found', 404)

    const item = await prisma.form16BulkItem.update({
      where: { id: req.params.id },
      data: { employeeId: emp.id, matchedName: emp.name, matchMethod: 'MANUAL', matchConfidence: 100, status: 'MATCHED' },
      include: { employee: { select: { id: true, name: true, employeeCode: true } } },
    })
    res.json({ data: item })
  } catch (err) { next(err) }
})

form16BulkRouter.delete('/bulk-items/:id', async (req: any, res, next) => {
  try {
    const item = await prisma.form16BulkItem.findUnique({ where: { id: req.params.id } })
    if (!item) throw new AppError('Item not found', 404)
    if (item.partAFileKey) await deleteBlob(item.partAFileKey, 'AZURE_DOCS_CONTAINER')
    if (item.partBFileKey) await deleteBlob(item.partBFileKey, 'AZURE_DOCS_CONTAINER')
    await prisma.form16BulkItem.update({ where: { id: req.params.id }, data: { status: 'REJECTED' } })
    res.json({ data: { success: true } })
  } catch (err) { next(err) }
})

form16BulkRouter.post('/bulk-confirm/:sessionId', async (req: any, res, next) => {
  try {
    const items = await prisma.form16BulkItem.findMany({
      where: { sessionId: req.params.sessionId, status: 'MATCHED', employeeId: { not: null } },
      include: { employee: { select: { id: true, name: true, employeeCode: true } } },
    })
    if (!items.length) throw new AppError('No matched items to confirm', 400)

    const connStr = getConnStr()
    const containerName = process.env.AZURE_DOCS_CONTAINER || 'emp-documents'
    const client = BlobServiceClient.fromConnectionString(connStr)
    const container = client.getContainerClient(containerName)

    const results: any[] = []

    for (const item of items) {
      try {
        const partABlob = await container.getBlockBlobClient(item.partAFileKey!).downloadToBuffer()
        const mergedDoc = await PDFDocument.create()

        const docA = await PDFDocument.load(partABlob)
        const pagesA = await mergedDoc.copyPages(docA, docA.getPageIndices())
        pagesA.forEach(p => mergedDoc.addPage(p))

        if (item.partBFileKey) {
          const partBBlob = await container.getBlockBlobClient(item.partBFileKey).downloadToBuffer()
          const docB = await PDFDocument.load(partBBlob)
          const pagesB = await mergedDoc.copyPages(docB, docB.getPageIndices())
          pagesB.forEach(p => mergedDoc.addPage(p))
        }

        const mergedBytes = await mergedDoc.save()
        const empFolder = `${sanitizeName(item.employee!.employeeCode)}-${sanitizeName(item.employee!.name)}`
        const finalKey = `${empFolder}/form16-${randomUUID()}.pdf`
        const { url, key } = await uploadToBlob(Buffer.from(mergedBytes), finalKey, 'AZURE_DOCS_CONTAINER')

        await prisma.employeeDocument.create({
          data: {
            employeeId: item.employee!.id,
            documentType: 'FORM_16',
            fileName: `Form16-${item.employee!.employeeCode}.pdf`,
            fileUrl: url,
            fileKey: key,
            fileSize: mergedBytes.length,
            mimeType: 'application/pdf',
            isVerified: true,
            verifiedBy: req.user.id,
            verifiedAt: new Date(),
            referenceNumber: item.extractedPan,
            isLocked: true,
            uploadedByRole: 'SUPER_ADMIN',
            uploadedBy: req.user.id,
          },
        })

        await deleteBlob(item.partAFileKey!, 'AZURE_DOCS_CONTAINER')
        if (item.partBFileKey) await deleteBlob(item.partBFileKey, 'AZURE_DOCS_CONTAINER')

        await prisma.form16BulkItem.update({
          where: { id: item.id },
          data: { status: 'CONFIRMED', mergedFileKey: key, mergedFileUrl: url },
        })

        results.push({ itemId: item.id, employee: item.employee!.name, success: true })
      } catch (err: any) {
        await prisma.form16BulkItem.update({
          where: { id: item.id },
          data: { errorMessage: err?.message || 'Merge/upload failed' },
        })
        results.push({ itemId: item.id, employee: item.employee?.name, success: false, error: err?.message })
      }
    }

    await prisma.form16BulkSession.update({ where: { id: req.params.sessionId }, data: { status: 'CONFIRMED' } })

    res.json({ data: { results } })
  } catch (err) { next(err) }
})

form16BulkRouter.get('/bulk-sessions/:id', async (req, res, next) => {
  try {
    const items = await prisma.form16BulkItem.findMany({
      where: { sessionId: req.params.id },
      include: { employee: { select: { id: true, name: true, employeeCode: true } } },
      orderBy: { createdAt: 'asc' },
    })
    res.json({ data: { items } })
  } catch (err) { next(err) }
})
