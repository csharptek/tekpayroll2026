import { useState, useEffect } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuthStore } from '../../store/authStore'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Save, Bell, Mail, Send, CheckCircle2, XCircle } from 'lucide-react'
import { configApi } from '../../services/api'
import api from '../../services/api'
import { PageHeader, Button, Card, Alert, Input } from '../../components/ui'

type NotifType =
  | 'LEAVE_APPLIED'
  | 'RESIGNATION_SUBMITTED'
  | 'LWD_REMINDER'
  | 'ALL_CLEARANCE_DONE'
  | 'RESIGNATION_WITHDRAWN'
  | 'LEAVE_CANCELLED_BY_EMP'
  | 'LEAVE_CANCELLATION_REQUEST'
  | 'LEAVE_APPROVED'
  | 'LEAVE_DECLINED'
  | 'LEAVE_AUTO_APPROVED'
  | 'LEAVE_CANCELLATION_APPROVED'
  | 'LEAVE_CANCELLATION_DECLINED'
  | 'RESIGNATION_ACKNOWLEDGED'
  | 'RESIGNATION_ACCEPTED'
  | 'WITHDRAWAL_APPROVED'
  | 'LOAN_CREATED'
  | 'REIMBURSEMENT_ADDED'
  | 'ASSET_ASSIGNED'
  | 'FNF_SETTLEMENT_READY'

interface NotifDef {
  type:         NotifType
  title:        string
  audience:     'HR' | 'Employee'
  description:  string
  defaultSubject: string
  vars:         string[]
  extraNote?:   string
  bodyPreview:  string
}

const NOTIFS: NotifDef[] = [
  // ── HR / Admin notifications ─────────────────────────────────────────────
  {
    type: 'LEAVE_APPLIED',
    title: 'Leave Application Submitted',
    audience: 'HR',
    description: 'Sent to HR when an employee applies for leave.',
    defaultSubject: 'Leave Application — {fullName} ({employeeId})',
    vars: ['employeeId', 'fullName', 'fromDate', 'toDate', 'leaveType', 'leaveReason', 'description', 'appliedDateTime', 'leaveCategory'],
    extraNote: 'Reporting manager (if set) is auto-added to CC.',
    bodyPreview: 'Employee ID, Full Name, From, To, Leave Type (Full/Half), Reason, Description, Applied On, Category',
  },
  {
    type: 'LEAVE_CANCELLED_BY_EMP',
    title: 'Leave Cancelled by Employee',
    audience: 'HR',
    description: 'Sent to HR when an employee cancels their leave (before it starts).',
    defaultSubject: 'Leave Cancelled — {employeeName} ({employeeCode})',
    vars: ['employeeName', 'employeeCode', 'category', 'fromDate', 'toDate', 'reason', 'cancelledOn'],
    extraNote: 'Reporting manager (if set) is auto-added to CC.',
    bodyPreview: 'Employee name/code, category, dates, cancellation reason, cancelled on',
  },
  {
    type: 'LEAVE_CANCELLATION_REQUEST',
    title: 'Leave Cancellation Request',
    audience: 'HR',
    description: 'Sent to HR when an employee requests to cancel an ongoing/approved leave.',
    defaultSubject: 'Leave Cancellation Request — {employeeName}',
    vars: ['employeeName', 'employeeCode', 'category', 'fromDate', 'toDate', 'reason', 'requestedOn'],
    bodyPreview: 'Employee name/code, leave details, cancellation reason, action required',
  },
  {
    type: 'RESIGNATION_SUBMITTED',
    title: 'Resignation Submitted',
    audience: 'HR',
    description: 'Sent to HR when an employee submits resignation.',
    defaultSubject: 'Resignation Submitted — {employeeName} ({employeeCode})',
    vars: ['employeeName', 'employeeCode', 'resignationDate', 'expectedLwd'],
    bodyPreview: 'Employee name/code, Resignation Date, Expected Last Working Day',
  },
  {
    type: 'LWD_REMINDER',
    title: 'Last Working Day Reminder',
    audience: 'HR',
    description: 'Sent to HR as reminders before an employee\'s last working day (cron).',
    defaultSubject: 'LWD Reminder — {employeeName} ({employeeCode}) — {daysRemaining} days',
    vars: ['employeeName', 'employeeCode', 'lwd', 'daysRemaining'],
    bodyPreview: 'Employee name/code, LWD date, days remaining',
  },
  {
    type: 'ALL_CLEARANCE_DONE',
    title: 'All Clearances Complete',
    audience: 'HR',
    description: 'Sent to Super Admin when all exit clearances are marked complete.',
    defaultSubject: 'All Clearances Complete — {employeeName} ({employeeCode})',
    vars: ['employeeName', 'employeeCode'],
    bodyPreview: 'Employee name/code, clearance complete confirmation',
  },
  {
    type: 'RESIGNATION_WITHDRAWN',
    title: 'Resignation Withdrawn',
    audience: 'HR',
    description: 'Sent to HR when an employee withdraws their resignation.',
    defaultSubject: 'Resignation Withdrawn — {employeeName} ({employeeCode})',
    vars: ['employeeName', 'employeeCode'],
    bodyPreview: 'Employee name/code, status restored to Active',
  },
  // ── Employee notifications ───────────────────────────────────────────────
  {
    type: 'LEAVE_APPROVED',
    title: 'Leave Approved',
    audience: 'Employee',
    description: 'Sent to the employee when their leave is approved.',
    defaultSubject: 'Leave Approved — {fromDate} to {toDate}',
    vars: ['employeeName', 'employeeCode', 'fromDate', 'toDate', 'totalDays', 'leaveType', 'category', 'approvedBy', 'approvedOn'],
    bodyPreview: 'Leave dates, type, total days, approved by, approved on',
  },
  {
    type: 'LEAVE_DECLINED',
    title: 'Leave Declined',
    audience: 'Employee',
    description: 'Sent to the employee when their leave is declined.',
    defaultSubject: 'Leave Declined — {fromDate} to {toDate}',
    vars: ['employeeName', 'fromDate', 'toDate', 'category', 'declineReason', 'declinedBy', 'declinedOn'],
    bodyPreview: 'Leave dates, reason for decline, declined by',
  },
  {
    type: 'LEAVE_AUTO_APPROVED',
    title: 'Sick Leave Auto-Approved',
    audience: 'Employee',
    description: 'Sent to the employee when sick leave is automatically approved.',
    defaultSubject: 'Sick Leave Confirmed — {fromDate} to {toDate}',
    vars: ['employeeName', 'fromDate', 'toDate', 'totalDays', 'lopDays', 'appliedOn'],
    bodyPreview: 'Leave dates, total days, LOP days (if any), applied on',
  },
  {
    type: 'LEAVE_CANCELLATION_APPROVED',
    title: 'Leave Cancellation Approved',
    audience: 'Employee',
    description: 'Sent to the employee when their cancellation request is approved.',
    defaultSubject: 'Leave Cancellation Approved',
    vars: ['employeeName', 'fromDate', 'toDate', 'approvedBy', 'approvedOn'],
    bodyPreview: 'Confirmation that cancellation is approved, days restored',
  },
  {
    type: 'LEAVE_CANCELLATION_DECLINED',
    title: 'Leave Cancellation Declined',
    audience: 'Employee',
    description: 'Sent to the employee when their cancellation request is declined.',
    defaultSubject: 'Leave Cancellation Declined',
    vars: ['employeeName', 'fromDate', 'toDate', 'declinedBy', 'reason', 'declinedOn'],
    bodyPreview: 'Cancellation declined, reason, original leave remains active',
  },
  {
    type: 'RESIGNATION_ACKNOWLEDGED',
    title: 'Resignation Acknowledged',
    audience: 'Employee',
    description: 'Sent to the employee confirming receipt of resignation.',
    defaultSubject: 'Resignation Received — Acknowledgement',
    vars: ['employeeName', 'resignationDate', 'expectedLwd', 'noticeDays'],
    bodyPreview: 'Resignation received confirmation, expected LWD, notice period',
  },
  {
    type: 'RESIGNATION_ACCEPTED',
    title: 'Resignation Accepted',
    audience: 'Employee',
    description: 'Sent to the employee when resignation is formally accepted (LWD confirmed).',
    defaultSubject: 'Resignation Accepted — LWD Confirmed',
    vars: ['employeeName', 'lwd', 'noticeServed'],
    bodyPreview: 'Resignation accepted, final LWD, notice served, clearance begins',
  },
  {
    type: 'WITHDRAWAL_APPROVED',
    title: 'Withdrawal Approved',
    audience: 'Employee',
    description: 'Sent to the employee when their resignation withdrawal is confirmed.',
    defaultSubject: 'Resignation Withdrawal Confirmed',
    vars: ['employeeName', 'withdrawnOn'],
    bodyPreview: 'Withdrawal confirmed, status restored to Active',
  },
  {
    type: 'LOAN_CREATED',
    title: 'Loan Approved',
    audience: 'Employee',
    description: 'Sent to the employee when a loan is approved and created.',
    defaultSubject: 'Loan Approved — {amount}',
    vars: ['employeeName', 'amount', 'emi', 'tenure', 'disbursedOn', 'purpose'],
    bodyPreview: 'Loan amount, EMI, tenure, disbursal date, purpose',
  },
  {
    type: 'REIMBURSEMENT_ADDED',
    title: 'Reimbursement Approved',
    audience: 'Employee',
    description: 'Sent to the employee when a reimbursement is added to their payroll.',
    defaultSubject: 'Reimbursement Approved — {amount}',
    vars: ['employeeName', 'amount', 'category', 'cycle', 'addedOn'],
    bodyPreview: 'Amount, category, payroll cycle, added on',
  },
  {
    type: 'ASSET_ASSIGNED',
    title: 'Asset Assigned',
    audience: 'Employee',
    description: 'Sent to the employee when an asset is assigned to them.',
    defaultSubject: 'Asset Assigned — {assetName}',
    vars: ['employeeName', 'assetName', 'assetCode', 'category', 'condition', 'assignedOn'],
    bodyPreview: 'Asset name, code, category, condition, assigned on',
  },
  {
    type: 'FNF_SETTLEMENT_READY',
    title: 'F&F Settlement Ready',
    audience: 'Employee',
    description: 'Sent to the employee when their F&F settlement is calculated and approved.',
    defaultSubject: 'Full & Final Settlement Ready',
    vars: ['employeeName', 'lwd', 'amount', 'settlementDate'],
    bodyPreview: 'Last working day, final amount, settlement date',
  },
]

export default function NotificationConfigPage() {
  const { user } = useAuthStore()
  if (user?.role !== 'SUPER_ADMIN') return <Navigate to="/access-denied" replace />

  const qc = useQueryClient()
  const [values, setValues] = useState<Record<string, string>>({})
  const [saved, setSaved]   = useState(false)
  const [testResults, setTestResults] = useState<Record<string, string>>({})
  const [testEmails,  setTestEmails]  = useState<Record<string, string>>({})
  const [activeTab,   setActiveTab]   = useState<NotifType>('LEAVE_APPLIED')

  const { data: config } = useQuery({
    queryKey: ['system-config'],
    queryFn:  () => configApi.get().then((r: any) => r.data.data),
  })

  useEffect(() => { if (config) setValues(config) }, [config])

  const saveMut = useMutation({
    mutationFn: () => configApi.update({ ...(config ?? {}), ...values }),
    onSuccess:  () => {
      qc.invalidateQueries({ queryKey: ['system-config'] })
      setSaved(true); setTimeout(() => setSaved(false), 3000)
    },
  })

  function getVal(key: string, dflt = '') {
    return values[key] ?? (config as any)?.[key] ?? dflt
  }
  function setVal(key: string, v: string) {
    setValues(p => ({ ...p, [key]: v }))
  }

  async function sendTest(type: NotifType) {
    const to = testEmails[type]
    if (!to) { setTestResults(p => ({ ...p, [type]: 'Enter a test email first' })); return }
    try {
      await api.post('/api/config/test-notification', { type, toEmail: to })
      setTestResults(p => ({ ...p, [type]: 'OK: Test email sent' }))
    } catch (e: any) {
      setTestResults(p => ({ ...p, [type]: e?.response?.data?.error || 'Send failed' }))
    }
    setTimeout(() => setTestResults(p => ({ ...p, [type]: '' })), 4000)
  }

  const current = NOTIFS.find(n => n.type === activeTab)!

  return (
    <div className="space-y-5 max-w-5xl">
      <PageHeader
        title="Notification Configuration"
        subtitle="Configure recipients, CC, subject and on/off for each notification email"
        actions={<Button icon={<Save size={14} />} loading={saveMut.isPending} onClick={() => saveMut.mutate()}>Save Changes</Button>}
      />

      {saved && <Alert type="success" message="Notification settings saved successfully." />}

      {/* Tabs */}
      <Card>
        <div className="p-3 border-b border-slate-100 space-y-3">
          <div>
            <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1.5">HR / Admin</div>
            <div className="flex flex-wrap gap-2">
              {NOTIFS.filter(n => n.audience === 'HR').map(n => (
                <button
                  key={n.type}
                  onClick={() => setActiveTab(n.type)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition ${
                    activeTab === n.type
                      ? 'bg-brand-50 text-brand-700 border-brand-200'
                      : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  {n.title}
                </button>
              ))}
            </div>
          </div>
          <div>
            <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Employee</div>
            <div className="flex flex-wrap gap-2">
              {NOTIFS.filter(n => n.audience === 'Employee').map(n => (
                <button
                  key={n.type}
                  onClick={() => setActiveTab(n.type)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition ${
                    activeTab === n.type
                      ? 'bg-brand-50 text-brand-700 border-brand-200'
                      : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  {n.title}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="p-5 space-y-5">
          {/* Header */}
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-brand-50 flex items-center justify-center">
              <Bell size={14} className="text-brand-600" />
            </div>
            <h3 className="text-sm font-semibold text-slate-700">{current.title}</h3>
            <span className={`ml-auto text-[10px] font-semibold px-2 py-0.5 rounded-full ${
              current.audience === 'HR' ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'
            }`}>
              {current.audience === 'HR' ? 'Sent to HR' : 'Sent to Employee'}
            </span>
          </div>
          <p className="text-xs text-slate-500">{current.description}</p>
          {current.audience === 'Employee' && (
            <div className="text-xs text-slate-500 bg-emerald-50 border border-emerald-200 rounded-lg p-3">
              <strong>Recipient:</strong> The employee is automatically set as TO. The TO list below is additive (for extra recipients).
            </div>
          )}
          {current.extraNote && (
            <div className="text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-lg p-3">
              <strong>Note:</strong> {current.extraNote}
            </div>
          )}

          {/* Enabled toggle */}
          <div className="flex items-center justify-between bg-slate-50 rounded-lg p-3 border border-slate-200">
            <div>
              <div className="text-xs font-medium text-slate-700">Notification Enabled</div>
              <div className="text-[11px] text-slate-500">Turn off to stop sending this notification</div>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                className="sr-only peer"
                checked={(getVal(`NOTIF_${current.type}_ENABLED`, 'true')).toLowerCase() !== 'false'}
                onChange={e => setVal(`NOTIF_${current.type}_ENABLED`, e.target.checked ? 'true' : 'false')}
              />
              <div className="w-10 h-5 bg-slate-200 peer-checked:bg-brand-500 rounded-full peer transition after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:h-4 after:w-4 after:transition peer-checked:after:translate-x-5"></div>
            </label>
          </div>

          {/* TO */}
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">TO Recipients</label>
            <Input
              value={getVal(`NOTIF_${current.type}_TO`)}
              onChange={e => setVal(`NOTIF_${current.type}_TO`, e.target.value)}
              placeholder="hr@csharptek.com, admin@csharptek.com"
            />
            <p className="text-[11px] text-slate-400 mt-1">Comma-separated email addresses</p>
          </div>

          {/* CC */}
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">CC Recipients</label>
            <Input
              value={getVal(`NOTIF_${current.type}_CC`)}
              onChange={e => setVal(`NOTIF_${current.type}_CC`, e.target.value)}
              placeholder="manager@csharptek.com"
            />
            <p className="text-[11px] text-slate-400 mt-1">Comma-separated. Optional.</p>
          </div>

          {/* Subject */}
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Email Subject</label>
            <Input
              value={getVal(`NOTIF_${current.type}_SUBJECT`, current.defaultSubject)}
              onChange={e => setVal(`NOTIF_${current.type}_SUBJECT`, e.target.value)}
              placeholder={current.defaultSubject}
            />
            <p className="text-[11px] text-slate-400 mt-1">
              Available placeholders: {current.vars.map(v => `{${v}}`).join(', ')}
            </p>
          </div>

          {/* Body preview info */}
          <div className="bg-slate-50 rounded-lg p-3 border border-slate-200">
            <div className="flex items-center gap-2 mb-1">
              <Mail size={12} className="text-slate-500" />
              <div className="text-xs font-medium text-slate-700">Email Body Includes</div>
            </div>
            <p className="text-xs text-slate-500">{current.bodyPreview}</p>
          </div>

          {/* Test */}
          <div className="border-t border-slate-100 pt-4">
            <div className="text-xs font-medium text-slate-700 mb-2">Send Test Email</div>
            <div className="flex gap-2 items-start">
              <Input
                value={testEmails[current.type] || ''}
                onChange={e => setTestEmails(p => ({ ...p, [current.type]: e.target.value }))}
                placeholder="Your email to receive test"
                className="flex-1"
              />
              <Button size="sm" icon={<Send size={12} />} onClick={() => sendTest(current.type)}>Send Test</Button>
            </div>
            {testResults[current.type] && (
              <div className={`mt-2 text-xs flex items-center gap-1 ${testResults[current.type].startsWith('OK') ? 'text-emerald-600' : 'text-red-600'}`}>
                {testResults[current.type].startsWith('OK') ? <CheckCircle2 size={12} /> : <XCircle size={12} />}
                {testResults[current.type]}
              </div>
            )}
          </div>
        </div>
      </Card>
    </div>
  )
}
