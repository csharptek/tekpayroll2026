import { randomUUID } from 'crypto'
import path from 'path'
import { saveFile, deleteFile, getFileUrl, mimeFromName } from './fileStorage'

const CONTAINER = 'emp-reimbursements'

export async function uploadReimbursementFile(
  buffer: Buffer,
  originalName: string,
  employeeCode: string,
  employeeName: string,
): Promise<{ url: string; key: string; mimeType: string; sizeBytes: number }> {
  const safe = `${employeeCode}-${employeeName}`.replace(/[^a-zA-Z0-9-]/g, '-').toLowerCase()
  const ext  = path.extname(originalName) || '.jpg'
  const key  = `${safe}/${new Date().getFullYear()}/${randomUUID()}${ext}`
  const mimeType = mimeFromName(originalName)

  await saveFile(CONTAINER, key, buffer)
  return { url: getFileUrl(CONTAINER, key), key, mimeType, sizeBytes: buffer.length }
}

export async function deleteReimbursementFile(key: string): Promise<void> {
  await deleteFile(CONTAINER, key)
}

export function refreshReimbursementSasUrl(key: string): string {
  return getFileUrl(CONTAINER, key)
}
