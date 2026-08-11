import { saveFile, readFile, deleteFile, getFileUrl } from './fileStorage'

const CONTAINER = 'payslips'

export function getPayslipContainerName(): string {
  return CONTAINER
}

export function payslipSasUrl(blobKey: string): string {
  return getFileUrl(CONTAINER, blobKey)
}

export async function uploadPayslipPdf(buffer: Buffer, blobKey: string): Promise<string> {
  await saveFile(CONTAINER, blobKey, buffer)
  return payslipSasUrl(blobKey)
}

export async function downloadPayslipPdf(blobKey: string): Promise<Buffer> {
  return readFile(CONTAINER, blobKey)
}

export async function deletePayslipPdf(blobKey: string): Promise<void> {
  await deleteFile(CONTAINER, blobKey)
}
