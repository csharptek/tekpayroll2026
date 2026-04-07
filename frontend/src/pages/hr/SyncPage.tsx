import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  RefreshCw, CheckCircle2, XCircle, Clock, Download,
  Upload, Globe, Users, ChevronRight, AlertTriangle, Eye
} from 'lucide-react'
import { format } from 'date-fns'
import api from '../../services/api'
import {
  PageHeader, Button, Card, Alert, Table, Th, Td, Tr,
  EmptyState, Skeleton
} from '../../components/ui'
import { DatePicker } from '../../components/DatePicker'
import clsx from 'clsx'

const INDIAN_STATES = [
  'Andhra Pradesh','Assam','Bihar','Chandigarh','Chhattisgarh','Delhi',
  'Goa','Gujarat','Haryana','Himachal Pradesh','Jharkhand','Karnataka',
  'Kerala','Madhya Pradesh','Maharashtra','Manipur','Meghalaya','Mizoram',
  'Nagaland','Odisha','Punjab','Rajasthan','Sikkim','Tamil Nadu','Telangana',
  'Tripura','Uttar Pradesh','Uttarakhand','West Bengal',
]

const ROLE_OPTIONS = [
  { value: 'SUPER_ADMIN', label: 'Super Admin' },
  { value: 'HR',          label: 'HR Admin' },
  { value: 'MANAGEMENT',  label: 'Management' },
  { value: 'EMPLOYEE',    label: 'Employee' },
]

const STATUS_COLORS: Record<string, string> = {
  NEW:       'bg-emerald-50 text-emerald-700 border-emerald-200',
  UPDATE:    'bg-blue-50 text-blue-700 border-blue-200',
  NO_CHANGE: 'bg-slate-50 text-slate-500 border-slate-200',
}

// ─── STEP 1: DOMAIN SELECTOR ─────────────────────────────────────────────────

function DomainSelector({ onNext }: { onNext: (domains: string[]) => void }) {
  const [selectedDomains, setSelectedDomains] = useState<Set<string>>(new Set())
  const [saved, setSaved] = useState(false)

  const { data: entraDomainsData, isLoading: loadingEntra } = useQuery({
    queryKey: ['entra-domains'],
    queryFn: () => api.get('/api/sync/domains').then(r => r.data.data),
  })

  const { data: savedConfig } = useQuery({
    queryKey: ['domain-config'],
    queryFn: () => api.get('/api/sync/domain-config').then(r => r.data.data),
  })

  useEffect(() => {
    if (savedConfig) {
      setSelectedDomains(new Set(
        savedConfig.filter((d: any) => d.isEnabled).map((d: any) => d.domain)
      ))
    }
  }, [savedConfig])

  const saveConfig = useMutation({
    mutationFn: (domains: { name: string; isEnabled: boolean }[]) =>
      api.put('/api/sync/domain-config', { domains }),
    onSuccess: () => { setSaved(true); setTimeout(() => setSaved(false), 2000) },
  })

  const entraNames: string[] = (entraDomainsData || []).map((d: any) => d.name)

  return (
    <Card title="Step 1 — Select Domains to Sync">
      <div className="p-5 space-y-4">
        <p className="text-sm text-slate-500">
          Select which Entra ID domains to pull employees from. Only verified domains are shown.
        </p>

        {loadingEntra ? (
          <Skeleton className="h-32" />
        ) : entraNames.length === 0 ? (
          <Alert type="warning" message="No verified domains found in your Entra ID tenant. Check Azure credentials." />
        ) : (
          <div className="space-y-2">
            {entraNames.map(domain => (
              <label key={domain} className={clsx(
                'flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-all',
                selectedDomains.has(domain)
                  ? 'border-brand-300 bg-brand-50'
                  : 'border-slate-200 hover:border-slate-300'
              )}>
                <input
                  type="checkbox"
                  checked={selectedDomains.has(domain)}
                  onChange={e => {
                    const next = new Set(selectedDomains)
                    e.target.checked ? next.add(domain) : next.delete(domain)
                    setSelectedDomains(next)
                  }}
                  className="w-4 h-4 text-brand-600 rounded"
                />
                <Globe size={14} className="text-slate-400" />
                <span className="text-sm font-medium text-slate-800">{domain}</span>
              </label>
            ))}
          </div>
        )}

        {saved && <Alert type="success" message="Domain preferences saved." />}

        <div className="flex justify-between pt-2">
          <Button
            variant="secondary"
            loading={saveConfig.isPending}
            onClick={() => saveConfig.mutate(
              entraNames.map(name => ({ name, isEnabled: selectedDomains.has(name) }))
            )}
          >
            Save Preferences
          </Button>
          <Button
            icon={<ChevronRight size={14} />}
            disabled={selectedDomains.size === 0}
            onClick={() => onNext(Array.from(selectedDomains))}
          >
            Fetch Users from Selected Domains
          </Button>
        </div>
      </div>
    </Card>
  )
}

// ─── STEP 2: PREVIEW TABLE ────────────────────────────────────────────────────

function PreviewTable({
  domains,
  onBack,
  onImport,
}: {
  domains: string[]
  onBack: () => void
  onImport: (rows: any[]) => void
}) {
  const [rows, setRows] = useState<any[]>([])
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [filter, setFilter] = useState<'ALL' | 'NEW' | 'UPDATE' | 'NO_CHANGE'>('ALL')

  const previewQuery = useMutation({
    mutationFn: () => api.post('/api/sync/preview', { domains }).then(r => r.data.data),
    onSuccess: data => {
      setRows(data)
      // Pre-select NEW and UPDATE rows
      const preSelected = new Set<number>()
      data.forEach((r: any, i: number) => {
        if (r.status === 'NEW' || r.status === 'UPDATE') preSelected.add(i)
      })
      setSelected(preSelected)
    },
  })

  useEffect(() => { previewQuery.mutate() }, [])

  function updateRow(index: number, field: string, value: any) {
    setRows(prev => prev.map((r, i) => i === index ? { ...r, [field]: value } : r))
  }

  function toggleAll(checked: boolean) {
    if (checked) {
      setSelected(new Set(filteredRows.map(({ i }) => i)))
    } else {
      setSelected(new Set())
    }
  }

  const filteredRows = rows
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => filter === 'ALL' || r.status === filter)

  const counts = {
    NEW:       rows.filter(r => r.status === 'NEW').length,
    UPDATE:    rows.filter(r => r.status === 'UPDATE').length,
    NO_CHANGE: rows.filter(r => r.status === 'NO_CHANGE').length,
  }

  return (
    <div className="space-y-4">
      {/* Stats */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: 'Total Fetched', value: rows.length,       color: 'text-slate-700' },
          { label: 'New',           value: counts.NEW,        color: 'text-emerald-600' },
          { label: 'To Update',     value: counts.UPDATE,     color: 'text-blue-600' },
          { label: 'No Change',     value: counts.NO_CHANGE,  color: 'text-slate-400' },
        ].map(({ label, value, color }) => (
          <div key={label} className="card p-4">
            <p className="stat-label">{label}</p>
            <p className={clsx('text-2xl font-display font-bold mt-1', color)}>{value}</p>
          </div>
        ))}
      </div>

      <Card>
        {/* Header + filter */}
        <div className="p-4 flex items-center justify-between border-b border-slate-100">
          <div className="flex gap-2">
            {(['ALL', 'NEW', 'UPDATE', 'NO_CHANGE'] as const).map(f => (
              <button key={f}
                onClick={() => setFilter(f)}
                className={clsx('px-3 py-1 rounded-lg text-xs font-medium transition-all',
                  filter === f ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                )}>
                {f === 'NO_CHANGE' ? 'NO CHANGE' : f} {f === 'ALL' ? `(${rows.length})` : `(${counts[f] || 0})`}
              </button>
            ))}
          </div>
          {previewQuery.isPending && (
            <span className="text-xs text-slate-400 flex items-center gap-1">
              <RefreshCw size={12} className="animate-spin" /> Fetching...
            </span>
          )}
        </div>

        {previewQuery.isPending ? (
          <Skeleton className="h-64 m-4" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100">
                  <th className="p-3 w-10">
                    <input type="checkbox"
                      onChange={e => toggleAll(e.target.checked)}
                      checked={filteredRows.length > 0 && filteredRows.every(({ i }) => selected.has(i))}
                      className="w-4 h-4 rounded"
                    />
                  </th>
                  <Th>Status</Th>
                  <Th>Display Name</Th>
                  <Th>Email</Th>
                  <Th>Employee Code</Th>
                  <Th>Job Title</Th>
                  <Th>Department</Th>
                  <Th>Role</Th>
                  <Th>Joining Date</Th>
                  <Th>State (PT)</Th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map(({ r, i }) => (
                  <tr key={r.entraId} className={clsx(
                    'border-b border-slate-50 hover:bg-slate-50/50',
                    selected.has(i) && 'bg-brand-50/30'
                  )}>
                    <td className="p-3">
                      <input type="checkbox"
                        checked={selected.has(i)}
                        onChange={e => {
                          const next = new Set(selected)
                          e.target.checked ? next.add(i) : next.delete(i)
                          setSelected(next)
                        }}
                        className="w-4 h-4 rounded"
                      />
                    </td>
                    <td className="p-3">
                      <span className={clsx('px-2 py-0.5 rounded-full text-xs font-medium border', STATUS_COLORS[r.status])}>
                        {r.status}
                      </span>
                      {!r.accountEnabled && (
                        <span className="ml-1 text-xs text-red-500">Disabled</span>
                      )}
                    </td>
                    <td className="p-2">
                      <input
                        value={r.displayName}
                        onChange={e => updateRow(i, 'displayName', e.target.value)}
                        className="input text-xs w-36"
                      />
                    </td>
                    <td className="p-3 text-xs text-slate-500 font-mono">{r.email}</td>
                    <td className="p-2">
                      <input
                        value={r.employeeCode}
                        onChange={e => updateRow(i, 'employeeCode', e.target.value)}
                        className="input text-xs w-28 font-mono"
                      />
                    </td>
                    <td className="p-2">
                      <input
                        value={r.jobTitle || ''}
                        onChange={e => updateRow(i, 'jobTitle', e.target.value)}
                        className="input text-xs w-32"
                        placeholder="Job Title"
                      />
                    </td>
                    <td className="p-2">
                      <input
                        value={r.department || ''}
                        onChange={e => updateRow(i, 'department', e.target.value)}
                        className="input text-xs w-28"
                        placeholder="Dept"
                      />
                    </td>
                    <td className="p-2">
                      <select
                        value={r.payrollRole}
                        onChange={e => updateRow(i, 'payrollRole', e.target.value)}
                        className="input text-xs w-32"
                      >
                        {ROLE_OPTIONS.map(opt => (
                          <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                      </select>
                    </td>
                    <td className="p-2">
                      <DatePicker
                        value={r.joiningDate || ''}
                        onChange={v => updateRow(i, 'joiningDate', v)}
                      />
                    </td>
                    <td className="p-2">
                      <select
                        value={r.state || ''}
                        onChange={e => updateRow(i, 'state', e.target.value)}
                        className="input text-xs w-36"
                      >
                        <option value="">Select State</option>
                        {INDIAN_STATES.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </td>
                  </tr>
                ))}
                {filteredRows.length === 0 && (
                  <tr><td colSpan={10} className="text-center py-8 text-sm text-slate-400">No users in this filter</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* Footer */}
        <div className="p-4 border-t border-slate-100 flex justify-between items-center">
          <Button variant="secondary" onClick={onBack}>← Back to Domains</Button>
          <div className="flex items-center gap-3">
            <span className="text-sm text-slate-500">{selected.size} selected</span>
            <Button
              icon={<Download size={14} />}
              disabled={selected.size === 0}
              onClick={() => {
                const toImport = Array.from(selected).map(i => rows[i])
                onImport(toImport)
              }}
            >
              Import {selected.size} Selected
            </Button>
          </div>
        </div>
      </Card>
    </div>
  )
}

// ─── MAIN PAGE ────────────────────────────────────────────────────────────────

export default function SyncPage() {
  const qc = useQueryClient()
  const [step, setStep]         = useState<'domains' | 'preview' | 'done'>('domains')
  const [domains, setDomains]   = useState<string[]>([])
  const [importResult, setImportResult] = useState<any>(null)
  const [pushResult, setPushResult]     = useState<any>(null)

  const { data: logs, isLoading: loadingLogs } = useQuery({
    queryKey: ['sync-logs'],
    queryFn:  () => api.get('/api/sync/logs').then(r => r.data.data),
  })

  const importMut = useMutation({
    mutationFn: (rows: any[]) => api.post('/api/sync/import', { rows }).then(r => r.data),
    onSuccess: result => {
      setImportResult(result)
      setStep('done')
      qc.invalidateQueries({ queryKey: ['sync-logs'] })
      qc.invalidateQueries({ queryKey: ['employees'] })
    },
  })

  const pushMut = useMutation({
    mutationFn: (employeeIds: string[]) =>
      api.post('/api/sync/push-to-entra', { employeeIds }).then(r => r.data),
    onSuccess: result => { setPushResult(result) },
  })

  return (
    <div className="space-y-5 max-w-full">
      <PageHeader
        title="Microsoft 365 Sync"
        subtitle="Sync employees from Entra ID with full control"
      />

      {/* Step indicator */}
      <div className="flex items-center gap-2 text-sm">
        {[
          { key: 'domains', label: '1. Select Domains' },
          { key: 'preview', label: '2. Preview & Edit' },
          { key: 'done',    label: '3. Import Complete' },
        ].map(({ key, label }, i) => (
          <div key={key} className="flex items-center gap-2">
            {i > 0 && <ChevronRight size={14} className="text-slate-300" />}
            <span className={clsx(
              'px-3 py-1 rounded-full text-xs font-medium',
              step === key ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-500'
            )}>{label}</span>
          </div>
        ))}
      </div>

      {/* Steps */}
      {step === 'domains' && (
        <DomainSelector onNext={d => { setDomains(d); setStep('preview') }} />
      )}

      {step === 'preview' && (
        <PreviewTable
          domains={domains}
          onBack={() => setStep('domains')}
          onImport={rows => importMut.mutate(rows)}
        />
      )}

      {step === 'done' && importResult && (
        <Card title="Import Complete">
          <div className="p-6 space-y-4">
            <div className="grid grid-cols-3 gap-4">
              <div className="bg-emerald-50 rounded-xl p-4 text-center">
                <p className="text-2xl font-bold text-emerald-700">{importResult.data?.added || 0}</p>
                <p className="text-sm text-emerald-600 mt-1">Employees Added</p>
              </div>
              <div className="bg-blue-50 rounded-xl p-4 text-center">
                <p className="text-2xl font-bold text-blue-700">{importResult.data?.updated || 0}</p>
                <p className="text-sm text-blue-600 mt-1">Employees Updated</p>
              </div>
              <div className="bg-slate-50 rounded-xl p-4 text-center">
                <p className="text-2xl font-bold text-slate-700">{importResult.data?.errors?.length || 0}</p>
                <p className="text-sm text-slate-500 mt-1">Errors</p>
              </div>
            </div>

            {importResult.data?.errors?.length > 0 && (
              <Alert type="error" title="Some imports failed"
                message={importResult.data.errors.map((e: any) => `${e.email}: ${e.error}`).join('\n')} />
            )}

            {pushResult && (
              <Alert type="success"
                message={`Pushed to Entra ID: ${pushResult.data?.success || 0} updated${pushResult.data?.failed > 0 ? `, ${pushResult.data.failed} failed` : ''}`} />
            )}

            <div className="flex gap-3">
              <Button variant="secondary" onClick={() => { setStep('domains'); setImportResult(null); setPushResult(null) }}>
                Start New Sync
              </Button>
              <Button
                variant="secondary"
                icon={<Upload size={14} />}
                loading={pushMut.isPending}
                onClick={async () => {
                  const emps = await api.get('/api/employees?limit=500').then(r =>
                    r.data.data.filter((e: any) => e.entraId).map((e: any) => e.id)
                  )
                  pushMut.mutate(emps)
                }}
              >
                Push All to Entra ID
              </Button>
            </div>
          </div>
        </Card>
      )}

      {/* Sync history */}
      <Card title="Sync History">
        {loadingLogs ? <Skeleton className="h-40 m-4" /> : !logs?.length ? (
          <EmptyState icon={<RefreshCw size={20} />} title="No sync history" description="Run a sync to see history here." />
        ) : (
          <Table>
            <thead>
              <tr className="border-b border-slate-100">
                <Th>Started</Th><Th>Type</Th><Th>Triggered By</Th><Th>Status</Th>
                <Th className="text-right">Added</Th><Th className="text-right">Updated</Th>
                <Th className="text-right">Skipped</Th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log: any) => (
                <Tr key={log.id}>
                  <Td><span className="text-xs font-mono">{format(new Date(log.startedAt), 'dd MMM yy, HH:mm')}</span></Td>
                  <Td><span className="badge badge-blue">{log.syncType}</span></Td>
                  <Td>{log.triggeredByName || 'System'}</Td>
                  <Td>
                    <div className="flex items-center gap-1.5">
                      {log.status === 'success'  && <CheckCircle2 size={13} className="text-emerald-500" />}
                      {log.status === 'failed'   && <XCircle      size={13} className="text-red-500" />}
                      {log.status === 'partial'  && <AlertTriangle size={13} className="text-amber-500" />}
                      {log.status === 'running'  && <Clock         size={13} className="text-blue-500" />}
                      <span className={clsx('text-xs font-medium',
                        log.status === 'success' ? 'text-emerald-700' :
                        log.status === 'failed'  ? 'text-red-700' :
                        log.status === 'partial' ? 'text-amber-700' : 'text-blue-700'
                      )}>{log.status}</span>
                    </div>
                    {log.errorMessage && <p className="text-xs text-red-400 mt-0.5">{log.errorMessage}</p>}
                  </Td>
                  <Td className="text-right text-emerald-600 font-medium">+{log.recordsAdded}</Td>
                  <Td className="text-right text-blue-600 font-medium">{log.recordsUpdated}</Td>
                  <Td className="text-right text-slate-400">{log.recordsSkipped}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  )
}
