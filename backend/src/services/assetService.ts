import { prisma } from '../utils/prisma'
import { sendEmail } from './emailService'

export async function sendAssetAssignedEmail(
  employeeEmail: string,
  employeeName: string,
  assetName: string,
  assetCode: string,
  category: string,
  assignedDate: Date
) {
  const subject = `Asset Assigned: ${assetName} (${assetCode})`
  const html = `
    <p>Dear ${employeeName},</p>
    <p>The following asset has been assigned to you:</p>
    <table cellpadding="8" style="border-collapse:collapse;">
      <tr><td><strong>Asset Name</strong></td><td>${assetName}</td></tr>
      <tr><td><strong>Asset Code</strong></td><td>${assetCode}</td></tr>
      <tr><td><strong>Category</strong></td><td>${category}</td></tr>
      <tr><td><strong>Assigned Date</strong></td><td>${assignedDate.toDateString()}</td></tr>
    </table>
    <p>Please take care of this asset and report any damage immediately.</p>
    <p>Regards,<br/>HR Team</p>
  `
  await sendEmail(employeeEmail, subject, html)
}

export async function sendAssetReturnedEmail(
  employeeEmail: string,
  employeeName: string,
  assetName: string,
  assetCode: string
) {
  const subject = `Asset Return Confirmed: ${assetName} (${assetCode})`
  const html = `
    <p>Dear ${employeeName},</p>
    <p>Your return of <strong>${assetName}</strong> (${assetCode}) has been recorded. Thank you.</p>
    <p>Regards,<br/>HR Team</p>
  `
  await sendEmail(employeeEmail, subject, html)
}

export async function sendAssetRequestStatusEmail(
  employeeEmail: string,
  employeeName: string,
  requestType: string,
  status: string,
  notes?: string | null
) {
  const subject = `Asset Request ${status}: ${requestType}`
  const html = `
    <p>Dear ${employeeName},</p>
    <p>Your asset <strong>${requestType.toLowerCase()}</strong> request has been <strong>${status.toLowerCase()}</strong>.</p>
    ${notes ? `<p><strong>Notes:</strong> ${notes}</p>` : ''}
    <p>Regards,<br/>HR Team</p>
  `
  await sendEmail(employeeEmail, subject, html)
}

export async function getEmployeePendingAssets(employeeId: string) {
  return prisma.assetAssignment.findMany({
    where: { employeeId, isActive: true },
    include: { asset: { include: { category: true } } },
  })
}
