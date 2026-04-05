import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, XCircle, Clock, AlertTriangle, RefreshCw, Scissors } from 'lucide-react'
import { leaveApi } from '../../services/api'
import { PageHeader, Button, Alert } from '../../components/ui'
import clsx from 'clsx'

const KIND_LABEL: Record<string, string> = { SICK: 'Sick', CASUAL: 'Casual', PLANNED: 'Planned' }
const KIND_COLOR: Record<string, string> = {
  SICK:    'bg-red-100 text-red-700',
  CASUAL:  'bg-blue-100 text-blue-700',
  PLANNED: 'bg-violet-100 text-violet-700',
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { icon: any; label: string; cls: string }> = {
    PENDING:       { icon: <Clock size={11} />,         label: 'Pending',   cls: 'bg-amber-100 text-amber-700' },
    APPROVED:      { icon: <CheckCircle2 size={11} />,  label: 'Approved',  cls: 'bg-emerald-100 text-emerald-700' },
    AUTO_APPROVED: { icon: <CheckCircle2 size={11} />,  label: 'Auto-Approved', cls: 'bg-emerald-50 text-emerald-600' },
    DECLINED:      { icon: <XCircle size={11} />,       label: 'Declined',  cls: 'bg-red-100 text-red-700' },
    CANCELLED:     { icon: <XCircle size={11} />,       label: 'Cancelled', cls: 'bg-slate-100 text-slate-500' },
    LOP:           { icon: <AlertTriangle size={11} />, label: 'LOP',       cls: 'bg-orange-100 text-orange-700' },
  }
  const s = map[status] || map['PENDING']
  return (
    <span className={clsx('inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium', s.cls)}>
      {s.icon}{s.label}
    </span>
  )
}

export default function HRLeavePage() {
  const qc = useQueryClient()
  const [tab, setTab]               = useState<'applications' | 'cancellations' | 'balances'>('applications')
  const [filterStatus, setFilterStatus] = useState('')
  const [filterKind, setFilterKind]     = useState('')
  const [filterYear, setFilterYear]     = useState(new Date().getFullYear())
  const [page, setPage]                 = useState(1)
  const [error, setError]               = useState('')
  const [success, setSuccess]           = useState('')

  // Inline action state
  const [declineId, setDeclineId]           = useState<string | null>(null)
  const [declineReason, setDeclineReason]   = useState('')
  const [cancelId, setCancelId]             = useState<string | null>(null)
  const [cancelType, setCancelType]         = useState<'FULL' | 'PARTIAL'>('FULL')
  const [newEndDate, setNewEndDate]         = useState('')
  const [cancelReqDeclineId, setCancelReqDeclineId] = useState<string | null>(null)
  const [cancelReqDeclineReason, setCancelReqDeclineReason] = useState('')
  const [cancelReqId, setCancelReqId]       = useState<string | null>(null)
  const [cancelReqNewEnd, setCancelReqNewEnd] = useState('')

  const { data: appsData, isLoading: appsLoading } = useQuery({
    queryKey: ['hr-leave-apps', filterStatus, filterKind, page],
    queryFn: () => leaveApi.allApplications({ status: filterStatus || undefined, leaveKind: filterKind || undefined, page, limit: 30 }).then(r => r.data),
    enabled: tab === 'applications',
  })

  const { data: cancelReqs, isLoading: cancelLoading } = useQuery({
    queryKey: ['hr-cancel-reqs'],
    queryFn: () => leaveApi.cancellationRequests().then(r => r.data.data),
    enabled: tab === 'cancellations',
  })

  const { data: allBalances, isLoading: balLoading } = useQuery({
    queryKey: ['all-leave-balances', filterYear],
    queryFn: () => leaveApi.allBalances(filterYear).then(r => r.data.data),
    enabled: tab === 'balances',
  })

  const approveMutation = useMutation({
    mutationFn: (id: string) => leaveApi.approve(id),
    onSuccess: () => { setSuccess('Leave approved.'); qc.invalidateQueries({ queryKey: ['hr-leave-apps'] }) },
    onError: (e: any) => setError(e?.response?.data?.error || 'Failed'),
  })

  const declineMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => leaveApi.decline(id, reason),
    onSuccess: () => { setSuccess('Leave declined.'); setDeclineId(null); qc.invalidateQueries({ queryKey: ['hr-leave-apps'] }) },
    onError: (e: any) => setError(e?.response?.data?.error || 'Failed'),
  })

  const cancelDirectMutation = useMutation({
    mutationFn: ({ id, newEnd }: { id: string; newEnd?: string }) => leaveApi.cancelDirect(id, newEnd),
    onSuccess: () => { setSuccess('Leave cancelled.'); setCancelId(null); qc.invalidateQueries({ queryKey: ['hr-leave-apps'] }) },
    onError: (e: any) => setError(e?.response?.data?.error || 'Failed'),
  })

  const approveCancelMutation = useMutation({
    mutationFn: ({ id, newEnd }: { id: string; newEnd?: string }) => leaveApi.approveCancellation(id, newEnd),
    onSuccess: () => { setSuccess('Cancellation approved.'); setCancelReqId(null); qc.invalidateQueries({ queryKey: ['hr-cancel-reqs'] }); qc.invalidateQueries({ queryKey: ['hr-leave-apps'] }) },
    onError: (e: any) => setError(e?.response?.data?.error || 'Failed'),
  })

  const declineCancelMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => leaveApi.declineCancellation(id, reason),
    onSuccess: () => { setSuccess('Cancellation declined.'); setCancelReqDeclineId(null); qc.invalidateQueries({ queryKey: ['hr-cancel-reqs'] }) },
    onError: (e: any) => setError(e?.response?.data?.error || 'Failed'),
  })

  const apps       = appsData?.data || []
  const pagination = appsData?.pagination

  return (
    <div className="space-y-4">
      <PageHeader title="Leave Management" subtitle="Manage employee leave applications and balances" />

      {error   && <Alert type="error"   message={error}   />}
      {success && <Alert type="success" message={success} />}

      {/* Tabs */}
      <div className="flex gap-1 bg-slate-100 rounded-xl p-1 w-fit">
        {([
          { key: 'applications',  label: 'Applications' },
          { key: 'cancellations', label: `Cancellation Requests${cancelReqs?.length > 0 ? ` (${cancelReqs.length})` : ''}` },
          { key: 'balances',      label: 'All Balances' },
        ] as const).map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={clsx('px-4 py-1.5 text-xs font-medium rounded-lg transition-colors',
              tab === t.key ? 'bg-white shadow-sm text-slate-800' : 'text-slate-500 hover:text-slate-700'
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── APPLICATIONS TAB ── */}
      {tab === 'applications' && (
        <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
          {/* Filters */}
          <div className="flex flex-wrap gap-3 p-4 border-b border-slate-100">
            <select className="input text-xs py-1.5 px-3 w-36"
              value={filterStatus} onChange={e => { setFilterStatus(e.target.value); setPage(1) }}>
              <option value="">All Statuses</option>
              {['PENDING', 'APPROVED', 'AUTO_APPROVED', 'DECLINED', 'CANCELLED', 'LOP'].map(s =>
                <option key={s} value={s}>{s.replace('_', ' ')}</option>
              )}
            </select>
            <select className="input text-xs py-1.5 px-3 w-32"
              value={filterKind} onChange={e => { setFilterKind(e.target.value); setPage(1) }}>
              <option value="">All Types</option>
              {['SICK', 'CASUAL', 'PLANNED'].map(k => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
            </select>
            <Button variant="secondary" icon={<RefreshCw size={12} />}
              onClick={() => { qc.invalidateQueries({ queryKey: ['hr-leave-apps'] }) }}>
              Refresh
            </Button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[900px]">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-100">
                  {['Employee', 'Type', 'Dates', 'Days', 'Reason', 'Status', 'Applied', 'Actions'].map(h => (
                    <th key={h} className="text-left text-xs font-semibold text-slate-500 px-4 py-3">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {appsLoading ? (
                  <tr><td colSpan={8} className="text-center py-10 text-sm text-slate-400">Loading…</td></tr>
                ) : apps.length === 0 ? (
                  <tr><td colSpan={8} className="text-center py-10 text-sm text-slate-400">No applications found</td></tr>
                ) : apps.map((app: any) => {
                  const start = new Date(app.startDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })
                  const end   = new Date(app.endDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' })
                  const dateStr = app.isHalfDay
                    ? `${start} (${app.halfDaySlot === 'FIRST' ? '1st' : '2nd'} half)`
                    : `${start} – ${end}`
                  const isPending = app.status === 'PENDING'
                  const isActive  = ['APPROVED', 'AUTO_APPROVED', 'PENDING'].includes(app.status)
                  const hasPendingCancel = app.cancellationRequests?.length > 0
                  return (
                    <tr key={app.id} className="border-b border-slate-50 hover:bg-slate-50/50">
                      <td className="px-4 py-2.5">
                        <div className="text-xs font-medium text-slate-800">{app.employee?.name}</div>
                        <div className="text-xs text-slate-400">{app.employee?.employeeCode}</div>
                      </td>
                      <td className="px-4 py-2.5">
                        <span className={clsx('text-xs font-medium px-2 py-0.5 rounded-full', KIND_COLOR[app.leaveKind])}>
                          {KIND_LABEL[app.leaveKind]}
                        </span>
                        {app.isBackdated && <span className="ml-1 text-xs text-slate-400">(backdated)</span>}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-slate-600">{dateStr}</td>
                      <td className="px-4 py-2.5 text-xs font-semibold text-slate-700 text-center">
                        {Number(app.totalDays)}
                        {app.isLop && <div className="text-orange-500 text-xs">LOP</div>}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-slate-500 max-w-[140px]">
                        <div className="truncate" title={app.customReason || app.reasonLabel}>
                          {app.customReason || app.reasonLabel}
                        </div>
                      </td>
                      <td className="px-4 py-2.5"><StatusBadge status={app.status} /></td>
                      <td className="px-4 py-2.5 text-xs text-slate-400">
                        {new Date(app.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {isPending && (
                            <>
                              <button onClick={() => { setError(''); approveMutation.mutate(app.id) }}
                                className="text-xs font-medium text-emerald-600 hover:text-emerald-800 underline underline-offset-2">
                                Approve
                              </button>
                              <button onClick={() => { setDeclineId(app.id); setDeclineReason('') }}
                                className="text-xs font-medium text-red-500 hover:text-red-700 underline underline-offset-2">
                                Decline
                              </button>
                            </>
                          )}
                          {isActive && !hasPendingCancel && (
                            <button onClick={() => { setCancelId(app.id); setCancelType('FULL'); setNewEndDate('') }}
                              className="text-xs font-medium text-slate-500 hover:text-slate-700 underline underline-offset-2">
                              Cancel
                            </button>
                          )}
                          {hasPendingCancel && (
                            <span className="text-xs text-amber-500">Cancel pending</span>
                          )}
                        </div>

                        {/* Inline decline form */}
                        {declineId === app.id && (
                          <div className="mt-2 p-2 bg-red-50 rounded-lg space-y-2">
                            <textarea className="input text-xs w-full" rows={2}
                              placeholder="Decline reason (required)…"
                              value={declineReason}
                              onChange={e => setDeclineReason(e.target.value)}
                            />
                            <div className="flex gap-2">
                              <button onClick={() => setDeclineId(null)} className="text-xs text-slate-500 underline">Cancel</button>
                              <button
                                onClick={() => { if (!declineReason) { setError('Reason required'); return }; declineMutation.mutate({ id: app.id, reason: declineReason }) }}
                                className="text-xs font-medium text-red-600 underline">
                                Confirm Decline
                              </button>
                            </div>
                          </div>
                        )}

                        {/* Inline cancel form */}
                        {cancelId === app.id && (
                          <div className="mt-2 p-2 bg-slate-50 rounded-lg space-y-2">
                            <div className="flex gap-2">
                              <button onClick={() => setCancelType('FULL')}
                                className={clsx('text-xs px-2 py-1 rounded border', cancelType === 'FULL' ? 'bg-slate-700 text-white border-slate-700' : 'border-slate-200 text-slate-500')}>
                                Full Cancel
                              </button>
                              <button onClick={() => setCancelType('PARTIAL')}
                                className={clsx('text-xs px-2 py-1 rounded border flex items-center gap-1', cancelType === 'PARTIAL' ? 'bg-slate-700 text-white border-slate-700' : 'border-slate-200 text-slate-500')}>
                                <Scissors size={10} /> Partial
                              </button>
                            </div>
                            {cancelType === 'PARTIAL' && (
                              <div>
                                <label className="text-xs text-slate-500 block mb-1">New end date</label>
                                <input type="date" className="input text-xs w-full"
                                  value={newEndDate}
                                  max={new Date(app.endDate).toISOString().slice(0, 10)}
                                  onChange={e => setNewEndDate(e.target.value)}
                                />
                              </div>
                            )}
                            <div className="flex gap-2">
                              <button onClick={() => setCancelId(null)} className="text-xs text-slate-500 underline">Close</button>
                              <button
                                onClick={() => cancelDirectMutation.mutate({ id: app.id, newEnd: cancelType === 'PARTIAL' ? newEndDate : undefined })}
                                className="text-xs font-medium text-red-600 underline">
                                Confirm Cancel
                              </button>
                            </div>
                          </div>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {pagination && pagination.total > 30 && (
            <div className="flex justify-between items-center px-4 py-3 border-t border-slate-100 text-xs text-slate-500">
              <span>{pagination.total} total</span>
              <div className="flex gap-2">
                <button disabled={page === 1} onClick={() => setPage(p => p - 1)}
                  className="px-3 py-1 border border-slate-200 rounded-lg disabled:opacity-40">Prev</button>
                <button disabled={page * 30 >= pagination.total} onClick={() => setPage(p => p + 1)}
                  className="px-3 py-1 border border-slate-200 rounded-lg disabled:opacity-40">Next</button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── CANCELLATION REQUESTS TAB ── */}
      {tab === 'cancellations' && (
        <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-100">
                {['Employee', 'Leave Type', 'Leave Period', 'Request Type', 'Requested', 'Reason', 'Actions'].map(h => (
                  <th key={h} className="text-left text-xs font-semibold text-slate-500 px-4 py-3">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {cancelLoading ? (
                <tr><td colSpan={7} className="text-center py-10 text-slate-400 text-sm">Loading…</td></tr>
              ) : (cancelReqs || []).length === 0 ? (
                <tr><td colSpan={7} className="text-center py-10 text-slate-400 text-sm">No pending cancellation requests</td></tr>
              ) : (cancelReqs || []).map((req: any) => {
                const app = req.application
                const start = new Date(app.startDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })
                const end   = new Date(app.endDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' })
                return (
                  <tr key={req.id} className="border-b border-slate-50">
                    <td className="px-4 py-3">
                      <div className="text-xs font-medium text-slate-800">{app.employee?.name}</div>
                      <div className="text-xs text-slate-400">{app.employee?.employeeCode}</div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={clsx('text-xs font-medium px-2 py-0.5 rounded-full', KIND_COLOR[app.leaveKind])}>
                        {KIND_LABEL[app.leaveKind]}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-600">{start} – {end}</td>
                    <td className="px-4 py-3 text-xs text-slate-600">{req.type === 'FULL' ? 'Full Cancel' : 'Partial'}</td>
                    <td className="px-4 py-3 text-xs text-slate-400">
                      {new Date(req.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-500 max-w-[140px] truncate">{req.reason || '—'}</td>
                    <td className="px-4 py-3 space-y-2">
                      <div className="flex gap-2">
                        <button
                          onClick={() => { setCancelReqId(req.id); setCancelReqNewEnd('') }}
                          className="text-xs font-medium text-emerald-600 hover:text-emerald-800 underline underline-offset-2">
                          Approve
                        </button>
                        <button
                          onClick={() => { setCancelReqDeclineId(req.id); setCancelReqDeclineReason('') }}
                          className="text-xs font-medium text-red-500 hover:text-red-700 underline underline-offset-2">
                          Decline
                        </button>
                      </div>

                      {cancelReqId === req.id && (
                        <div className="p-2 bg-emerald-50 rounded-lg space-y-2">
                          <div>
                            <label className="text-xs text-slate-500 block mb-1">New end date (optional for partial)</label>
                            <input type="date" className="input text-xs w-full"
                              value={cancelReqNewEnd}
                              max={new Date(app.endDate).toISOString().slice(0, 10)}
                              onChange={e => setCancelReqNewEnd(e.target.value)}
                            />
                          </div>
                          <div className="flex gap-2">
                            <button onClick={() => setCancelReqId(null)} className="text-xs text-slate-500 underline">Close</button>
                            <button
                              onClick={() => approveCancelMutation.mutate({ id: req.id, newEnd: cancelReqNewEnd || undefined })}
                              className="text-xs font-medium text-emerald-600 underline">
                              Confirm Approve
                            </button>
                          </div>
                        </div>
                      )}

                      {cancelReqDeclineId === req.id && (
                        <div className="p-2 bg-red-50 rounded-lg space-y-2">
                          <textarea className="input text-xs w-full" rows={2}
                            placeholder="Reason for declining…"
                            value={cancelReqDeclineReason}
                            onChange={e => setCancelReqDeclineReason(e.target.value)}
                          />
                          <div className="flex gap-2">
                            <button onClick={() => setCancelReqDeclineId(null)} className="text-xs text-slate-500 underline">Close</button>
                            <button
                              onClick={() => { if (!cancelReqDeclineReason) return; declineCancelMutation.mutate({ id: req.id, reason: cancelReqDeclineReason }) }}
                              className="text-xs font-medium text-red-600 underline">
                              Confirm Decline
                            </button>
                          </div>
                        </div>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ── BALANCES TAB ── */}
      {tab === 'balances' && (
        <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
          <div className="flex items-center justify-between p-4 border-b border-slate-100">
            <p className="text-xs text-slate-500">Leave balances for all active employees</p>
            <select className="input text-xs py-1.5 px-3 w-28"
              value={filterYear} onChange={e => setFilterYear(Number(e.target.value))}>
              {[0, 1].map(i => { const y = new Date().getFullYear() - i; return <option key={y} value={y}>{y}</option> })}
            </select>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[700px]">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-100">
                  <th className="text-left text-xs font-semibold text-slate-500 px-4 py-3">Employee</th>
                  {['Sick', 'Casual', 'Planned'].map(k => (
                    ['Total', 'Used', 'Remaining'].map(m => (
                      <th key={`${k}-${m}`} className="text-center text-xs font-semibold text-slate-500 px-2 py-3">{k} {m}</th>
                    ))
                  ))}
                </tr>
              </thead>
              <tbody>
                {balLoading ? (
                  <tr><td colSpan={10} className="text-center py-10 text-slate-400 text-sm">Loading…</td></tr>
                ) : (allBalances || []).map((emp: any) => {
                  const b = emp.balance
                  const s = (kind: string, field: string) => b[kind]?.[field] ?? '—'
                  return (
                    <tr key={emp.id} className="border-b border-slate-50 hover:bg-slate-50/50">
                      <td className="px-4 py-2.5">
                        <div className="text-xs font-medium text-slate-800">{emp.name}</div>
                        <div className="text-xs text-slate-400">{emp.employeeCode}</div>
                      </td>
                      {['SICK', 'CASUAL', 'PLANNED'].map(k => (
                        ['total', 'used', 'remaining'].map(m => (
                          <td key={`${k}-${m}`} className={clsx(
                            'text-center text-xs px-2 py-2.5',
                            m === 'remaining' ? 'font-semibold' : 'text-slate-500',
                            m === 'remaining' && s(k, m) === 0 ? 'text-red-500' : m === 'remaining' ? 'text-emerald-700' : ''
                          )}>
                            {s(k, m)}
                          </td>
                        ))
                      ))}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
