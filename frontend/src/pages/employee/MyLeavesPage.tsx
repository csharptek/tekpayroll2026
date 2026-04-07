import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, X, CheckCircle2, Clock, XCircle, AlertTriangle, ChevronDown, ChevronUp } from 'lucide-react'
import { leaveApi } from '../../services/api'
import { useAuthStore } from '../../store/authStore'
import { PageHeader, Button, Alert } from '../../components/ui'
import { DatePicker } from '../../components/DatePicker'
import clsx from 'clsx'

const KIND_LABEL: Record<string, string> = { SICK: 'Sick Leave', CASUAL: 'Casual Leave', PLANNED: 'Planned Leave' }
const KIND_COLOR: Record<string, string> = {
  SICK:    'bg-red-100 text-red-700',
  CASUAL:  'bg-blue-100 text-blue-700',
  PLANNED: 'bg-violet-100 text-violet-700',
}
const STATUS_ICON: Record<string, any> = {
  PENDING:       <Clock size={13} className="text-amber-500" />,
  APPROVED:      <CheckCircle2 size={13} className="text-emerald-500" />,
  AUTO_APPROVED: <CheckCircle2 size={13} className="text-emerald-400" />,
  DECLINED:      <XCircle size={13} className="text-red-500" />,
  CANCELLED:     <XCircle size={13} className="text-slate-400" />,
  AUTO_CANCELLED:<XCircle size={13} className="text-slate-400" />,
  LOP:           <AlertTriangle size={13} className="text-orange-500" />,
}
const STATUS_LABEL: Record<string, string> = {
  PENDING: 'Pending', APPROVED: 'Approved', AUTO_APPROVED: 'Approved',
  DECLINED: 'Declined', CANCELLED: 'Cancelled', AUTO_CANCELLED: 'Cancelled', LOP: 'LOP',
}

function BalanceCard({ kind, bal }: { kind: string; bal: any }) {
  if (!bal) return null
  const remaining = bal.remaining ?? 0
  const total     = (bal.total ?? 0) + (bal.carryForward ?? 0)
  const pct       = total > 0 ? Math.round((remaining / total) * 100) : 0
  const color     = remaining === 0 ? 'bg-red-500' : remaining <= 2 ? 'bg-amber-500' : 'bg-emerald-500'
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4">
      <div className="flex justify-between items-start mb-3">
        <div>
          <p className="text-xs font-medium text-slate-500">{KIND_LABEL[kind]}</p>
          {bal.carryForward > 0 && (
            <p className="text-xs text-violet-600 mt-0.5">+{bal.carryForward} carried forward</p>
          )}
        </div>
        <span className={clsx('text-2xl font-bold', remaining === 0 ? 'text-red-500' : 'text-slate-800')}>
          {remaining}
        </span>
      </div>
      <div className="w-full bg-slate-100 rounded-full h-1.5 mb-2">
        <div className={clsx('h-1.5 rounded-full transition-all', color)} style={{ width: `${pct}%` }} />
      </div>
      <div className="flex justify-between text-xs text-slate-400">
        <span>{bal.used ?? 0} used</span>
        <span>{bal.pending ?? 0} pending</span>
        <span>{total} total</span>
      </div>
    </div>
  )
}

export default function MyLeavesPage() {
  const qc = useQueryClient()
  const { user } = useAuthStore()
  const [showApply, setShowApply]         = useState(false)
  const [filterYear, setFilterYear]       = useState(new Date().getFullYear())
  const [cancelId, setCancelId]           = useState<string | null>(null)
  const [cancelReason, setCancelReason]   = useState('')
  const [error, setError]                 = useState('')
  const [success, setSuccess]             = useState('')

  // Form state
  const [form, setForm] = useState({
    leaveKind: 'SICK', startDate: '', endDate: '',
    isHalfDay: false, halfDaySlot: 'FIRST',
    reasonId: '', reasonLabel: '', customReason: '',
  })

  const { data: balData }   = useQuery({ queryKey: ['my-leave-balance'], queryFn: () => leaveApi.myBalance().then(r => r.data.data) })
  const { data: reasons }   = useQuery({ queryKey: ['leave-reasons', form.leaveKind], queryFn: () => leaveApi.reasons(form.leaveKind).then(r => r.data.data) })
  const { data: apps }      = useQuery({ queryKey: ['my-applications', filterYear], queryFn: () => leaveApi.myApplications({ year: filterYear }).then(r => r.data.data) })
  const { data: policy }    = useQuery({ queryKey: ['leave-policy'], queryFn: () => leaveApi.policy().then(r => r.data.data) })

  const applyMutation = useMutation({
    mutationFn: (data: any) => leaveApi.apply(data),
    onSuccess: () => {
      setSuccess('Leave application submitted successfully.')
      setShowApply(false)
      setForm({ leaveKind: 'SICK', startDate: '', endDate: '', isHalfDay: false, halfDaySlot: 'FIRST', reasonId: '', reasonLabel: '', customReason: '' })
      qc.invalidateQueries({ queryKey: ['my-leave-balance'] })
      qc.invalidateQueries({ queryKey: ['my-applications'] })
    },
    onError: (err: any) => setError(err?.response?.data?.error || err?.response?.data?.message || 'Failed to apply leave'),
  })

  const cancelMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => leaveApi.requestCancel(id, reason),
    onSuccess: (res) => {
      const d = res.data.data
      setSuccess(d.autoCancelled ? 'Leave cancelled successfully.' : 'Cancellation request submitted to HR.')
      setCancelId(null); setCancelReason('')
      qc.invalidateQueries({ queryKey: ['my-leave-balance'] })
      qc.invalidateQueries({ queryKey: ['my-applications'] })
    },
    onError: (err: any) => setError(err?.response?.data?.error || 'Failed to submit cancellation'),
  })

  const balance = balData || {}

  const { data: myExit } = useQuery({
    queryKey: ['my-exit-status', user?.id],
    queryFn:  () => import('../../services/api').then(m => m.exitApi.get(user!.id).then(r => r.data.data)),
    enabled:  !!user?.id,
  })
  const isOnNotice = myExit?.status === 'ON_NOTICE'
  const today = new Date().toISOString().slice(0, 10)

  function isWeekend(dateStr: string): boolean {
    const d = new Date(dateStr)
    const day = d.getUTCDay()
    return day === 0 || day === 6
  }

  function handleApply() {
    setError('')
    if (!form.startDate || !form.reasonLabel) { setError('Please fill all required fields'); return }
    if (!form.isHalfDay && !form.endDate) { setError('End date is required'); return }

    // Client-side weekend check
    if (!form.isHalfDay) {
      const start = new Date(form.startDate)
      const end   = new Date(form.endDate)
      let allWeekends = true
      const cur = new Date(start)
      while (cur <= end) {
        if (cur.getUTCDay() !== 0 && cur.getUTCDay() !== 6) { allWeekends = false; break }
        cur.setDate(cur.getDate() + 1)
      }
      if (allWeekends) { setError('Selected dates fall on weekends. Please choose working days.'); return }
    } else {
      if (isWeekend(form.startDate)) { setError('Selected date is a weekend. Please choose a working day.'); return }
    }

    const selectedReason = reasons?.find((r: any) => r.id === form.reasonId)
    const label = selectedReason?.label || form.reasonLabel
    const isOther = label === 'Other'
    if (isOther && !form.customReason) { setError('Please describe your reason'); return }
    applyMutation.mutate({
      leaveKind:   form.leaveKind,
      startDate:   form.startDate,
      endDate:     form.isHalfDay ? form.startDate : form.endDate,
      isHalfDay:   form.isHalfDay,
      halfDaySlot: form.isHalfDay ? form.halfDaySlot : undefined,
      reasonId:    form.reasonId || undefined,
      reasonLabel: label,
      customReason: isOther ? form.customReason : undefined,
    })
  }

  function advanceDays(kind: string) {
    if (!policy) return 0
    return { SICK: policy.sickAdvanceDays, CASUAL: policy.casualAdvanceDays, PLANNED: policy.plannedAdvanceDays }[kind] || 0
  }

  const minDate = (() => {
    const adv = advanceDays(form.leaveKind)
    if (adv === 0) return ''
    const d = new Date(); d.setDate(d.getDate() + adv)
    return d.toISOString().slice(0, 10)
  })()

  return (
    <div className="space-y-5">
      <PageHeader
        title="My Leaves"
        subtitle={`${new Date().getFullYear()} leave balances`}
        actions={
          <Button icon={<Plus size={14} />} onClick={() => { setShowApply(!showApply); setError('') }}>
            {showApply ? 'Cancel' : 'Apply Leave'}
          </Button>
        }
      />

      {error   && <Alert type="error"   message={error}   />}
      {success && <Alert type="success" message={success} />}

      {isOnNotice && (
        <div className="flex items-start gap-3 p-3 bg-red-50 border border-red-100 rounded-xl">
          <AlertTriangle size={15} className="text-red-500 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-red-700">Notice Period — No Paid Leaves</p>
            <p className="text-xs text-red-600 mt-0.5">
              You are currently on notice period. Any leave you apply for will be automatically marked as <strong>Loss of Pay (LOP)</strong>. Paid leave conversion requires Super Admin approval.
            </p>
          </div>
        </div>
      )}

      {/* Balance Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <BalanceCard kind="SICK"    bal={balance['SICK']}    />
        <BalanceCard kind="CASUAL"  bal={balance['CASUAL']}  />
        <BalanceCard kind="PLANNED" bal={balance['PLANNED']} />
      </div>

      {/* Apply Form */}
      {showApply && (
        <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4">
          <h3 className="text-sm font-semibold text-slate-800">Apply for Leave</h3>

          {/* Leave Kind */}
          <div className="grid grid-cols-3 gap-2">
            {['SICK', 'CASUAL', 'PLANNED'].map(k => (
              <button key={k} type="button"
                onClick={() => setForm(f => ({ ...f, leaveKind: k, reasonId: '', reasonLabel: '' }))}
                className={clsx(
                  'py-2 px-3 rounded-xl text-xs font-semibold border transition-colors',
                  form.leaveKind === k
                    ? 'bg-brand-600 text-white border-brand-600'
                    : 'bg-white text-slate-600 border-slate-200 hover:border-brand-300'
                )}
              >
                {KIND_LABEL[k]}
              </button>
            ))}
          </div>

          {policy && advanceDays(form.leaveKind) > 0 && (
            <p className="text-xs text-amber-600 bg-amber-50 rounded-lg px-3 py-2">
              ⚠️ {KIND_LABEL[form.leaveKind]} requires at least {advanceDays(form.leaveKind)} day(s) advance notice.
              {form.leaveKind === 'SICK' ? ' Backdated sick leave will be auto-approved.' : ''}
              {form.leaveKind === 'CASUAL' ? ' Backdated casual leave requires manual HR approval.' : ''}
            </p>
          )}

          {/* Half Day Toggle */}
          <div className="flex items-center gap-3">
            <label className="text-xs font-medium text-slate-600">Half Day</label>
            <button type="button"
              onClick={() => setForm(f => ({ ...f, isHalfDay: !f.isHalfDay }))}
              className={clsx('w-9 h-5 rounded-full transition-colors relative', form.isHalfDay ? 'bg-brand-600' : 'bg-slate-200')}
            >
              <span className={clsx('absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform', form.isHalfDay ? 'translate-x-4' : 'translate-x-0.5')} />
            </button>
          </div>

          {/* Half Day Slot */}
          {form.isHalfDay && (
            <div className="grid grid-cols-2 gap-2">
              {[
                { value: 'FIRST',  label: '1st Half', sub: `${policy?.firstHalfStart || '09:00'} – ${policy?.firstHalfEnd || '13:30'}` },
                { value: 'SECOND', label: '2nd Half', sub: `${policy?.secondHalfStart || '13:30'} – ${policy?.secondHalfEnd || '18:00'}` },
              ].map(slot => (
                <button key={slot.value} type="button"
                  onClick={() => setForm(f => ({ ...f, halfDaySlot: slot.value }))}
                  className={clsx(
                    'py-2 px-3 rounded-xl text-xs border transition-colors text-left',
                    form.halfDaySlot === slot.value
                      ? 'bg-brand-50 border-brand-400 text-brand-700'
                      : 'bg-white border-slate-200 text-slate-600 hover:border-brand-200'
                  )}
                >
                  <div className="font-semibold">{slot.label}</div>
                  <div className="text-slate-400">{slot.sub}</div>
                </button>
              ))}
            </div>
          )}

          {/* Dates */}
          <div className={clsx('grid gap-3', form.isHalfDay ? 'grid-cols-1' : 'grid-cols-2')}>
            <div>
              <label className="text-xs font-medium text-slate-600 block mb-1">
                {form.isHalfDay ? 'Date' : 'Start Date'} <span className="text-red-400">*</span>
              </label>
              <DatePicker
                value={form.startDate}
                onChange={v => setForm(f => ({ ...f, startDate: v, endDate: v }))}
              />
            </div>
            {!form.isHalfDay && (
              <div>
                <label className="text-xs font-medium text-slate-600 block mb-1">End Date <span className="text-red-400">*</span></label>
                <DatePicker
                  value={form.endDate}
                  onChange={v => setForm(f => ({ ...f, endDate: v }))}
                />
              </div>
            )}
          </div>

          {/* Reason */}
          <div>
            <label className="text-xs font-medium text-slate-600 block mb-1">Reason <span className="text-red-400">*</span></label>
            <select className="input w-full text-sm"
              value={form.reasonId}
              onChange={e => {
                const r = reasons?.find((x: any) => x.id === e.target.value)
                setForm(f => ({ ...f, reasonId: e.target.value, reasonLabel: r?.label || '' }))
              }}
            >
              <option value="">Select reason…</option>
              {(reasons || []).map((r: any) => <option key={r.id} value={r.id}>{r.label}</option>)}
            </select>
          </div>

          {/* Custom reason if Other */}
          {form.reasonLabel === 'Other' && (
            <div>
              <label className="text-xs font-medium text-slate-600 block mb-1">Please describe <span className="text-red-400">*</span></label>
              <textarea className="input w-full text-sm" rows={2}
                value={form.customReason}
                onChange={e => setForm(f => ({ ...f, customReason: e.target.value }))}
                placeholder="Describe your reason…"
              />
            </div>
          )}

          <div className="flex gap-3 justify-end pt-1">
            <Button variant="secondary" onClick={() => setShowApply(false)}>Cancel</Button>
            <Button loading={applyMutation.isPending} onClick={handleApply}>Submit Application</Button>
          </div>
        </div>
      )}

      {/* Applications Table */}
      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100">
          <h3 className="text-sm font-semibold text-slate-700">My Applications</h3>
          <select className="input text-xs py-1 px-2 w-28"
            value={filterYear}
            onChange={e => setFilterYear(Number(e.target.value))}
          >
            {[0, 1, 2].map(i => {
              const y = new Date().getFullYear() - i
              return <option key={y} value={y}>{y}</option>
            })}
          </select>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-100">
                <th className="text-left text-xs font-semibold text-slate-500 px-4 py-3">Type</th>
                <th className="text-left text-xs font-semibold text-slate-500 px-4 py-3">Dates</th>
                <th className="text-center text-xs font-semibold text-slate-500 px-4 py-3">Days</th>
                <th className="text-left text-xs font-semibold text-slate-500 px-4 py-3">Reason</th>
                <th className="text-center text-xs font-semibold text-slate-500 px-4 py-3">Status</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {(apps || []).length === 0 ? (
                <tr><td colSpan={6} className="text-center py-10 text-sm text-slate-400">No applications for {filterYear}</td></tr>
              ) : (apps || []).map((app: any) => {
                const start = new Date(app.startDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })
                const end   = new Date(app.endDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
                const dateStr = app.isHalfDay
                  ? `${start} (${app.halfDaySlot === 'FIRST' ? '1st half' : '2nd half'})`
                  : `${start} – ${end}`
                const canCancel = ['PENDING', 'APPROVED', 'AUTO_APPROVED'].includes(app.status)
                const hasPendingCancelReq = app.cancellationRequests?.length > 0
                return (
                  <tr key={app.id} className="border-b border-slate-50 hover:bg-slate-50/50">
                    <td className="px-4 py-3">
                      <span className={clsx('text-xs font-medium px-2 py-0.5 rounded-full', KIND_COLOR[app.leaveKind])}>
                        {KIND_LABEL[app.leaveKind]}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-600">{dateStr}</td>
                    <td className="px-4 py-3 text-center text-xs font-semibold text-slate-700">
                      {Number(app.totalDays)}
                      {app.isLop && <span className="ml-1 text-orange-500 text-xs">(LOP)</span>}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-500 max-w-[160px] truncate">
                      {app.customReason || app.reasonLabel}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-center gap-1">
                        {STATUS_ICON[app.status]}
                        <span className="text-xs text-slate-600">{STATUS_LABEL[app.status]}</span>
                      </div>
                      {app.declineReason && (
                        <p className="text-xs text-red-500 text-center mt-0.5 max-w-[120px] truncate" title={app.declineReason}>
                          {app.declineReason}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {canCancel && !hasPendingCancelReq && (
                        <button
                          onClick={() => { setCancelId(app.id); setCancelReason(''); setError('') }}
                          className="text-xs text-red-500 hover:text-red-700 underline underline-offset-2"
                        >
                          Cancel
                        </button>
                      )}
                      {hasPendingCancelReq && (
                        <span className="text-xs text-amber-500">Cancel requested</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Cancellation Modal */}
      {cancelId && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl p-6 max-w-md w-full space-y-4">
            <h3 className="text-sm font-semibold text-slate-800">Request Leave Cancellation</h3>
            <p className="text-xs text-slate-500">
              If the leave hasn't started yet, it will be cancelled immediately.
              If it has already started, your request will be sent to HR for approval.
            </p>
            <div>
              <label className="text-xs font-medium text-slate-600 block mb-1">Reason (optional)</label>
              <textarea className="input w-full text-sm" rows={2}
                value={cancelReason}
                onChange={e => setCancelReason(e.target.value)}
                placeholder="Reason for cancellation…"
              />
            </div>
            <div className="flex gap-3 justify-end">
              <Button variant="secondary" onClick={() => setCancelId(null)}>Close</Button>
              <Button
                loading={cancelMutation.isPending}
                onClick={() => cancelMutation.mutate({ id: cancelId, reason: cancelReason })}
                className="bg-red-600 hover:bg-red-700"
              >
                Submit Request
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
