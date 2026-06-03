import { BlobServiceClient, BlobSASPermissions, generateBlobSASQueryParameters, StorageSharedKeyCredential } from '@azure/storage-blob'
import { AppError } from '../middleware/errorHandler'

// Container env: AZURE_PAYSLIP_CONTAINER (default: payslips)

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

export function getPayslipContainerName(): string {
  return process.env.AZURE_PAYSLIP_CONTAINER || 'payslips'
}

export function payslipSasUrl(blobKey: string): string {
  const containerName = getPayslipContainerName()
  const { accountName, credential } = getSharedKeyCredential()
  const expiresOn = new Date()
  expiresOn.setFullYear(expiresOn.getFullYear() + 3)
  const sas = generateBlobSASQueryParameters(
    {
      containerName,
      blobName:    blobKey,
      permissions: BlobSASPermissions.parse('r'),
      expiresOn,
      protocol:    undefined as any,
    },
    credential,
  ).toString()
  // Encode '#' from employee codes (C#TEK183) so it isn't treated as a URL fragment
  const encodedKey = blobKey.split('/').map(encodeURIComponent).join('/')
  return `https://${accountName}.blob.core.windows.net/${containerName}/${encodedKey}?${sas}`
}

export async function uploadPayslipPdf(buffer: Buffer, blobKey: string): Promise<string> {
  const connStr       = getConnStr()
  const containerName = getPayslipContainerName()
  const client        = BlobServiceClient.fromConnectionString(connStr)
  const container      = client.getContainerClient(containerName)
  await container.createIfNotExists()

  const blob = container.getBlockBlobClient(blobKey)
  await blob.uploadData(buffer, { blobHTTPHeaders: { blobContentType: 'application/pdf' } })
  return payslipSasUrl(blobKey)
}

export async function downloadPayslipPdf(blobKey: string): Promise<Buffer> {
  const connStr       = getConnStr()
  const containerName = getPayslipContainerName()
  const client        = BlobServiceClient.fromConnectionString(connStr)
  const container      = client.getContainerClient(containerName)
  const blob           = container.getBlobClient(blobKey)
  const download       = await blob.download()
  const chunks: Buffer[] = []
  for await (const chunk of download.readableStreamBody as any) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks)
}

export async function deletePayslipPdf(blobKey: string): Promise<void> {
  const connStr       = getConnStr()
  const containerName = getPayslipContainerName()
  const client        = BlobServiceClient.fromConnectionString(connStr)
  const container      = client.getContainerClient(containerName)
  await container.getBlockBlobClient(blobKey).deleteIfExists()
}
