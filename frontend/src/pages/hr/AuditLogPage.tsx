import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { format } from 'date-fns'
import { ScrollText } from 'lucide-react'
import { auditApi } from '../../services/api'
import { PageHeader, Card, Table, Th, Td, Tr, EmptyState, Skeleton, SearchBar } from '../../components/ui'
import clsx from 'clsx'

const ACTION_COLORS: Record<string, string> = {
  CREATE: 'badge-green', UPDATE: 'badge-blue', DELETE: 'badge-red',
  LOGIN: 'badge-gray', LOGOUT: 'badge-gray',
  PAYROLL_RUN: 'badge-purple', PAYROLL_LOCK: 'badge-purple', PAYROLL_UNLOCK: 'badge-yellow',
  PAYSLIP_GENERATE: 'badge-blue', FNF_APPROVE: 'badge-green',
  LOAN_CREATE: 'badge-blue', LOAN_CLOSE: 'badge-gray',
}

export default function AuditLogPage() {
  const [page, setPage] = useState(1)
  const [action, setAction] = useState('')

  const { data, isLoading } = useQuery({
    queryKey: ['audit-log', page, action],
    queryFn: () => auditApi.list({ page, limit: 50, ...(action && { action }) }).then(r => r.data),
  })

  const logs = data?.data || []
  const total = data?.pagination?.total || 0

  return (
    <div className="space-y-5">
      <PageHeader title="Audit Log" subtitle={`${total} total events`} />

      <Card>
        <div className="p-4 flex gap-3">
          <select value={action} onChange={e => { setAction(e.target.value); setPage(1) }} className="input w-52">
            <option value="">All Actions</option>
            {['CREATE','UPDATE','DELETE','PAYROLL_RUN','PAYROLL_LOCK','PAYROLL_UNLOCK','LOGIN','LOGOUT','LOAN_CREATE'].map(a => (
              <option key={a} value={a}>{a.replace(/_/g, ' ')}</option>
            ))}
          </select>
        </div>

        {isLoading ? <Skeleton className="h-64 m-4" /> : logs.length === 0 ? (
          <EmptyState icon={<ScrollText size={22} />} title="No audit events" description="Actions will appear here as they happen." />
        ) : (
          <Table>
            <thead>
              <tr className="border-b border-slate-100">
                <Th>Timestamp</Th><Th>User</Th><Th>Action</Th><Th>Target</Th><Th>Description</Th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log: any) => (
                <Tr key={log.id}>
                  <Td>
                    <span className="text-xs font-mono text-slate-500">
                      {format(new Date(log.createdAt), 'dd MMM yy, HH:mm:ss')}
                    </span>
                  </Td>
                  <Td>
                    <p className="text-sm font-medium text-slate-800">{log.performedByName}</p>
                    <p className="text-xs text-slate-400">{log.performedByRole}</p>
                  </Td>
                  <Td>
                    <span className={clsx('badge', ACTION_COLORS[log.action] || 'badge-gray')}>
                      {log.action.replace(/_/g, ' ')}
                    </span>
                  </Td>
                  <Td>
                    {log.tableName && (
                      <span className="text-xs font-mono bg-slate-100 px-1.5 py-0.5 rounded text-slate-600">
                        {log.tableName}
                      </span>
                    )}
                  </Td>
                  <Td>
                    <p className="text-xs text-slate-600 max-w-xs truncate">{log.description || '—'}</p>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}

        {total > 50 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-slate-100">
            <p className="text-xs text-slate-500">Page {page} · {total} total</p>
            <div className="flex gap-1">
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1} className="btn-secondary text-xs px-3 py-1.5">Prev</button>
              <button onClick={() => setPage(p => p + 1)} disabled={page * 50 >= total} className="btn-secondary text-xs px-3 py-1.5">Next</button>
            </div>
          </div>
        )}
      </Card>
    </div>
  )
}
