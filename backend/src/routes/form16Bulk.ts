import { Router } from 'express'
import { authenticate, requireSuperAdmin } from '../middleware/auth'
import { prisma } from '../utils/prisma'
import { AppError } from '../middleware/errorHandler'
import multer from 'multer'
import { randomUUID, createHmac } from 'crypto'
import { PDFDocument } from 'pdf-lib'
import fs from 'fs'
import path from 'path'
// pdf-parse v1 (CommonJS) — require returns the function directly
// eslint-disable-next-line @typescript-eslint/no-var-requires
const pdfParse = require('pdf-parse')

export const form16BulkRouter = Router()

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024, files: 100 },
  fileFilter: (_req, file, cb) => cb(null, file.mimetype === 'application/pdf'),
})

// ─── LOCAL VOLUME STORAGE HELPERS (Railway volume at /data) ───────────────────

const STORAGE_ROOT = process.env.FILE_STORAGE_DIR || '/data'
const FILE_TOKEN_SECRET = process.env.FILE_TOKEN_SECRET || process.env.AZURE_CLIENT_ID || 'tekone-file-secret'

function saveLocalFile(buffer: Buffer, relativeKey: string): string {
  const fullPath = path.join(STORAGE_ROOT, relativeKey)
  fs.mkdirSync(path.dirname(fullPath), { recursive: true })
  fs.writeFileSync(fullPath, buffer)
  return relativeKey
}

function readLocalFile(relativeKey: string): Buffer {
  const fullPath = path.join(STORAGE_ROOT, relativeKey)
  return fs.readFileSync(fullPath)
}

function deleteLocalFile(relativeKey: string): void {
  try {
    const fullPath = path.join(STORAGE_ROOT, relativeKey)
    if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath)
  } catch { /* best effort */ }
}

function signFileToken(key: string, expiresAtMs: number): string {
  return createHmac('sha256', FILE_TOKEN_SECRET).update(`${key}:${expiresAtMs}`).digest('hex')
}

function verifyFileToken(key: string, expiresAtMs: number, token: string): boolean {
  if (Date.now() > expiresAtMs) return false
  return signFileToken(key, expiresAtMs) === token
}

function buildFileUrl(key: string): string {
  const base = process.env.BACKEND_URL || ''
  const exp = Date.now() + 3 * 365 * 24 * 60 * 60 * 1000
  const token = signFileToken(key, exp)
  const qs = `key=${encodeURIComponent(key)}&exp=${exp}&token=${token}`
  return `${base}/api/form16/file?${qs}`
}

function storeFile(buffer: Buffer, relativeKey: string): { url: string; key: string } {
  const key = saveLocalFile(buffer, relativeKey)
  return { url: buildFileUrl(key), key }
}

// ─── PUBLIC FILE STREAM (token-signed, no auth header needed) ─────────────────
// MUST be registered BEFORE the authenticate middleware below so <a href> works.
form16BulkRouter.get('/file', (req, res) => {
  const key = String(req.query.key || '')
  const exp = Number(req.query.exp || 0)
  const token = String(req.query.token || '')
  if (!key || !exp || !token || !verifyFileToken(key, exp, token)) {
    return res.status(403).send('Invalid or expired link')
  }
  const fullPath = path.join(STORAGE_ROOT, key)
  if (!fullPath.startsWith(STORAGE_ROOT) || !fs.existsSync(fullPath)) {
    return res.status(404).send('File not found')
  }
  res.setHeader('Content-Type', 'application/pdf')
  res.setHeader('Content-Disposition', `inline; filename="${path.basename(key)}"`)
  fs.createReadStream(fullPath).pipe(res)
})

// Everything below requires SUPER_ADMIN auth
form16BulkRouter.use(authenticate)
form16BulkRouter.use(requireSuperAdmin)

function sanitizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').slice(0, 40)
}

// ─── TEXT EXTRACTION / MATCHING ────────────────────────────────────────────────

const PAN_REGEX = /\b([A-Z]{5}[0-9]{4}[A-Z])\b/g

interface Extracted {
  pan: string | null
  name: string | null
  rawText: string
  isPartA: boolean
  isPartB: boolean
}

// Pull the EMPLOYEE PAN — the one near "PAN of the Employee/Specified senior citizen".
// Form 16 also contains the deductor (company) PAN, which we must NOT use.
function extractEmployeePan(text: string): string | null {
  // Look for the employee-PAN label, then the first PAN pattern that follows it
  const labelIdx = text.search(/PAN of the Employee(?:\/Specified senior citizen)?/i)
  if (labelIdx >= 0) {
    const after = text.slice(labelIdx, labelIdx + 200)
    const m = after.match(/[A-Z]{5}[0-9]{4}[A-Z]/)
    if (m) return m[0]
  }
  // Fallback: last PAN in the doc is usually the employee's (deductor PAN appears first)
  const all = text.match(PAN_REGEX)
  if (all && all.length) return all[all.length - 1]
  return null
}

// Pull the EMPLOYEE name — near "Name and address of the Employee", NOT employer.
function extractEmployeeName(text: string): string | null {
  const patterns = [
    /Name and address of the Employee(?:\/Specified senior citizen)?\s*:?\s*([A-Za-z][A-Za-z .]{3,60})/i,
    /Name of the Employee(?:\/Specified senior citizen)?\s*:?\s*([A-Za-z][A-Za-z .]{3,60})/i,
    /Employee Name\s*:?\s*([A-Za-z][A-Za-z .]{3,60})/i,
  ]
  for (const p of patterns) {
    const m = text.match(p)
    if (m) {
      // Trim trailing address/label noise — keep up to first newline-ish break or double space
      let name = m[1].trim()
      // Stop at common trailing words that indicate address started
      name = name.split(/\s+(?:S\/O|D\/O|W\/O|Flat|House|Plot|Road|Street|PIN|Pin)\b/i)[0].trim()
      if (name.length >= 3) return name
    }
  }
  return null
}

async function extractPdfInfo(buffer: Buffer): Promise<Extracted> {
  let text = ''
  try {
    const parsed = await pdfParse(buffer)
    text = (parsed.text || '').replace(/\s+/g, ' ')
  } catch {
    text = ''
  }
  const upper = text.toUpperCase()
  const isPartA = upper.includes('PART A') || upper.includes('PART-A')
  const isPartB = upper.includes('PART B') || upper.includes('PART-B')
  return {
    pan: extractEmployeePan(text),
    name: extractEmployeeName(text),
    rawText: text,
    isPartA,
    isPartB,
  }
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
      saveLocalFile(file.buffer, blobKey)
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

      const nameGuess = partA.extracted.name || partB?.extracted.name || null
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
      const nameGuess = info.extracted.name
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
    if (item.partAFileKey) deleteLocalFile(item.partAFileKey)
    if (item.partBFileKey) deleteLocalFile(item.partBFileKey)
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

    const results: any[] = []

    for (const item of items) {
      try {
        const partABuf = readLocalFile(item.partAFileKey!)
        const mergedDoc = await PDFDocument.create()

        const docA = await PDFDocument.load(partABuf)
        const pagesA = await mergedDoc.copyPages(docA, docA.getPageIndices())
        pagesA.forEach(p => mergedDoc.addPage(p))

        if (item.partBFileKey) {
          const partBBuf = readLocalFile(item.partBFileKey)
          const docB = await PDFDocument.load(partBBuf)
          const pagesB = await mergedDoc.copyPages(docB, docB.getPageIndices())
          pagesB.forEach(p => mergedDoc.addPage(p))
        }

        const mergedBytes = await mergedDoc.save()
        const empFolder = `${sanitizeName(item.employee!.employeeCode)}-${sanitizeName(item.employee!.name)}`
        const finalKey = `form16/${empFolder}/form16-${randomUUID()}.pdf`
        const { url, key } = storeFile(Buffer.from(mergedBytes), finalKey)

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

        deleteLocalFile(item.partAFileKey!)
        if (item.partBFileKey) deleteLocalFile(item.partBFileKey)

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
