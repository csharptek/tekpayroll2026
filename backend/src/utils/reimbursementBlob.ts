import { BlobServiceClient, BlobSASPermissions, generateBlobSASQueryParameters, StorageSharedKeyCredential } from '@azure/storage-blob'
import { randomUUID } from 'crypto'
import path from 'path'
import { AppError } from '../middleware/errorHandler'

// Container env: AZURE_REIMB_CONTAINER (default: emp-reimbursements)

function getConnStr(): string {
  const connStr = process.env.AZURE_STORAGE_CONNECTION_STRING
  if (!connStr || connStr === 'PLACEHOLDER') throw new AppError('Azure storage not configured', 500)
  return connStr
}

function getSharedKeyCredential(): { accountName: string; credential: StorageSharedKeyCredential } {
  const connStr = getConnStr()
  const nameM = connStr.match(/AccountName=([^;]+)/)
  const keyM  = connStr.match(/AccountKey=([^;]+)/)
  if (!nameM || !keyM) throw new AppError('Invalid Azure connection string', 500)
  return { accountName: nameM[1], credential: new StorageSharedKeyCredential(nameM[1], keyM[1]) }
}

function getContainerName(): string {
  return process.env.AZURE_REIMB_CONTAINER || 'emp-reimbursements'
}

function sasUrl(containerName: string, blobKey: string): string {
  const { accountName, credential } = getSharedKeyCredential()
  const expiresOn = new Date()
  expiresOn.setFullYear(expiresOn.getFullYear() + 3)
  const sas = generateBlobSASQueryParameters(
    {
      containerName,
      blobName:   blobKey,
      permissions: BlobSASPermissions.parse('r'),
      expiresOn,
      protocol:   undefined as any,
    },
    credential,
  ).toString()
  return `https://${accountName}.blob.core.windows.net/${containerName}/${blobKey}?${sas}`
}

function mimeFromName(name: string): string {
  const n = name.toLowerCase()
  if (n.endsWith('.pdf'))  return 'application/pdf'
  if (n.endsWith('.png'))  return 'image/png'
  if (n.endsWith('.webp')) return 'image/webp'
  if (n.endsWith('.heic') || n.endsWith('.heif')) return 'image/heic'
  return 'image/jpeg'
}

export async function uploadReimbursementFile(
  buffer: Buffer,
  originalName: string,
  employeeCode: string,
  employeeName: string,
): Promise<{ url: string; key: string; mimeType: string; sizeBytes: number }> {
  const connStr       = getConnStr()
  const containerName = getContainerName()
  const client        = BlobServiceClient.fromConnectionString(connStr)
  const container     = client.getContainerClient(containerName)
  await container.createIfNotExists()

  const safe = `${employeeCode}-${employeeName}`.replace(/[^a-zA-Z0-9-]/g, '-').toLowerCase()
  const ext  = path.extname(originalName) || '.jpg'
  const key  = `${safe}/${new Date().getFullYear()}/${randomUUID()}${ext}`
  const blob = container.getBlockBlobClient(key)
  const mimeType = mimeFromName(originalName)

  await blob.uploadData(buffer, { blobHTTPHeaders: { blobContentType: mimeType } })
  return { url: sasUrl(containerName, key), key, mimeType, sizeBytes: buffer.length }
}

export async function deleteReimbursementFile(key: string): Promise<void> {
  const connStr       = getConnStr()
  const containerName = getContainerName()
  const client        = BlobServiceClient.fromConnectionString(connStr)
  const container     = client.getContainerClient(containerName)
  await container.getBlockBlobClient(key).deleteIfExists()
}

export function refreshReimbursementSasUrl(key: string): string {
  return sasUrl(getContainerName(), key)
}
