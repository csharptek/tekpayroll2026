import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { RefreshCw, CheckCircle2, XCircle, Clock, Info } from 'lucide-react'
import { format } from 'date-fns'
import api from '../../services/api'
import { PageHeader, Button, Card, Alert, Table, Th, Td, Tr, EmptyState, Skeleton } from '../../components/ui'
import clsx from 'clsx'

export default function SyncPage() {
  const qc = useQueryClient()
  const [syncing, setSyncing] = useState(false)

  const { data: logs, isLoading } = useQuery({
    queryKey: ['sync-logs'],
    queryFn: () => api.get('/api/sync/logs').then(r => r.data.data),
    refetchInterval: syncing ? 3000 : false,
  })

  const syncMut = useMutation({
    mutationFn: () => api.post('/api/sync/trigger'),
    onMutate: () => setSyncing(true),
    onSettled: () => {
      setSyncing(false)
      qc.invalidateQueries({ queryKey: ['sync-logs'] })
      qc.invalidateQueries({ queryKey: ['employees'] })
    },
  })

  const lastSync  = logs?.[0]
  const isSuccess = lastSync?.status === 'success'
  const isFailed  = lastSync?.status === 'failed'

  return (
    <div className="space-y-5 max-w-4xl">
      <PageHeader
        title="Microsoft 365 Sync"
        subtitle="Sync employees from Entra ID (Azure AD)"
        actions={
          <Button
            icon={<RefreshCw size={14} className={syncing ? 'animate-spin' : ''} />}
            loading={syncMut.isPending}
            onClick={() => syncMut.mutate()}
          >
            Sync Now
          </Button>
        }
      />

      {/* Status overview */}
      <div className="grid grid-cols-3 gap-4">
        <div className="card p-4">
          <p className="stat-label">Last Sync</p>
          <p className="text-sm font-bold text-slate-800 mt-1">
            {lastSync ? format(new Date(lastSync.startedAt), 'dd MMM, HH:mm') : 'Never'}
          </p>
          <p className="text-xs text-slate-400 mt-0.5">{lastSync?.syncType || '—'}</p>
        </div>
        <div className="card p-4">
          <p className="stat-label">Last Status</p>
          <div className="flex items-center gap-2 mt-1">
            {!lastSync       && <span className="text-slate-400 text-sm">—</span>}
            {isSuccess && <><CheckCircle2 size={16} className="text-emerald-500" /><span className="text-sm font-bold text-emerald-700">Success</span></>}
            {isFailed  && <><XCircle      size={16} className="text-red-500" />    <span className="text-sm font-bold text-red-700">Failed</span></>}
          </div>
        </div>
        <div className="card p-4">
          <p className="stat-label">Records (last run)</p>
          {lastSync ? (
            <div className="flex items-center gap-3 mt-1 text-xs">
              <span className="text-emerald-600 font-semibold">+{lastSync.recordsAdded} added</span>
              <span className="text-blue-600 font-semibold">{lastSync.recordsUpdated} updated</span>
              <span className="text-red-500 font-semibold">{lastSync.recordsDeactivated} deactivated</span>
            </div>
          ) : (
            <p className="text-sm text-slate-300 mt-1">—</p>
          )}
        </div>
      </div>

      {/* Config status */}
      <Alert
        type={process.env.NODE_ENV === 'production' ? 'success' : 'info'}
        title="Microsoft 365 Integration"
        message="Employees are synced from your Entra ID tenant. Changes to employee profiles, department, or account status in M365 are reflected here on the next sync. New employees must be assigned a Payroll App Role in Entra ID to access the system."
      />

      {syncMut.isError && (
        <Alert type="error" message={(syncMut.error as any)?.response?.data?.error || 'Sync failed. Check Azure credentials in configuration.'} />
      )}

      {syncMut.isSuccess && (
        <Alert type="success" message="Sync triggered successfully. Employee records have been updated." />
      )}

      {/* What gets synced */}
      <Card title="What Gets Synced">
        <div className="divide-y divide-slate-50">
          {[
            { field: 'Display Name',    source: 'displayName',         note: 'Employee full name' },
            { field: 'Email',           source: 'mail / UPN',          note: 'Login identity and payslip delivery' },
            { field: 'Employee ID',     source: 'employeeId',          note: 'Unique identifier' },
            { field: 'Designation',     source: 'jobTitle',            note: 'Job title / designation' },
            { field: 'Department',      source: 'department',          note: 'Department grouping' },
            { field: 'Mobile',          source: 'mobilePhone',         note: 'Contact number' },
            { field: 'Account Status',  source: 'accountEnabled',      note: 'Blocked in M365 → blocked in payroll' },
            { field: 'Joining Date',    source: 'extension attribute', note: 'Used for proration calculation' },
            { field: 'State',           source: 'extension attribute', note: 'Used for Professional Tax slab lookup' },
          ].map(({ field, source, note }) => (
            <div key={field} className="flex items-center gap-4 px-5 py-2.5 text-sm">
              <span className="w-36 font-medium text-slate-800 flex-shrink-0">{field}</span>
              <span className="w-40 font-mono text-xs text-slate-500 bg-slate-100 px-2 py-0.5 rounded flex-shrink-0">{source}</span>
              <span className="text-xs text-slate-400">{note}</span>
            </div>
          ))}
        </div>
      </Card>

      {/* Not synced (managed in payroll) */}
      <Card title="Managed in Payroll System (Not Synced)">
        <div className="p-4 flex flex-wrap gap-2">
          {['Annual CTC', 'Annual Incentive', 'Bank Details', 'PAN Number', 'Aadhaar', 'PF Number', 'ESI Number', 'UAN', 'TDS Amount', 'LOP Entries'].map(f => (
            <span key={f} className="badge badge-gray">{f}</span>
          ))}
        </div>
      </Card>

      {/* Sync log history */}
      <Card title="Sync History">
        {isLoading ? <Skeleton className="h-48 m-4" /> : !logs?.length ? (
          <EmptyState icon={<RefreshCw size={20} />} title="No sync history" description="Click Sync Now to trigger the first sync." />
        ) : (
          <Table>
            <thead>
              <tr className="border-b border-slate-100">
                <Th>Started At</Th><Th>Type</Th><Th>Status</Th>
                <Th className="text-right">Added</Th><Th className="text-right">Updated</Th>
                <Th className="text-right">Deactivated</Th><Th>Duration</Th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log: any) => {
                const duration = log.completedAt
                  ? `${((new Date(log.completedAt).getTime() - new Date(log.startedAt).getTime()) / 1000).toFixed(1)}s`
                  : '—'
                return (
                  <Tr key={log.id}>
                    <Td><span className="text-xs font-mono">{format(new Date(log.startedAt), 'dd MMM yy, HH:mm:ss')}</span></Td>
                    <Td><span className="badge badge-blue">{log.syncType}</span></Td>
                    <Td>
                      <div className="flex items-center gap-1.5">
                        {log.status === 'success'
                          ? <CheckCircle2 size={13} className="text-emerald-500" />
                          : log.status === 'failed'
                          ? <XCircle      size={13} className="text-red-500" />
                          : <Clock        size={13} className="text-amber-500" />
                        }
                        <span className={clsx('text-xs font-medium',
                          log.status === 'success' ? 'text-emerald-700' :
                          log.status === 'failed'  ? 'text-red-700' : 'text-amber-700'
                        )}>{log.status}</span>
                      </div>
                      {log.errorMessage && (
                        <p className="text-xs text-red-400 mt-0.5">{log.errorMessage}</p>
                      )}
                    </Td>
                    <Td className="text-right text-emerald-600 font-medium">+{log.recordsAdded}</Td>
                    <Td className="text-right text-blue-600 font-medium">{log.recordsUpdated}</Td>
                    <Td className="text-right text-red-500 font-medium">{log.recordsDeactivated}</Td>
                    <Td><span className="text-xs text-slate-400 font-mono">{duration}</span></Td>
                  </Tr>
                )
              })}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  )
}
