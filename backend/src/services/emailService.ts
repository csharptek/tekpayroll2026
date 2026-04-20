import { prisma } from '../utils/prisma'

async function getGraphConfig() {
  const keys = ['GRAPH_TENANT_ID', 'GRAPH_CLIENT_ID', 'GRAPH_CLIENT_SECRET', 'GRAPH_SENDER_EMAIL']
  const records = await prisma.systemConfig.findMany({ where: { key: { in: keys } } })
  const map = Object.fromEntries(records.map(r => [r.key, r.value]))
  return {
    tenantId:    map['GRAPH_TENANT_ID'],
    clientId:    map['GRAPH_CLIENT_ID'],
    clientSecret:map['GRAPH_CLIENT_SECRET'],
    senderEmail: map['GRAPH_SENDER_EMAIL'],
  }
}

async function getAccessToken(tenantId: string, clientId: string, clientSecret: string) {
  const url = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`
  const body = new URLSearchParams({
    grant_type:    'client_credentials',
    client_id:     clientId,
    client_secret: clientSecret,
    scope:         'https://graph.microsoft.com/.default',
  })
  const res = await fetch(url, { method: 'POST', body, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } })
  const data = await res.json() as any
  if (!data.access_token) throw new Error(`Graph token error: ${data.error_description || data.error}`)
  return data.access_token as string
}

export async function sendEmail(to: string, subject: string, htmlBody: string) {
  return sendEmailWithCc(to, [], subject, htmlBody)
}

export async function sendEmailWithCc(to: string | string[], cc: string[], subject: string, htmlBody: string) {
  try {
    const cfg = await getGraphConfig()
    if (!cfg.tenantId || !cfg.clientId || !cfg.clientSecret || !cfg.senderEmail) {
      console.warn('[EMAIL] Graph API not configured — skipping email')
      return
    }
    const toList = Array.isArray(to) ? to : [to]
    if (toList.length === 0) {
      console.warn('[EMAIL] No TO recipients — skipping')
      return
    }
    const token = await getAccessToken(cfg.tenantId, cfg.clientId, cfg.clientSecret)
    const payload: any = {
      message: {
        subject,
        body: { contentType: 'HTML', content: htmlBody },
        toRecipients: toList.map(e => ({ emailAddress: { address: e } })),
      },
      saveToSentItems: false,
    }
    if (cc.length > 0) {
      payload.message.ccRecipients = cc.map(e => ({ emailAddress: { address: e } }))
    }
    const res = await fetch(`https://graph.microsoft.com/v1.0/users/${cfg.senderEmail}/sendMail`, {
      method:  'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
    })
    if (!res.ok) {
      const err = await res.text()
      console.error('[EMAIL] Send failed:', err)
    }
  } catch (err) {
    console.error('[EMAIL] Error:', err)
  }
}

export function emailWrap(content: string) {
  return `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#f8fafc;padding:24px">
      <div style="background:#fff;border-radius:12px;padding:32px;border:1px solid #e2e8f0">
        <div style="margin-bottom:24px">
          <span style="font-size:20px;font-weight:700;color:#1e293b">TekPayroll</span>
        </div>
        ${content}
        <div style="margin-top:32px;padding-top:16px;border-top:1px solid #e2e8f0;font-size:12px;color:#94a3b8">
          This is an automated message. Please do not reply to this email.
        </div>
      </div>
    </div>`
}

export async function sendResignationSubmittedToHR(
  hrEmails: string[],
  employeeName: string,
  employeeCode: string,
  resignationDate: string,
  expectedLwd: string
) {
  const { getNotifConfig, renderTemplate } = await import('./notificationService')
  const cfg = await getNotifConfig('RESIGNATION_SUBMITTED')
  if (!cfg.enabled) return
  const vars = { employeeName, employeeCode, resignationDate, expectedLwd }
  const subject = cfg.subject ? renderTemplate(cfg.subject, vars) : `Resignation Submitted — ${employeeName} (${employeeCode})`
  const html = emailWrap(`
    <h2 style="color:#dc2626;margin:0 0 16px">Resignation Notice</h2>
    <p style="color:#475569"><strong>${employeeName}</strong> (${employeeCode}) has submitted their resignation.</p>
    <table style="width:100%;border-collapse:collapse;margin:16px 0">
      <tr><td style="padding:8px 0;color:#64748b;width:160px">Resignation Date</td><td style="color:#1e293b;font-weight:600">${resignationDate}</td></tr>
      <tr><td style="padding:8px 0;color:#64748b">Expected Last Working Day</td><td style="color:#1e293b;font-weight:600">${expectedLwd}</td></tr>
    </table>
    <p style="color:#475569">Please log in to TekPayroll to review and manage the exit process.</p>`)
  const toList = Array.from(new Set([...cfg.to, ...hrEmails])).filter(Boolean)
  await sendEmailWithCc(toList, cfg.cc, subject, html)
}

export async function sendExitInitiatedToEmployee(
  employeeEmail: string,
  employeeName: string,
  exitType: string,
  initiatedByName: string,
  expectedLwd: string
) {
  const subject = `Your Exit Has Been Initiated — ${exitType}`
  const html = emailWrap(`
    <h2 style="color:#dc2626;margin:0 0 16px">Exit Notice</h2>
    <p style="color:#475569">Dear <strong>${employeeName}</strong>,</p>
    <p style="color:#475569">Your exit has been initiated by <strong>${initiatedByName}</strong>.</p>
    <table style="width:100%;border-collapse:collapse;margin:16px 0">
      <tr><td style="padding:8px 0;color:#64748b;width:160px">Exit Type</td><td style="color:#1e293b;font-weight:600">${exitType}</td></tr>
      <tr><td style="padding:8px 0;color:#64748b">Expected Last Working Day</td><td style="color:#1e293b;font-weight:600">${expectedLwd}</td></tr>
    </table>
    <p style="color:#475569">Please log in to TekPayroll for more details and to complete any required steps.</p>`)
  await sendEmail(employeeEmail, subject, html)
}

export async function sendWithdrawalEnabledToEmployee(
  employeeEmail: string,
  employeeName: string
) {
  const subject = `Resignation Withdrawal Enabled`
  const html = emailWrap(`
    <h2 style="color:#0284c7;margin:0 0 16px">Withdrawal Option Available</h2>
    <p style="color:#475569">Dear <strong>${employeeName}</strong>,</p>
    <p style="color:#475569">Your administrator has enabled the option to withdraw your resignation. You can log in to TekPayroll and withdraw your resignation if you wish to continue employment.</p>`)
  await sendEmail(employeeEmail, subject, html)
}

export async function sendWithdrawalToHR(
  hrEmails: string[],
  employeeName: string,
  employeeCode: string
) {
  const { getNotifConfig, renderTemplate } = await import('./notificationService')
  const cfg = await getNotifConfig('RESIGNATION_WITHDRAWN')
  if (!cfg.enabled) return
  const vars = { employeeName, employeeCode }
  const subject = cfg.subject ? renderTemplate(cfg.subject, vars) : `Resignation Withdrawn — ${employeeName} (${employeeCode})`
  const html = emailWrap(`
    <h2 style="color:#16a34a;margin:0 0 16px">Resignation Withdrawn</h2>
    <p style="color:#475569"><strong>${employeeName}</strong> (${employeeCode}) has withdrawn their resignation. Their status has been restored to Active.</p>`)
  const toList = Array.from(new Set([...cfg.to, ...hrEmails])).filter(Boolean)
  await sendEmailWithCc(toList, cfg.cc, subject, html)
}

export async function sendLwdReminderToHR(
  hrEmails: string[],
  employeeName: string,
  employeeCode: string,
  lwd: string,
  daysRemaining: number
) {
  const { getNotifConfig, renderTemplate } = await import('./notificationService')
  const cfg = await getNotifConfig('LWD_REMINDER')
  if (!cfg.enabled) return
  const vars = { employeeName, employeeCode, lwd, daysRemaining: String(daysRemaining) }
  const subject = cfg.subject ? renderTemplate(cfg.subject, vars) : `LWD Reminder — ${employeeName} (${employeeCode}) — ${daysRemaining} days`
  const html = emailWrap(`
    <h2 style="color:#d97706;margin:0 0 16px">Last Working Day Reminder</h2>
    <p style="color:#475569"><strong>${employeeName}</strong> (${employeeCode}) has <strong>${daysRemaining} day(s)</strong> remaining before their last working day on <strong>${lwd}</strong>.</p>
    <p style="color:#475569">Please ensure all clearances and F&F processes are completed in time.</p>`)
  const toList = Array.from(new Set([...cfg.to, ...hrEmails])).filter(Boolean)
  await sendEmailWithCc(toList, cfg.cc, subject, html)
}

export async function sendAllClearanceDoneToSuperAdmin(
  adminEmails: string[],
  employeeName: string,
  employeeCode: string
) {
  const { getNotifConfig, renderTemplate } = await import('./notificationService')
  const cfg = await getNotifConfig('ALL_CLEARANCE_DONE')
  if (!cfg.enabled) return
  const vars = { employeeName, employeeCode }
  const subject = cfg.subject ? renderTemplate(cfg.subject, vars) : `All Clearances Complete — ${employeeName} (${employeeCode})`
  const html = emailWrap(`
    <h2 style="color:#16a34a;margin:0 0 16px">Clearance Complete</h2>
    <p style="color:#475569">All clearances for <strong>${employeeName}</strong> (${employeeCode}) have been marked as complete. You can now unlock F&F and proceed with final separation.</p>`)
  const toList = Array.from(new Set([...cfg.to, ...adminEmails])).filter(Boolean)
  await sendEmailWithCc(toList, cfg.cc, subject, html)
}

export async function sendSeparatedToEmployee(
  employeeEmail: string,
  employeeName: string,
  lwd: string
) {
  const subject = `Employment Separation Confirmed`
  const html = emailWrap(`
    <h2 style="color:#1e293b;margin:0 0 16px">Separation Confirmed</h2>
    <p style="color:#475569">Dear <strong>${employeeName}</strong>,</p>
    <p style="color:#475569">Your employment has been formally separated effective <strong>${lwd}</strong>. Thank you for your time with us.</p>
    <p style="color:#475569">For any queries regarding your final settlement, please contact HR.</p>`)
  await sendEmail(employeeEmail, subject, html)
}
