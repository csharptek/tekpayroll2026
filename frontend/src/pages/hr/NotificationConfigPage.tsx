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

interface NotifDef {
  type:         NotifType
  title:        string
  description:  string
  defaultSubject: string
  vars:         string[]
  extraNote?:   string
  bodyPreview:  string
}

const NOTIFS: NotifDef[] = [
  {
    type: 'LEAVE_APPLIED',
    title: 'Leave Application Submitted',
    description: 'Sent to HR and CC reporting manager when an employee applies for leave.',
    defaultSubject: 'Leave Application — {fullName} ({employeeId})',
    vars: ['employeeId', 'fullName', 'fromDate', 'toDate', 'leaveType', 'leaveReason', 'description', 'appliedDateTime', 'leaveCategory'],
    extraNote: 'Reporting manager (if set) is auto-added to CC.',
    bodyPreview: 'Employee ID, Full Name, From Date, To Date, Leave Type (Full/Half — which half), Leave Reason, Description, Applied On, Leave Category',
  },
  {
    type: 'RESIGNATION_SUBMITTED',
    title: 'Resignation Submitted',
    description: 'Sent to HR when an employee submits resignation or HR/SA initiates exit.',
    defaultSubject: 'Resignation Submitted — {employeeName} ({employeeCode})',
    vars: ['employeeName', 'employeeCode', 'resignationDate', 'expectedLwd'],
    bodyPreview: 'Employee name/code, Resignation Date, Expected Last Working Day',
  },
  {
    type: 'LWD_REMINDER',
    title: 'Last Working Day Reminder',
    description: 'Sent to HR as reminders before an employee\'s last working day.',
    defaultSubject: 'LWD Reminder — {employeeName} ({employeeCode}) — {daysRemaining} days',
    vars: ['employeeName', 'employeeCode', 'lwd', 'daysRemaining'],
    bodyPreview: 'Employee name/code, LWD date, days remaining',
  },
  {
    type: 'ALL_CLEARANCE_DONE',
    title: 'All Clearances Complete',
    description: 'Sent to Super Admin when all exit clearances are marked complete.',
    defaultSubject: 'All Clearances Complete — {employeeName} ({employeeCode})',
    vars: ['employeeName', 'employeeCode'],
    bodyPreview: 'Employee name/code, clearance complete confirmation',
  },
  {
    type: 'RESIGNATION_WITHDRAWN',
    title: 'Resignation Withdrawn',
    description: 'Sent to HR when an employee withdraws their resignation.',
    defaultSubject: 'Resignation Withdrawn — {employeeName} ({employeeCode})',
    vars: ['employeeName', 'employeeCode'],
    bodyPreview: 'Employee name/code, status restored to Active',
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
        <div className="flex flex-wrap gap-2 p-3 border-b border-slate-100">
          {NOTIFS.map(n => (
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

        <div className="p-5 space-y-5">
          {/* Header */}
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-brand-50 flex items-center justify-center">
              <Bell size={14} className="text-brand-600" />
            </div>
            <h3 className="text-sm font-semibold text-slate-700">{current.title}</h3>
          </div>
          <p className="text-xs text-slate-500">{current.description}</p>
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
