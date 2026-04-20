import { prisma } from '../utils/prisma'
import { sendEmailWithCc, emailWrap } from './emailService'
import { getNotifConfig, renderTemplate, NotifType } from './notificationService'

function fmtDate(d: Date) {
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' })
}
function fmtDateTime(d: Date) {
  return d.toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: true,
    timeZone: 'Asia/Kolkata',
  }) + ' IST'
}
function fmtINR(n: number | string) {
  const v = typeof n === 'string' ? parseFloat(n) : n
  return '₹' + v.toLocaleString('en-IN', { maximumFractionDigits: 2 })
}

const LEAVE_KIND_LABEL: Record<string, string> = {
  SICK: 'Sick Leave', CASUAL: 'Casual Leave', PLANNED: 'Planned Leave',
}
const HALF_LABEL: Record<string, string> = {
  FIRST_HALF: 'First Half', SECOND_HALF: 'Second Half',
}

/**
 * Generic send wrapper: applies notification config (enabled, TO, CC, subject).
 * Pass explicit recipient(s) via `directTo` when the notification target is
 * known (e.g. the employee themselves) — the config TO list is added on top.
 */
async function sendNotif(opts: {
  type:         NotifType
  directTo?:    string | string[]
  directCc?:    string[]
  defaultSubject: string
  vars:         Record<string, string>
  body:         string
}) {
  const cfg = await getNotifConfig(opts.type)
  if (!cfg.enabled) return

  const toList = Array.from(new Set([
    ...(opts.directTo ? (Array.isArray(opts.directTo) ? opts.directTo : [opts.directTo]) : []),
    ...cfg.to,
  ])).filter(Boolean)

  const ccList = Array.from(new Set([
    ...(opts.directCc || []),
    ...cfg.cc,
  ])).filter(Boolean)

  if (toList.length === 0) return

  const subject = cfg.subject
    ? renderTemplate(cfg.subject, opts.vars)
    : renderTemplate(opts.defaultSubject, opts.vars)

  const html = emailWrap(opts.body)
  await sendEmailWithCc(toList, ccList, subject, html)
}

// ─── LEAVE LIFECYCLE ──────────────────────────────────────────────────────────

export async function sendLeaveApprovedEmail(applicationId: string) {
  const app = await prisma.lvApplication.findUnique({
    where: { id: applicationId },
    include: { employee: true },
  })
  if (!app?.employee) return
  const leaveType = app.isHalfDay
    ? `Half Day (${HALF_LABEL[app.halfDaySlot || ''] || ''})` : 'Full Day'
  const vars = {
    employeeName: app.employee.name,
    employeeCode: app.employee.employeeCode,
    fromDate: fmtDate(app.startDate),
    toDate:   fmtDate(app.endDate),
    totalDays: String(app.totalDays),
    leaveType,
    category: LEAVE_KIND_LABEL[app.leaveKind] || app.leaveKind,
    approvedBy: app.approvedByName || '',
    approvedOn: app.approvedAt ? fmtDateTime(app.approvedAt) : '',
  }
  const body = `
    <h2 style="color:#0f172a;margin:0 0 6px;font-size:17px">Leave Approved</h2>
    <p style="color:#475569;margin:0 0 12px;font-size:13px">Your leave application has been approved.</p>
    <table style="width:100%;border-collapse:collapse;font-size:13px">
      <tr><td style="padding:4px 0;color:#64748b;width:150px">Leave Category</td><td style="color:#0f172a;font-weight:600">${vars.category}</td></tr>
      <tr><td style="padding:4px 0;color:#64748b">From</td><td style="color:#0f172a;font-weight:600">${vars.fromDate}</td></tr>
      <tr><td style="padding:4px 0;color:#64748b">To</td><td style="color:#0f172a;font-weight:600">${vars.toDate}</td></tr>
      <tr><td style="padding:4px 0;color:#64748b">Total Days</td><td style="color:#0f172a;font-weight:600">${vars.totalDays}</td></tr>
      <tr><td style="padding:4px 0;color:#64748b">Leave Type</td><td style="color:#0f172a;font-weight:600">${vars.leaveType}</td></tr>
      <tr><td style="padding:4px 0;color:#64748b">Approved By</td><td style="color:#0f172a;font-weight:600">${vars.approvedBy}</td></tr>
      <tr><td style="padding:4px 0;color:#64748b">Approved On</td><td style="color:#0f172a;font-weight:600">${vars.approvedOn}</td></tr>
    </table>
    <p style="color:#64748b;margin:14px 0 0;font-size:12px">Please plan your handover before the leave starts.</p>`
  await sendNotif({
    type: 'LEAVE_APPROVED',
    directTo: app.employee.email,
    defaultSubject: 'Leave Approved — {fromDate} to {toDate}',
    vars, body,
  })
}

export async function sendLeaveDeclinedEmail(applicationId: string) {
  const app = await prisma.lvApplication.findUnique({
    where: { id: applicationId },
    include: { employee: true },
  })
  if (!app?.employee) return
  const vars = {
    employeeName: app.employee.name,
    fromDate: fmtDate(app.startDate),
    toDate:   fmtDate(app.endDate),
    category: LEAVE_KIND_LABEL[app.leaveKind] || app.leaveKind,
    declineReason: app.declineReason || '',
    declinedBy: app.approvedByName || '',
    declinedOn: app.approvedAt ? fmtDateTime(app.approvedAt) : '',
  }
  const body = `
    <h2 style="color:#0f172a;margin:0 0 6px;font-size:17px">Leave Declined</h2>
    <p style="color:#475569;margin:0 0 12px;font-size:13px">Your leave application has been declined.</p>
    <table style="width:100%;border-collapse:collapse;font-size:13px">
      <tr><td style="padding:4px 0;color:#64748b;width:150px">Leave Category</td><td style="color:#0f172a;font-weight:600">${vars.category}</td></tr>
      <tr><td style="padding:4px 0;color:#64748b">From</td><td style="color:#0f172a;font-weight:600">${vars.fromDate}</td></tr>
      <tr><td style="padding:4px 0;color:#64748b">To</td><td style="color:#0f172a;font-weight:600">${vars.toDate}</td></tr>
      <tr><td style="padding:4px 0;color:#64748b;vertical-align:top">Reason</td><td style="color:#0f172a">${vars.declineReason}</td></tr>
      <tr><td style="padding:4px 0;color:#64748b">Declined By</td><td style="color:#0f172a;font-weight:600">${vars.declinedBy}</td></tr>
      <tr><td style="padding:4px 0;color:#64748b">Declined On</td><td style="color:#0f172a;font-weight:600">${vars.declinedOn}</td></tr>
    </table>
    <p style="color:#64748b;margin:14px 0 0;font-size:12px">Contact HR if you have questions.</p>`
  await sendNotif({
    type: 'LEAVE_DECLINED',
    directTo: app.employee.email,
    defaultSubject: 'Leave Declined — {fromDate} to {toDate}',
    vars, body,
  })
}

export async function sendLeaveAutoApprovedEmail(applicationId: string) {
  const app = await prisma.lvApplication.findUnique({
    where: { id: applicationId },
    include: { employee: true },
  })
  if (!app?.employee) return
  const vars = {
    employeeName: app.employee.name,
    fromDate: fmtDate(app.startDate),
    toDate:   fmtDate(app.endDate),
    totalDays: String(app.totalDays),
    lopDays: String(app.lopDays),
    appliedOn: fmtDateTime(app.createdAt),
  }
  const body = `
    <h2 style="color:#0f172a;margin:0 0 6px;font-size:17px">Sick Leave Confirmed</h2>
    <p style="color:#475569;margin:0 0 12px;font-size:13px">Your sick leave has been automatically approved.</p>
    <table style="width:100%;border-collapse:collapse;font-size:13px">
      <tr><td style="padding:4px 0;color:#64748b;width:150px">From</td><td style="color:#0f172a;font-weight:600">${vars.fromDate}</td></tr>
      <tr><td style="padding:4px 0;color:#64748b">To</td><td style="color:#0f172a;font-weight:600">${vars.toDate}</td></tr>
      <tr><td style="padding:4px 0;color:#64748b">Total Days</td><td style="color:#0f172a;font-weight:600">${vars.totalDays}</td></tr>
      ${Number(vars.lopDays) > 0 ? `<tr><td style="padding:4px 0;color:#64748b">LOP Days</td><td style="color:#dc2626;font-weight:600">${vars.lopDays}</td></tr>` : ''}
      <tr><td style="padding:4px 0;color:#64748b">Applied On</td><td style="color:#0f172a;font-weight:600">${vars.appliedOn}</td></tr>
    </table>
    <p style="color:#64748b;margin:14px 0 0;font-size:12px">Submit medical certificate if required.</p>`
  await sendNotif({
    type: 'LEAVE_AUTO_APPROVED',
    directTo: app.employee.email,
    defaultSubject: 'Sick Leave Confirmed — {fromDate} to {toDate}',
    vars, body,
  })
}

export async function sendLeaveCancelledByEmpEmail(applicationId: string, cancellationReason: string) {
  const app = await prisma.lvApplication.findUnique({
    where: { id: applicationId },
    include: { employee: { include: { employmentDetail: true } } },
  })
  if (!app?.employee) return
  const emp = app.employee as any
  const ccList: string[] = []
  const mgrId = emp.employmentDetail?.reportingManagerId
  if (mgrId) {
    const mgr = await prisma.employee.findUnique({ where: { id: mgrId } })
    if (mgr?.email) ccList.push(mgr.email)
  }
  const vars = {
    employeeName: emp.name,
    employeeCode: emp.employeeCode,
    category: LEAVE_KIND_LABEL[app.leaveKind] || app.leaveKind,
    fromDate: fmtDate(app.startDate),
    toDate:   fmtDate(app.endDate),
    reason: cancellationReason,
    cancelledOn: fmtDateTime(new Date()),
  }
  const body = `
    <h2 style="color:#0f172a;margin:0 0 6px;font-size:17px">Leave Cancelled</h2>
    <p style="color:#475569;margin:0 0 12px;font-size:13px"><strong>${vars.employeeName}</strong> has cancelled their leave.</p>
    <table style="width:100%;border-collapse:collapse;font-size:13px">
      <tr><td style="padding:4px 0;color:#64748b;width:150px">Employee ID</td><td style="color:#0f172a;font-weight:600">${vars.employeeCode}</td></tr>
      <tr><td style="padding:4px 0;color:#64748b">Category</td><td style="color:#0f172a;font-weight:600">${vars.category}</td></tr>
      <tr><td style="padding:4px 0;color:#64748b">From</td><td style="color:#0f172a;font-weight:600">${vars.fromDate}</td></tr>
      <tr><td style="padding:4px 0;color:#64748b">To</td><td style="color:#0f172a;font-weight:600">${vars.toDate}</td></tr>
      <tr><td style="padding:4px 0;color:#64748b;vertical-align:top">Reason</td><td style="color:#0f172a">${vars.reason}</td></tr>
      <tr><td style="padding:4px 0;color:#64748b">Cancelled On</td><td style="color:#0f172a;font-weight:600">${vars.cancelledOn}</td></tr>
    </table>`
  await sendNotif({
    type: 'LEAVE_CANCELLED_BY_EMP',
    directCc: ccList,
    defaultSubject: 'Leave Cancelled — {employeeName} ({employeeCode})',
    vars, body,
  })
}

export async function sendLeaveCancellationRequestEmail(applicationId: string, reason: string) {
  const app = await prisma.lvApplication.findUnique({
    where: { id: applicationId },
    include: { employee: true },
  })
  if (!app?.employee) return
  const vars = {
    employeeName: app.employee.name,
    employeeCode: app.employee.employeeCode,
    category: LEAVE_KIND_LABEL[app.leaveKind] || app.leaveKind,
    fromDate: fmtDate(app.startDate),
    toDate:   fmtDate(app.endDate),
    reason,
    requestedOn: fmtDateTime(new Date()),
  }
  const body = `
    <h2 style="color:#0f172a;margin:0 0 6px;font-size:17px">Leave Cancellation Request</h2>
    <p style="color:#475569;margin:0 0 12px;font-size:13px"><strong>${vars.employeeName}</strong> has requested to cancel an already-approved leave. Action required.</p>
    <table style="width:100%;border-collapse:collapse;font-size:13px">
      <tr><td style="padding:4px 0;color:#64748b;width:150px">Employee ID</td><td style="color:#0f172a;font-weight:600">${vars.employeeCode}</td></tr>
      <tr><td style="padding:4px 0;color:#64748b">Category</td><td style="color:#0f172a;font-weight:600">${vars.category}</td></tr>
      <tr><td style="padding:4px 0;color:#64748b">From</td><td style="color:#0f172a;font-weight:600">${vars.fromDate}</td></tr>
      <tr><td style="padding:4px 0;color:#64748b">To</td><td style="color:#0f172a;font-weight:600">${vars.toDate}</td></tr>
      <tr><td style="padding:4px 0;color:#64748b;vertical-align:top">Reason</td><td style="color:#0f172a">${vars.reason}</td></tr>
      <tr><td style="padding:4px 0;color:#64748b">Requested On</td><td style="color:#0f172a;font-weight:600">${vars.requestedOn}</td></tr>
    </table>`
  await sendNotif({
    type: 'LEAVE_CANCELLATION_REQUEST',
    defaultSubject: 'Leave Cancellation Request — {employeeName}',
    vars, body,
  })
}

export async function sendLeaveCancellationApprovedEmail(applicationId: string, approvedByName: string) {
  const app = await prisma.lvApplication.findUnique({
    where: { id: applicationId },
    include: { employee: true },
  })
  if (!app?.employee) return
  const vars = {
    employeeName: app.employee.name,
    fromDate: fmtDate(app.startDate),
    toDate:   fmtDate(app.endDate),
    approvedBy: approvedByName,
    approvedOn: fmtDateTime(new Date()),
  }
  const body = `
    <h2 style="color:#0f172a;margin:0 0 6px;font-size:17px">Cancellation Approved</h2>
    <p style="color:#475569;margin:0 0 12px;font-size:13px">Your leave cancellation request has been approved. Leave days have been restored to your balance.</p>
    <table style="width:100%;border-collapse:collapse;font-size:13px">
      <tr><td style="padding:4px 0;color:#64748b;width:150px">From</td><td style="color:#0f172a;font-weight:600">${vars.fromDate}</td></tr>
      <tr><td style="padding:4px 0;color:#64748b">To</td><td style="color:#0f172a;font-weight:600">${vars.toDate}</td></tr>
      <tr><td style="padding:4px 0;color:#64748b">Approved By</td><td style="color:#0f172a;font-weight:600">${vars.approvedBy}</td></tr>
      <tr><td style="padding:4px 0;color:#64748b">Approved On</td><td style="color:#0f172a;font-weight:600">${vars.approvedOn}</td></tr>
    </table>`
  await sendNotif({
    type: 'LEAVE_CANCELLATION_APPROVED',
    directTo: app.employee.email,
    defaultSubject: 'Leave Cancellation Approved',
    vars, body,
  })
}

export async function sendLeaveCancellationDeclinedEmail(applicationId: string, declinedByName: string, reason: string) {
  const app = await prisma.lvApplication.findUnique({
    where: { id: applicationId },
    include: { employee: true },
  })
  if (!app?.employee) return
  const vars = {
    employeeName: app.employee.name,
    fromDate: fmtDate(app.startDate),
    toDate:   fmtDate(app.endDate),
    declinedBy: declinedByName,
    reason,
    declinedOn: fmtDateTime(new Date()),
  }
  const body = `
    <h2 style="color:#0f172a;margin:0 0 6px;font-size:17px">Cancellation Declined</h2>
    <p style="color:#475569;margin:0 0 12px;font-size:13px">Your leave cancellation request has been declined. Your original leave remains active.</p>
    <table style="width:100%;border-collapse:collapse;font-size:13px">
      <tr><td style="padding:4px 0;color:#64748b;width:150px">From</td><td style="color:#0f172a;font-weight:600">${vars.fromDate}</td></tr>
      <tr><td style="padding:4px 0;color:#64748b">To</td><td style="color:#0f172a;font-weight:600">${vars.toDate}</td></tr>
      <tr><td style="padding:4px 0;color:#64748b;vertical-align:top">Reason</td><td style="color:#0f172a">${vars.reason}</td></tr>
      <tr><td style="padding:4px 0;color:#64748b">Declined By</td><td style="color:#0f172a;font-weight:600">${vars.declinedBy}</td></tr>
      <tr><td style="padding:4px 0;color:#64748b">Declined On</td><td style="color:#0f172a;font-weight:600">${vars.declinedOn}</td></tr>
    </table>`
  await sendNotif({
    type: 'LEAVE_CANCELLATION_DECLINED',
    directTo: app.employee.email,
    defaultSubject: 'Leave Cancellation Declined',
    vars, body,
  })
}

// ─── RESIGNATION / EXIT ───────────────────────────────────────────────────────

export async function sendResignationAcknowledgedEmail(employeeId: string) {
  const emp = await prisma.employee.findUnique({ where: { id: employeeId } })
  if (!emp?.email) return
  const vars = {
    employeeName: emp.name,
    resignationDate: emp.resignationSubmittedAt ? fmtDate(emp.resignationSubmittedAt) : fmtDate(new Date()),
    expectedLwd: emp.expectedLwd ? fmtDate(emp.expectedLwd) : '',
    noticeDays: String(emp.noticePeriodDays ?? ''),
  }
  const body = `
    <h2 style="color:#0f172a;margin:0 0 6px;font-size:17px">Resignation Received</h2>
    <p style="color:#475569;margin:0 0 12px;font-size:13px">Dear <strong>${vars.employeeName}</strong>, we confirm receipt of your resignation.</p>
    <table style="width:100%;border-collapse:collapse;font-size:13px">
      <tr><td style="padding:4px 0;color:#64748b;width:160px">Resignation Date</td><td style="color:#0f172a;font-weight:600">${vars.resignationDate}</td></tr>
      <tr><td style="padding:4px 0;color:#64748b">Expected LWD</td><td style="color:#0f172a;font-weight:600">${vars.expectedLwd}</td></tr>
      ${vars.noticeDays ? `<tr><td style="padding:4px 0;color:#64748b">Notice Period</td><td style="color:#0f172a;font-weight:600">${vars.noticeDays} days</td></tr>` : ''}
    </table>
    <p style="color:#64748b;margin:14px 0 0;font-size:12px">HR will reach out with next steps including the clearance process.</p>`
  await sendNotif({
    type: 'RESIGNATION_ACKNOWLEDGED',
    directTo: emp.email,
    defaultSubject: 'Resignation Received — Acknowledgement',
    vars, body,
  })
}

export async function sendResignationAcceptedEmail(employeeId: string) {
  const emp = await prisma.employee.findUnique({ where: { id: employeeId } })
  if (!emp?.email) return
  const vars = {
    employeeName: emp.name,
    lwd: emp.lastWorkingDay ? fmtDate(emp.lastWorkingDay) : (emp.expectedLwd ? fmtDate(emp.expectedLwd) : ''),
    noticeServed: emp.noticePeriodServed ? 'Yes' : 'No',
  }
  const body = `
    <h2 style="color:#0f172a;margin:0 0 6px;font-size:17px">Resignation Accepted</h2>
    <p style="color:#475569;margin:0 0 12px;font-size:13px">Dear <strong>${vars.employeeName}</strong>, your resignation has been formally accepted.</p>
    <table style="width:100%;border-collapse:collapse;font-size:13px">
      <tr><td style="padding:4px 0;color:#64748b;width:160px">Final LWD</td><td style="color:#0f172a;font-weight:600">${vars.lwd}</td></tr>
      <tr><td style="padding:4px 0;color:#64748b">Notice Period Served</td><td style="color:#0f172a;font-weight:600">${vars.noticeServed}</td></tr>
    </table>
    <p style="color:#64748b;margin:14px 0 0;font-size:12px">The clearance process will begin now. Please coordinate with HR for exit formalities.</p>`
  await sendNotif({
    type: 'RESIGNATION_ACCEPTED',
    directTo: emp.email,
    defaultSubject: 'Resignation Accepted — LWD Confirmed',
    vars, body,
  })
}

export async function sendWithdrawalApprovedEmail(employeeId: string) {
  const emp = await prisma.employee.findUnique({ where: { id: employeeId } })
  if (!emp?.email) return
  const vars = {
    employeeName: emp.name,
    withdrawnOn: emp.withdrawnAt ? fmtDateTime(emp.withdrawnAt) : fmtDateTime(new Date()),
  }
  const body = `
    <h2 style="color:#0f172a;margin:0 0 6px;font-size:17px">Resignation Withdrawal Confirmed</h2>
    <p style="color:#475569;margin:0 0 12px;font-size:13px">Dear <strong>${vars.employeeName}</strong>, your resignation has been successfully withdrawn. Your status has been restored to Active, effective immediately.</p>
    <table style="width:100%;border-collapse:collapse;font-size:13px">
      <tr><td style="padding:4px 0;color:#64748b;width:160px">Withdrawn On</td><td style="color:#0f172a;font-weight:600">${vars.withdrawnOn}</td></tr>
    </table>
    <p style="color:#64748b;margin:14px 0 0;font-size:12px">Welcome back.</p>`
  await sendNotif({
    type: 'WITHDRAWAL_APPROVED',
    directTo: emp.email,
    defaultSubject: 'Resignation Withdrawal Confirmed',
    vars, body,
  })
}

// ─── LOANS / REIMBURSEMENTS / ASSETS / F&F ────────────────────────────────────

export async function sendLoanCreatedEmail(loanId: string) {
  const loan = await prisma.loan.findUnique({
    where: { id: loanId },
    include: { employee: true },
  })
  if (!loan?.employee) return
  const vars = {
    employeeName: loan.employee.name,
    amount: fmtINR(Number(loan.principalAmount)),
    emi: fmtINR(Number(loan.emiAmount)),
    tenure: String(loan.tenureMonths),
    disbursedOn: loan.disbursedOn ? fmtDate(loan.disbursedOn) : '—',
    purpose: loan.purpose || '',
  }
  const body = `
    <h2 style="color:#0f172a;margin:0 0 6px;font-size:17px">Loan Approved</h2>
    <p style="color:#475569;margin:0 0 12px;font-size:13px">Dear <strong>${vars.employeeName}</strong>, your loan has been approved.</p>
    <table style="width:100%;border-collapse:collapse;font-size:13px">
      <tr><td style="padding:4px 0;color:#64748b;width:160px">Loan Amount</td><td style="color:#0f172a;font-weight:600">${vars.amount}</td></tr>
      <tr><td style="padding:4px 0;color:#64748b">EMI</td><td style="color:#0f172a;font-weight:600">${vars.emi}</td></tr>
      <tr><td style="padding:4px 0;color:#64748b">Tenure</td><td style="color:#0f172a;font-weight:600">${vars.tenure} months</td></tr>
      <tr><td style="padding:4px 0;color:#64748b">Disbursed On</td><td style="color:#0f172a;font-weight:600">${vars.disbursedOn}</td></tr>
      ${vars.purpose ? `<tr><td style="padding:4px 0;color:#64748b">Purpose</td><td style="color:#0f172a">${vars.purpose}</td></tr>` : ''}
    </table>
    <p style="color:#64748b;margin:14px 0 0;font-size:12px">First EMI deduction will appear in your next payroll cycle.</p>`
  await sendNotif({
    type: 'LOAN_CREATED',
    directTo: loan.employee.email,
    defaultSubject: 'Loan Approved — {amount}',
    vars, body,
  })
}

export async function sendReimbursementAddedEmail(reimbursementId: string) {
  const r = await prisma.reimbursement.findUnique({
    where: { id: reimbursementId },
    include: { employee: true, cycle: true },
  })
  if (!r?.employee) return
  const vars = {
    employeeName: r.employee.name,
    amount: fmtINR(Number(r.amount)),
    category: r.category,
    cycle: (r as any).cycle?.payrollMonth || '',
    addedOn: fmtDateTime(r.createdAt),
  }
  const body = `
    <h2 style="color:#0f172a;margin:0 0 6px;font-size:17px">Reimbursement Approved</h2>
    <p style="color:#475569;margin:0 0 12px;font-size:13px">Dear <strong>${vars.employeeName}</strong>, your reimbursement has been approved.</p>
    <table style="width:100%;border-collapse:collapse;font-size:13px">
      <tr><td style="padding:4px 0;color:#64748b;width:160px">Amount</td><td style="color:#0f172a;font-weight:600">${vars.amount}</td></tr>
      <tr><td style="padding:4px 0;color:#64748b">Category</td><td style="color:#0f172a;font-weight:600">${vars.category}</td></tr>
      ${vars.cycle ? `<tr><td style="padding:4px 0;color:#64748b">Payroll Cycle</td><td style="color:#0f172a;font-weight:600">${vars.cycle}</td></tr>` : ''}
      <tr><td style="padding:4px 0;color:#64748b">Added On</td><td style="color:#0f172a;font-weight:600">${vars.addedOn}</td></tr>
    </table>
    <p style="color:#64748b;margin:14px 0 0;font-size:12px">Amount will be credited with your next payroll.</p>`
  await sendNotif({
    type: 'REIMBURSEMENT_ADDED',
    directTo: r.employee.email,
    defaultSubject: 'Reimbursement Approved — {amount}',
    vars, body,
  })
}

export async function sendAssetAssignedNotif(
  employeeEmail: string,
  employeeName: string,
  assetName: string,
  assetCode: string,
  category: string,
  assignedDate: Date,
  condition?: string,
) {
  const vars = {
    employeeName, assetName, assetCode, category,
    assignedOn: fmtDate(assignedDate),
    condition: condition || 'GOOD',
  }
  const body = `
    <h2 style="color:#0f172a;margin:0 0 6px;font-size:17px">Asset Assigned</h2>
    <p style="color:#475569;margin:0 0 12px;font-size:13px">Dear <strong>${employeeName}</strong>, the following asset has been assigned to you.</p>
    <table style="width:100%;border-collapse:collapse;font-size:13px">
      <tr><td style="padding:4px 0;color:#64748b;width:160px">Asset Name</td><td style="color:#0f172a;font-weight:600">${vars.assetName}</td></tr>
      <tr><td style="padding:4px 0;color:#64748b">Asset Code</td><td style="color:#0f172a;font-weight:600">${vars.assetCode}</td></tr>
      <tr><td style="padding:4px 0;color:#64748b">Category</td><td style="color:#0f172a;font-weight:600">${vars.category}</td></tr>
      <tr><td style="padding:4px 0;color:#64748b">Condition</td><td style="color:#0f172a;font-weight:600">${vars.condition}</td></tr>
      <tr><td style="padding:4px 0;color:#64748b">Assigned On</td><td style="color:#0f172a;font-weight:600">${vars.assignedOn}</td></tr>
    </table>
    <p style="color:#64748b;margin:14px 0 0;font-size:12px">Please acknowledge receipt and report any issues within 48 hours.</p>`
  await sendNotif({
    type: 'ASSET_ASSIGNED',
    directTo: employeeEmail,
    defaultSubject: 'Asset Assigned — {assetName}',
    vars, body,
  })
}

export async function sendFnfReadyEmail(employeeId: string, fnfAmount: number | string, settlementDate: Date) {
  const emp = await prisma.employee.findUnique({ where: { id: employeeId } })
  if (!emp?.email) return
  const vars = {
    employeeName: emp.name,
    lwd: emp.lastWorkingDay ? fmtDate(emp.lastWorkingDay) : '',
    amount: fmtINR(Number(fnfAmount)),
    settlementDate: fmtDate(settlementDate),
  }
  const body = `
    <h2 style="color:#0f172a;margin:0 0 6px;font-size:17px">Full & Final Settlement Ready</h2>
    <p style="color:#475569;margin:0 0 12px;font-size:13px">Dear <strong>${vars.employeeName}</strong>, your full and final settlement has been calculated and is ready for review.</p>
    <table style="width:100%;border-collapse:collapse;font-size:13px">
      <tr><td style="padding:4px 0;color:#64748b;width:160px">Last Working Day</td><td style="color:#0f172a;font-weight:600">${vars.lwd}</td></tr>
      <tr><td style="padding:4px 0;color:#64748b">Final Amount</td><td style="color:#0f172a;font-weight:600">${vars.amount}</td></tr>
      <tr><td style="padding:4px 0;color:#64748b">Settlement Date</td><td style="color:#0f172a;font-weight:600">${vars.settlementDate}</td></tr>
    </table>
    <p style="color:#64748b;margin:14px 0 0;font-size:12px">Please log in to review and acknowledge the settlement to complete the process.</p>`
  await sendNotif({
    type: 'FNF_SETTLEMENT_READY',
    directTo: emp.email,
    defaultSubject: 'Full & Final Settlement Ready',
    vars, body,
  })
}
