import fs from 'fs'
import fsp from 'fs/promises'
import path from 'path'
import crypto from 'crypto'
import { AppError } from '../middleware/errorHandler'

// Railway volume mount path (Settings → Volumes). Falls back to local dir for dev.
const VOLUME_ROOT = process.env.RAILWAY_VOLUME_PATH || '/data'

const SIGNING_SECRET = process.env.FILE_SIGNING_SECRET || process.env.JWT_SECRET || 'dev-file-signing-secret'

function safeJoin(container: string, key: string): string {
  const full = path.normalize(path.join(VOLUME_ROOT, container, key))
  const base = path.normalize(path.join(VOLUME_ROOT, container))
  if (!full.startsWith(base)) throw new AppError('Invalid file path', 400)
  return full
}

export async function saveFile(container: string, key: string, buffer: Buffer): Promise<void> {
  const filePath = safeJoin(container, key)
  await fsp.mkdir(path.dirname(filePath), { recursive: true })
  await fsp.writeFile(filePath, buffer)
}

export async function readFile(container: string, key: string): Promise<Buffer> {
  const filePath = safeJoin(container, key)
  try {
    return await fsp.readFile(filePath)
  } catch {
    throw new AppError('File not found', 404)
  }
}

export async function deleteFile(container: string, key: string): Promise<void> {
  const filePath = safeJoin(container, key)
  try {
    await fsp.unlink(filePath)
  } catch {
    // already gone — no-op
  }
}

export function fileExists(container: string, key: string): boolean {
  try {
    return fs.existsSync(safeJoin(container, key))
  } catch {
    return false
  }
}

// ─── Signed URL (served via /api/files/:container/*key?sig=&exp=) ─────────
// Replaces Azure SAS URLs. Backend serves the file directly through Express.

function sign(container: string, key: string, exp: number): string {
  return crypto
    .createHmac('sha256', SIGNING_SECRET)
    .update(`${container}:${key}:${exp}`)
    .digest('hex')
}

export function verifySignature(container: string, key: string, exp: string, sig: string): boolean {
  if (!exp || !sig) return false
  const expNum = Number(exp)
  if (Number.isNaN(expNum) || Date.now() > expNum) return false
  const expected = sign(container, key, expNum)
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig))
}

export function getFileUrl(container: string, key: string, yearsValid = 3): string {
  const base = process.env.BACKEND_URL || 'http://localhost:5000'
  const exp = Date.now() + yearsValid * 365 * 24 * 60 * 60 * 1000
  const sig = sign(container, key, exp)
  const encodedKey = key.split('/').map(encodeURIComponent).join('/')
  return `${base}/api/files/${container}/${encodedKey}?exp=${exp}&sig=${sig}`
}

export function mimeFromName(name: string): string {
  const n = name.toLowerCase()
  if (n.endsWith('.pdf')) return 'application/pdf'
  if (n.endsWith('.png')) return 'image/png'
  if (n.endsWith('.webp')) return 'image/webp'
  if (n.endsWith('.heic') || n.endsWith('.heif')) return 'image/heic'
  if (n.endsWith('.jpg') || n.endsWith('.jpeg')) return 'image/jpeg'
  return 'application/octet-stream'
}
