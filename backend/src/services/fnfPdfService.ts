import { FnfCalculation } from './fnfService'
import { generateFnfStatementHTML } from './fnfPdfTemplate'
import { uploadPayslipPdf } from '../utils/payslipBlob'

// ─── PDF GENERATION ──────────────────────────────────────────────────────────
// Same Puppeteer pattern as payslipService — networkidle2, 15s timeout
// (networkidle0 times out on Azure Blob image URLs, per prior incident).

async function generatePDF(html: string): Promise<Buffer> {
  if (process.env.NODE_ENV === 'production' || process.env.PUPPETEER_ENABLED === 'true') {
    const puppeteer = await import('puppeteer')
    const browser = await puppeteer.default.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    })
    const page = await browser.newPage()
    await page.setContent(html, { waitUntil: 'networkidle2', timeout: 15000 })
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '10mm', bottom: '10mm', left: '10mm', right: '10mm' },
    })
    await browser.close()
    return Buffer.from(pdf)
  }
  console.log('[FNF PDF] Dev mode — PDF generation stubbed')
  return Buffer.from(html)
}

// ─── BLOB UPLOAD (reuses the payslips container — distinct key prefix) ───────

async function uploadFnfStatement(buffer: Buffer, blobKey: string): Promise<string> {
  const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING
  if (!connectionString || connectionString === 'PLACEHOLDER') {
    console.log(`[BLOB] Dev mode — would upload ${blobKey} to Azure Blob`)
    return `/dev-fnf-statements/${blobKey}`
  }
  const url = await uploadPayslipPdf(buffer, blobKey)
  console.log(`[BLOB] Uploaded: ${blobKey}`)
  return url
}

// ─── MAIN ENTRY ──────────────────────────────────────────────────────────────
// Generates the F&F settlement statement PDF and uploads it. Does NOT touch
// the FnfSettlement row — caller persists pdfUrl/pdfKey.

export async function generateFnfStatementPdf(
  calc: FnfCalculation,
  employee: { name: string; employeeCode: string; jobTitle?: string | null; department?: string | null }
): Promise<{ pdfUrl: string; pdfKey: string }> {
  const html   = generateFnfStatementHTML(calc, employee)
  const buffer = await generatePDF(html)

  // Employee codes can contain '#' (e.g. C#TEK183) — payslipSasUrl already
  // URL-encodes each path segment, so raw '#' in the key itself is fine.
  const stamp    = new Date(calc.resignationDate).toISOString().slice(0, 10)
  const filename = `FNF-${employee.employeeCode}-${stamp}.pdf`
  const blobKey  = `fnf-statements/${employee.employeeCode}/${filename}`

  const pdfUrl = await uploadFnfStatement(buffer, blobKey)
  return { pdfUrl, pdfKey: blobKey }
}
