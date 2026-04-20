import { prisma } from '../utils/prisma'
import { sendEmailWithCc, emailWrap } from './emailService'
import { getNotifConfig, renderTemplate } from './notificationService'

function fmtDate(d: Date) {
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' })
}
function fmtDateTime(d: Date) {
  return d.toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: true,
    timeZone: 'Asia/Kolkata',
  })
}

const LEAVE_KIND_LABEL: Record<string, string> = {
  SICK:    'Sick Leave',
  CASUAL:  'Casual Leave',
  PLANNED: 'Planned Leave',
}

const HALF_LABEL: Record<string, string> = {
  FIRST_HALF:  'First Half',
  SECOND_HALF: 'Second Half',
}

export async function sendLeaveAppliedEmail(applicationId: string) {
  const app = await prisma.lvApplication.findUnique({
    where: { id: applicationId },
    include: {
      employee: {
        include: {
          employmentDetail: true,
        },
      },
    },
  })
  if (!app || !app.employee) return

  const cfg = await getNotifConfig('LEAVE_APPLIED')
  if (!cfg.enabled) return

  const emp = app.employee as any
  // Reporting manager CC
  const ccList = [...cfg.cc]
  const managerId = emp.employmentDetail?.reportingManagerId as string | undefined
  if (managerId) {
    const mgr = await prisma.employee.findUnique({ where: { id: managerId } })
    if (mgr?.email) ccList.push(mgr.email)
  }

  const leaveTypeStr = app.isHalfDay
    ? `Half Day (${HALF_LABEL[app.halfDaySlot || ''] || app.halfDaySlot || ''})`
    : 'Full Day'
  const category = LEAVE_KIND_LABEL[app.leaveKind] || app.leaveKind

  const vars: Record<string, string> = {
    employeeId:     emp.employeeCode,
    fullName:       emp.name,
    fromDate:       fmtDate(app.startDate),
    toDate:         fmtDate(app.endDate),
    leaveType:      leaveTypeStr,
    leaveReason:    app.reasonLabel,
    description:    app.customReason || '',
    appliedDateTime: fmtDateTime(app.createdAt),
    leaveCategory:  category,
  }

  const subject = cfg.subject
    ? renderTemplate(cfg.subject, vars)
    : `Leave Application — ${emp.name} (${emp.employeeCode})`

  const html = emailWrap(`
    <h2 style="color:#0f172a;margin:0 0 6px;font-size:17px">Leave Application</h2>
    <p style="color:#475569;margin:0 0 12px;font-size:13px"><strong>${emp.name}</strong> has applied for leave.</p>
    <table style="width:100%;border-collapse:collapse;font-size:13px">
      <tr><td style="padding:4px 0;color:#64748b;width:150px">Employee ID</td><td style="color:#0f172a;font-weight:600">${vars.employeeId}</td></tr>
      <tr><td style="padding:4px 0;color:#64748b">Full Name</td><td style="color:#0f172a;font-weight:600">${vars.fullName}</td></tr>
      <tr><td style="padding:4px 0;color:#64748b">From</td><td style="color:#0f172a;font-weight:600">${vars.fromDate}</td></tr>
      <tr><td style="padding:4px 0;color:#64748b">To</td><td style="color:#0f172a;font-weight:600">${vars.toDate}</td></tr>
      <tr><td style="padding:4px 0;color:#64748b">Leave Type</td><td style="color:#0f172a;font-weight:600">${vars.leaveType}</td></tr>
      <tr><td style="padding:4px 0;color:#64748b">Reason</td><td style="color:#0f172a;font-weight:600">${vars.leaveReason}</td></tr>
      ${vars.description ? `<tr><td style="padding:4px 0;color:#64748b;vertical-align:top">Description</td><td style="color:#0f172a">${vars.description}</td></tr>` : ''}
      <tr><td style="padding:4px 0;color:#64748b">Applied On</td><td style="color:#0f172a;font-weight:600">${vars.appliedDateTime} IST</td></tr>
      <tr><td style="padding:4px 0;color:#64748b">Category</td><td style="color:#0f172a;font-weight:600">${vars.leaveCategory}</td></tr>
    </table>
    <p style="color:#64748b;margin:14px 0 0;font-size:12px">Please log in to review this application.</p>`)

  await sendEmailWithCc(cfg.to, ccList, subject, html)
}
