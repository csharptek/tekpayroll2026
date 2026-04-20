import { useState, useEffect } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuthStore } from '../../store/authStore'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Save, Shield, Calendar, DollarSign, Mail, Clock, CheckCircle2, Send } from 'lucide-react'
import { configApi } from '../../services/api'
import { exitApi } from '../../services/api'
import { PageHeader, Button, Card, Alert, Skeleton, Input, Table, Th, Td, Tr } from '../../components/ui'

function Section({ icon: Icon, title, subtitle, children }: any) {
  return (
    <Card>
      <div className="p-5">
        <div className="flex items-center gap-2 mb-1">
          <div className="w-7 h-7 rounded-lg bg-brand-50 flex items-center justify-center">
            <Icon size={14} className="text-brand-600" />
          </div>
          <h3 className="text-sm font-semibold text-slate-700">{title}</h3>
        </div>
        {subtitle && <p className="text-xs text-slate-400 mb-4 ml-9">{subtitle}</p>}
        <div className="ml-0 mt-4">{children}</div>
      </div>
    </Card>
  )
}

export default function ConfigPage() {
  const { user: _authUser } = useAuthStore()
  if (_authUser?.role !== 'SUPER_ADMIN') return <Navigate to="/access-denied" replace />

  const qc = useQueryClient()
  const [saved, setSaved]           = useState(false)
  const [configValues, setConfigValues] = useState<Record<string, string>>({})
  const [ptSlabs, setPtSlabs]       = useState<any[]>([])
  const [newSlab, setNewSlab]       = useState({ state: '', minSalary: '', maxSalary: '', ptAmount: '' })
  const [testEmail, setTestEmail]   = useState('')
  const [testMsg, setTestMsg]       = useState('')
  const [showSecret, setShowSecret] = useState(false)

  const { data: config } = useQuery({
    queryKey: ['system-config'],
    queryFn:  () => configApi.get().then((r: any) => r.data.data),
  })

  const { data: slabs, isLoading: loadingSlabs } = useQuery({
    queryKey: ['pt-slabs'],
    queryFn:  () => configApi.ptSlabs().then((r: any) => r.data.data),
  })

  useEffect(() => { if (config) setConfigValues(config) }, [config])
  useEffect(() => { if (slabs)  setPtSlabs(slabs) }, [slabs])

  const saveMut = useMutation({
    mutationFn: () => configApi.update({ ...(config as any ?? {}), ...configValues }),
    onSuccess:  () => { qc.invalidateQueries({ queryKey: ['system-config'] }); setSaved(true); setTimeout(() => setSaved(false), 3000) },
  })

  const testEmailMut = useMutation({
    mutationFn: () => exitApi.testEmail(testEmail),
    onSuccess:  () => setTestMsg('Test email sent successfully!'),
    onError:    (e: any) => setTestMsg(e?.response?.data?.error || 'Failed to send test email'),
  })

  function getValue(key: string, dflt: string) {
    return configValues[key] ?? (config as any)?.[key] ?? dflt
  }

  function set(key: string, value: string) {
    setConfigValues(p => ({ ...p, [key]: value }))
  }

  const payrollConfigs = [
    { key: 'CYCLE_START_DAY', label: 'Cycle Start Day',     default: '26', hint: 'Day of prev month cycle starts' },
    { key: 'CYCLE_END_DAY',   label: 'Cycle End Day',       default: '25', hint: 'Day of current month cycle ends' },
    { key: 'PAYROLL_RUN_DAY', label: 'Payroll Calc Day',    default: '27', hint: 'Day payroll engine runs' },
    { key: 'PAYSLIP_GEN_DAY', label: 'Payslip Release Day', default: '5',  hint: 'Day payslips are generated' },
  ]

  const esiConfigs = [
    { key: 'ESI_EMPLOYEE_RATE', label: 'Employee ESI Rate', default: '0.0075', hint: 'e.g. 0.0075 = 0.75%' },
    { key: 'ESI_EMPLOYER_RATE', label: 'Employer ESI Rate', default: '0.0325', hint: 'e.g. 0.0325 = 3.25%' },
    { key: 'ESI_THRESHOLD',     label: 'ESI Threshold (₹)', default: '21000',  hint: 'ESI applies if gross ≤ this' },
  ]

  const noticeConfigs = [
    { key: 'NOTICE_DAYS_RESIGNED',   label: 'Notice Period — Resigned (days)',   default: '90' },
    { key: 'NOTICE_DAYS_TERMINATED', label: 'Notice Period — Terminated (days)', default: '0' },
    { key: 'NOTICE_DAYS_ABSCONDED',  label: 'Notice Period — Absconded (days)',  default: '0' },
  ]

  return (
    <div className="space-y-5 max-w-4xl">
      <PageHeader title="Configuration" subtitle="Payroll rules, notice periods, email and deduction settings"
        actions={<Button icon={<Save size={14} />} loading={saveMut.isPending} onClick={() => saveMut.mutate()}>Save Changes</Button>}
      />

      {saved && <Alert type="success" message="Configuration saved successfully." />}

      {/* ── Notice Period ────────────────────────────────────────────── */}
      <Section icon={Clock} title="Notice Period Configuration" subtitle="Default notice period (days) by exit type. Applied at time of resignation initiation.">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {noticeConfigs.map(({ key, label, default: dflt }) => (
            <div key={key} className="flex flex-col gap-1">
              <label className="label">{label}</label>
              <input type="number" min="0" className="input" value={getValue(key, dflt)}
                onChange={e => set(key, e.target.value)} />
            </div>
          ))}
        </div>
      </Section>

      {/* ── Email (Graph API) ────────────────────────────────────────── */}
      <Section icon={Mail} title="Email Configuration (Microsoft Graph API)" subtitle="Used to send resignation, exit, and notification emails via Microsoft 365.">
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="label">Tenant ID</label>
              <input className="input" placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                value={getValue('GRAPH_TENANT_ID', '')} onChange={e => set('GRAPH_TENANT_ID', e.target.value)} />
            </div>
            <div>
              <label className="label">Client ID (App ID)</label>
              <input className="input" placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                value={getValue('GRAPH_CLIENT_ID', '')} onChange={e => set('GRAPH_CLIENT_ID', e.target.value)} />
            </div>
            <div>
              <label className="label">Client Secret</label>
              <div className="relative">
                <input
                  className="input pr-16"
                  type={showSecret ? 'text' : 'password'}
                  placeholder="Client secret value"
                  value={getValue('GRAPH_CLIENT_SECRET', '')}
                  onChange={e => set('GRAPH_CLIENT_SECRET', e.target.value)}
                />
                <button
                  type="button"
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-brand-600 font-medium"
                  onClick={() => setShowSecret(p => !p)}
                >
                  {showSecret ? 'Hide' : 'Show'}
                </button>
              </div>
            </div>
            <div>
              <label className="label">Sender Email Address</label>
              <input className="input" type="email" placeholder="payroll@yourdomain.com"
                value={getValue('GRAPH_SENDER_EMAIL', '')} onChange={e => set('GRAPH_SENDER_EMAIL', e.target.value)} />
              <p className="text-xs text-slate-400 mt-1">Must be a licensed M365 mailbox in your tenant</p>
            </div>
          </div>

          <div className="bg-slate-50 rounded-xl p-4 border border-slate-100">
            <p className="text-xs font-semibold text-slate-600 mb-3">Test Email Configuration</p>
            <div className="flex gap-2">
              <input className="input flex-1" type="email" placeholder="Send test to..."
                value={testEmail} onChange={e => setTestEmail(e.target.value)} />
              <Button
                variant="secondary"
                icon={<Send size={13} />}
                loading={testEmailMut.isPending}
                disabled={!testEmail}
                onClick={() => { setTestMsg(''); testEmailMut.mutate() }}
              >
                Send Test
              </Button>
            </div>
            {testMsg && (
              <p className={`text-xs mt-2 ${testMsg.includes('success') ? 'text-emerald-600' : 'text-red-500'}`}>
                {testMsg}
              </p>
            )}
          </div>

          <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 text-xs text-blue-700">
            <p className="font-semibold mb-1">Setup Instructions</p>
            <ol className="list-decimal ml-4 space-y-0.5">
              <li>Register an App in Azure Entra ID (App registrations)</li>
              <li>Add API permission: <strong>Mail.Send</strong> (Application, not Delegated)</li>
              <li>Grant admin consent for the permission</li>
              <li>Create a Client Secret and paste above</li>
              <li>The Sender Email must be a licensed M365 user in your tenant</li>
            </ol>
          </div>
        </div>
      </Section>

      {/* ── ESI ─────────────────────────────────────────────────────── */}
      <Section icon={DollarSign} title="ESI Configuration" subtitle="ESI applies automatically when (Gross - HYI) ≤ threshold.">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {esiConfigs.map(({ key, label, default: dflt, hint }) => (
            <div key={key} className="flex flex-col gap-1">
              <label className="label">{label}</label>
              <input type="number" step="0.0001" className="input" value={getValue(key, dflt)}
                onChange={e => set(key, e.target.value)} />
              <p className="text-xs text-slate-400">{hint}</p>
            </div>
          ))}
        </div>
      </Section>

      {/* ── Payroll Cycle ───────────────────────────────────────────── */}
      <Section icon={Calendar} title="Payroll Cycle Dates">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {payrollConfigs.map(({ key, label, default: dflt, hint }) => (
            <div key={key} className="flex flex-col gap-1">
              <label className="label">{label}</label>
              <input type="number" className="input" min="1" max="31" value={getValue(key, dflt)}
                onChange={e => set(key, e.target.value)} />
              <p className="text-xs text-slate-400">{hint}</p>
            </div>
          ))}
        </div>
      </Section>

      {/* ── PT Slabs ────────────────────────────────────────────────── */}
      <Section icon={Shield} title="Professional Tax Slabs" subtitle="Configure state-wise PT slabs.">
        {loadingSlabs ? <Skeleton className="h-40" /> : (
          <div className="space-y-3">
            <Table>
              <thead><tr className="border-b border-slate-100">
                <Th>State</Th><Th className="text-right">Min Salary</Th><Th className="text-right">Max Salary</Th><Th className="text-right">PT Amount</Th>
              </tr></thead>
              <tbody>
                {((slabs || ptSlabs) as any[]).map((slab: any) => (
                  <Tr key={slab.id}>
                    <Td className="font-medium">{slab.state}</Td>
                    <Td className="text-right">₹{Number(slab.minSalary).toLocaleString('en-IN')}</Td>
                    <Td className="text-right">{slab.maxSalary ? `₹${Number(slab.maxSalary).toLocaleString('en-IN')}` : 'No limit'}</Td>
                    <Td className="text-right font-semibold">₹{Number(slab.ptAmount).toLocaleString('en-IN')}</Td>
                  </Tr>
                ))}
                {!((slabs || ptSlabs) as any[])?.length && (
                  <tr><td colSpan={4} className="text-center py-6 text-sm text-slate-400">No PT slabs configured yet</td></tr>
                )}
              </tbody>
            </Table>
            <div className="bg-slate-50 rounded-xl p-4 border border-slate-100">
              <p className="text-xs font-semibold text-slate-600 mb-3">Add PT Slab</p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <Input placeholder="State"         value={newSlab.state}     onChange={e => setNewSlab(p => ({ ...p, state: e.target.value }))} />
                <Input type="number" placeholder="Min Salary" value={newSlab.minSalary} onChange={e => setNewSlab(p => ({ ...p, minSalary: e.target.value }))} />
                <Input type="number" placeholder="Max Salary" value={newSlab.maxSalary} onChange={e => setNewSlab(p => ({ ...p, maxSalary: e.target.value }))} />
                <Input type="number" placeholder="PT Amount (₹)" value={newSlab.ptAmount} onChange={e => setNewSlab(p => ({ ...p, ptAmount: e.target.value }))} />
              </div>
              <div className="mt-3 flex justify-end">
                <Button size="sm" disabled={!newSlab.state || !newSlab.ptAmount}
                  onClick={() => { setPtSlabs(p => [...p, { id: Date.now(), ...newSlab }]); setNewSlab({ state: '', minSalary: '', maxSalary: '', ptAmount: '' }) }}>
                  Add Slab
                </Button>
              </div>
            </div>
          </div>
        )}
      </Section>

      <div className="flex justify-end pb-6">
        <Button icon={<Save size={14} />} loading={saveMut.isPending} onClick={() => saveMut.mutate()}>Save All Changes</Button>
      </div>
    </div>
  )
}
