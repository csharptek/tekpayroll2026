import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Save, AlertTriangle, CheckSquare, Square, Clock, Shield,
  FileCheck, User, Unlock, UserMinus, RotateCcw, ChevronDown, ChevronUp,
  Calendar, IndianRupee,
} from 'lucide-react'
import { exitApi, fnfApi } from '../../services/api'
import { Field, inp, sel } from './shared'
import { Button, Alert } from '../ui'
import { DatePicker } from '../DatePicker'

const EXIT_TYPES = ['RESIGNED', 'TERMINATED', 'ABSCONDED']

function SectionHeader({ icon: Icon, title, color = 'text-brand-600', bg = 'bg-brand-50' }: any) {
  return (
    <div className="flex items-center gap-2 mb-4">
      <div className={`w-6 h-6 rounded-lg ${bg} flex items-center justify-center`}>
        <Icon size={13} className={color} />
      </div>
      <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide">{title}</p>
    </div>
  )
}

function DaysRemaining({ expectedLwd, lastWorkingDay }: { expectedLwd: string; lastWorkingDay?: string }) {
  const lwd  = new Date(lastWorkingDay || expectedLwd)
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const diff  = Math.ceil((lwd.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
  const color = diff <= 7 ? 'text-red-600 bg-red-50' : diff <= 30 ? 'text-amber-600 bg-amber-50' : 'text-emerald-600 bg-emerald-50'
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${color}`}>
      <Clock size={11} />
      {diff > 0 ? `${diff} days remaining` : 'LWD reached'}
    </span>
  )
}

function ClearanceRow({ label, done, doneAt, doneByName, onToggle, disabled }: any) {
  return (
    <div className="flex items-center justify-between py-2.5 border-b border-slate-100 last:border-0">
      <div className="flex items-center gap-2">
        <button onClick={() => !disabled && onToggle(!done)} disabled={disabled} className="text-slate-500">
          {done
            ? <CheckSquare size={16} className="text-emerald-500" />
            : <Square size={16} className="text-slate-300" />}
        </button>
        <span className="text-sm text-slate-700">{label}</span>
      </div>
      {done && doneByName && (
        <span className="text-xs text-slate-400">{doneByName} · {doneAt ? new Date(doneAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : ''}</span>
      )}
    </div>
  )
}

function fmt(d: string | Date) {
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

function TentativeFnfPanel({ empId, lwdDate }: { empId: string; lwdDate: string }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['fnf-preview', empId, lwdDate],
    queryFn:  () => fnfApi.preview(empId, new Date(lwdDate).toISOString()).then(r => r.data.data),
    enabled:  !!lwdDate,
    retry:    false,
  })

  if (isLoading) return <p className="text-xs text-slate-400 py-2">Calculating...</p>
  if (error)     return <p className="text-xs text-red-500 py-2">Could not calculate — ensure resignation date is set.</p>
  if (!data)     return null

  const additions  = data.breakdown.filter((b: any) => b.type === 'addition')
  const deductions = data.breakdown.filter((b: any) => b.type === 'deduction')

  return (
    <div className="mt-3 bg-slate-50 border border-slate-200 rounded-xl overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-200 bg-white">
        <IndianRupee size={13} className="text-brand-600" />
        <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Tentative F&amp;F Calculation</p>
        <span className="ml-auto text-xs text-slate-400">LWD: {fmt(lwdDate)} · {data.salaryDays} days salary</span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-0 divide-y sm:divide-y-0 sm:divide-x divide-slate-200">
        {/* Additions */}
        <div className="px-4 py-3">
          <p className="text-xs font-medium text-emerald-700 mb-2">Earnings</p>
          <div className="space-y-1.5">
            {additions.map((b: any) => (
              <div key={b.label} className="flex justify-between text-xs">
                <span className="text-slate-600">{b.label}</span>
                <span className="font-medium text-slate-800">₹{Number(b.amount).toLocaleString('en-IN', { maximumFractionDigits: 0 })}</span>
              </div>
            ))}
          </div>
          <div className="flex justify-between text-xs font-semibold text-emerald-700 mt-2 pt-2 border-t border-slate-200">
            <span>Total Earnings</span>
            <span>₹{Number(data.totalAdditions).toLocaleString('en-IN', { maximumFractionDigits: 0 })}</span>
          </div>
        </div>
        {/* Deductions */}
        <div className="px-4 py-3">
          <p className="text-xs font-medium text-red-600 mb-2">Deductions</p>
          <div className="space-y-1.5">
            {deductions.map((b: any) => (
              <div key={b.label} className="flex justify-between text-xs">
                <span className="text-slate-600">{b.label}</span>
                <span className="font-medium text-red-700">−₹{Number(b.amount).toLocaleString('en-IN', { maximumFractionDigits: 0 })}</span>
              </div>
            ))}
            {deductions.length === 0 && <p className="text-xs text-slate-400">No deductions</p>}
          </div>
          <div className="flex justify-between text-xs font-semibold text-red-600 mt-2 pt-2 border-t border-slate-200">
            <span>Total Deductions</span>
            <span>−₹{Number(data.totalDeductions).toLocaleString('en-IN', { maximumFractionDigits: 0 })}</span>
          </div>
        </div>
      </div>
      {/* Net */}
      <div className="px-4 py-3 bg-white border-t border-slate-200 flex items-center justify-between">
        <span className="text-sm font-semibold text-slate-700">Net Payable</span>
        <span className="text-base font-bold text-brand-600">₹{Number(data.netPayable).toLocaleString('en-IN', { maximumFractionDigits: 0 })}</span>
      </div>
      <p className="text-xs text-slate-400 px-4 pb-3">* Tentative estimate. Actual F&amp;F may vary based on final approvals.</p>
    </div>
  )
}

export default function ExitTab({ emp, isHR, isSuperAdmin, onSaved }: {
  emp: any; isHR: boolean; isSuperAdmin: boolean; onSaved: () => void
}) {
  const qc = useQueryClient()
  const [error, setError]     = useState('')
  const [success, setSuccess] = useState('')
  const [showLop, setShowLop] = useState(false)

  const { data: exitData, isLoading } = useQuery({
    queryKey: ['exit', emp.id],
    queryFn:  () => exitApi.get(emp.id).then(r => r.data.data),
  })

  // Details form
  const [details, setDetails] = useState({
    exitType:           emp.exitType          || 'RESIGNED',
    resignationDate:    emp.resignationDate?.slice(0, 10) || '',
    lastWorkingDay:     emp.lastWorkingDay?.slice(0, 10)  || '',
    noticePeriodDays:   String(emp.noticePeriodDays || 90),
    noticePeriodServed: emp.noticePeriodServed || false,
    buyoutAmount:       emp.buyoutAmount       || '',
  })

  // LWD panel state
  const [lwdMode, setLwdMode]   = useState<'view' | 'edit'>('view')
  const [previewLwd, setPreviewLwd] = useState(emp.lastWorkingDay?.slice(0, 10) || emp.expectedLwd?.slice(0, 10) || '')

  // Sync previewLwd when exitData loads
  useEffect(() => {
    if (exitData) {
      const lwd = exitData.lastWorkingDay?.slice(0, 10) || exitData.expectedLwd?.slice(0, 10) || ''
      setPreviewLwd(lwd)
      setDetails(p => ({
        ...p,
        exitType:        exitData.exitType         || p.exitType,
        resignationDate: exitData.resignationDate?.slice(0, 10) || p.resignationDate,
        lastWorkingDay:  lwd,
        noticePeriodDays: String(exitData.noticePeriodDays || p.noticePeriodDays),
      }))
    }
  }, [exitData])

  // Interview form
  const [interview, setInterview] = useState({
    isDone:        exitData?.exitInterview?.isDone        || false,
    interviewDate: exitData?.exitInterview?.interviewDate?.slice(0, 10) || '',
    notes:         exitData?.exitInterview?.notes         || '',
  })

  const detailsMut = useMutation({
    mutationFn: () => exitApi.updateDetails(emp.id, {
      exitType:          details.exitType,
      resignationDate:   details.resignationDate ? new Date(details.resignationDate).toISOString() : undefined,
      noticePeriodServed:details.noticePeriodServed,
      buyoutAmount:      details.buyoutAmount || undefined,
    }),
    onSuccess: () => { setSuccess('Exit details saved'); onSaved(); qc.invalidateQueries({ queryKey: ['exit', emp.id] }) },
    onError:   (e: any) => setError(e?.response?.data?.error || 'Save failed'),
  })

  const lwdMut = useMutation({
    mutationFn: (payload: { lastWorkingDay: string; noticePeriodDays?: number }) =>
      exitApi.updateDetails(emp.id, {
        lastWorkingDay:  new Date(payload.lastWorkingDay).toISOString(),
        noticePeriodDays: payload.noticePeriodDays,
      }),
    onSuccess: () => {
      setSuccess('Last working day updated')
      setLwdMode('view')
      onSaved()
      qc.invalidateQueries({ queryKey: ['exit', emp.id] })
      qc.invalidateQueries({ queryKey: ['fnf-preview', emp.id] })
    },
    onError: (e: any) => setError(e?.response?.data?.error || 'Save failed'),
  })

  const clearanceMut = useMutation({
    mutationFn: (data: any) => exitApi.updateClearance(emp.id, data),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ['exit', emp.id] }),
    onError:    (e: any) => setError(e?.response?.data?.error || 'Save failed'),
  })

  const interviewMut = useMutation({
    mutationFn: () => exitApi.updateInterview(emp.id, {
      isDone:        interview.isDone,
      interviewDate: interview.interviewDate ? new Date(interview.interviewDate).toISOString() : undefined,
      notes:         interview.notes,
    }),
    onSuccess: () => { setSuccess('Interview saved'); qc.invalidateQueries({ queryKey: ['exit', emp.id] }) },
    onError:   (e: any) => setError(e?.response?.data?.error || 'Save failed'),
  })

  const ffUnlockMut = useMutation({
    mutationFn: () => exitApi.unlockFf(emp.id),
    onSuccess:  () => { setSuccess('F&F unlocked'); qc.invalidateQueries({ queryKey: ['exit', emp.id] }); onSaved() },
    onError:    (e: any) => setError(e?.response?.data?.error || 'Failed'),
  })

  const enableWithdrawalMut = useMutation({
    mutationFn: (enabled: boolean) => exitApi.enableWithdrawal(emp.id, enabled),
    onSuccess:  () => { qc.invalidateQueries({ queryKey: ['exit', emp.id] }); onSaved() },
    onError:    (e: any) => setError(e?.response?.data?.error || 'Failed'),
  })

  const separateMut = useMutation({
    mutationFn: () => exitApi.separate(emp.id),
    onSuccess:  () => { setSuccess('Employee separated'); onSaved(); qc.invalidateQueries({ queryKey: ['exit', emp.id] }) },
    onError:    (e: any) => setError(e?.response?.data?.error || 'Failed'),
  })

  const convertLopMut = useMutation({
    mutationFn: (applicationId: string) => exitApi.convertLop(emp.id, applicationId),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ['exit', emp.id] } as any),
    onError:    (e: any) => setError(e?.response?.data?.error || 'Failed'),
  })

  const { data: lopLeaves } = useQuery({
    queryKey: ['lop-leaves', emp.id],
    queryFn:  () => exitApi.lopLeaves(emp.id).then(r => r.data.data),
    enabled:  isSuperAdmin && showLop,
  })

  if (isLoading) return <div className="text-sm text-slate-400 p-4">Loading...</div>

  const ed       = exitData
  const cl       = ed?.exitClearance
  const iv       = ed?.exitInterview
  const allClear = cl?.itClearance && cl?.assetReturned && cl?.financeClearance && cl?.managerClearance
  const expectedLwd = ed?.expectedLwd || emp.expectedLwd
  const confirmedLwd = ed?.lastWorkingDay || emp.lastWorkingDay

  return (
    <div className="space-y-6">
      {error   && <Alert type="error"   message={error} />}
      {success && <Alert type="success" message={success} />}

      {/* ── Section 1: Employee-submitted resignation info ─────────────── */}
      {ed?.resignationSubmittedAt && (
        <div className="space-y-3">
          <SectionHeader icon={User} title="Resignation Submitted by Employee" />
          <div className="bg-slate-50 rounded-xl p-4 space-y-2">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              <div>
                <p className="text-xs text-slate-400 mb-0.5">Submitted On</p>
                <p className="text-sm font-medium text-slate-700">
                  {fmt(ed.resignationSubmittedAt)}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-400 mb-0.5">Last Working Day</p>
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-slate-700">
                    {confirmedLwd ? fmt(confirmedLwd) : (expectedLwd ? fmt(expectedLwd) : '—')}
                  </p>
                  {(confirmedLwd || expectedLwd) && emp.status === 'ON_NOTICE' && (
                    <DaysRemaining expectedLwd={expectedLwd || confirmedLwd} lastWorkingDay={confirmedLwd || undefined} />
                  )}
                </div>
              </div>
              <div>
                <p className="text-xs text-slate-400 mb-0.5">Notice Period</p>
                <p className="text-sm font-medium text-slate-700">
                  {ed.noticePeriodDays ?? 90} days
                </p>
              </div>
            </div>
            {ed.resignationReason && (
              <div className="pt-2 border-t border-slate-200">
                <p className="text-xs text-slate-400 mb-1">Reason</p>
                <p className="text-sm text-slate-600 whitespace-pre-wrap">{ed.resignationReason}</p>
              </div>
            )}
            {ed.resignationRequests && (
              <div>
                <p className="text-xs text-slate-400 mb-1">Employee Requests</p>
                <p className="text-sm text-slate-600 whitespace-pre-wrap">{ed.resignationRequests}</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Section 2: Last Working Day Management (HR/SA) ─────────────── */}
      {isHR && emp.status === 'ON_NOTICE' && (
        <div className="space-y-3 pt-2 border-t border-slate-100">
          <SectionHeader icon={Calendar} title="Last Working Day" color="text-amber-600" bg="bg-amber-50" />

          <div className="bg-white border border-slate-200 rounded-xl p-4">
            {lwdMode === 'view' ? (
              <div className="flex items-center justify-between flex-wrap gap-3">
                <div>
                  <p className="text-xs text-slate-400 mb-1">Confirmed Last Working Day</p>
                  <p className="text-sm font-semibold text-slate-800">
                    {confirmedLwd ? fmt(confirmedLwd) : <span className="text-slate-400">Not yet confirmed</span>}
                  </p>
                  <p className="text-xs text-slate-400 mt-0.5">Notice period: {ed?.noticePeriodDays ?? 90} days</p>
                </div>
                <Button variant="secondary" icon={<Calendar size={14} />} onClick={() => setLwdMode('edit')}>
                  Change Last Working Day
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Field label="Last Working Day">
                    <DatePicker
                      value={previewLwd}
                      onChange={v => {
                        setPreviewLwd(v)
                        // Auto-calc notice days from resignation date
                        if (v && (ed?.resignationDate || emp.resignationDate)) {
                          const resDate = new Date(ed?.resignationDate || emp.resignationDate)
                          const lwdDate = new Date(v)
                          const days = Math.round((lwdDate.getTime() - resDate.getTime()) / (1000 * 60 * 60 * 24)) + 1
                          setDetails(p => ({ ...p, lastWorkingDay: v, noticePeriodDays: String(Math.max(1, days)) }))
                        } else {
                          setDetails(p => ({ ...p, lastWorkingDay: v }))
                        }
                      }}
                    />
                  </Field>
                  <Field label="Notice Period (days)">
                    <input
                      className={inp}
                      type="number"
                      min="1"
                      value={details.noticePeriodDays}
                      onChange={e => {
                        const days = Number(e.target.value)
                        setDetails(p => ({ ...p, noticePeriodDays: e.target.value }))
                        // Recalc LWD from resignation date + notice days
                        if (days > 0 && (ed?.resignationDate || emp.resignationDate)) {
                          const resDate = new Date(ed?.resignationDate || emp.resignationDate)
                          const newLwd = new Date(resDate)
                          newLwd.setDate(newLwd.getDate() + days - 1)
                          const v = newLwd.toISOString().slice(0, 10)
                          setPreviewLwd(v)
                          setDetails(p => ({ ...p, lastWorkingDay: v, noticePeriodDays: e.target.value }))
                        }
                      }}
                    />
                  </Field>
                </div>
                <div className="flex items-center gap-2 justify-end flex-wrap">
                  <Button variant="ghost" onClick={() => setLwdMode('view')}>Cancel</Button>
                  <Button
                    icon={<Save size={14} />}
                    loading={lwdMut.isPending}
                    onClick={() => {
                      setError(''); setSuccess('')
                      lwdMut.mutate({
                        lastWorkingDay:  details.lastWorkingDay || previewLwd,
                        noticePeriodDays: Number(details.noticePeriodDays) || undefined,
                      })
                    }}
                  >
                    Confirm Last Working Day
                  </Button>
                </div>
              </div>
            )}

            {/* Tentative FnF always shown below LWD */}
            {previewLwd && (
              <TentativeFnfPanel empId={emp.id} lwdDate={previewLwd} />
            )}
          </div>
        </div>
      )}

      {/* ── Section 3: Exit Details ────────────────────────────────────── */}
      <div className="space-y-3">
        <SectionHeader icon={FileCheck} title="Exit Details" />

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Exit Type">
            <select className={sel} value={details.exitType} disabled={!isHR}
              onChange={e => setDetails(p => ({ ...p, exitType: e.target.value }))}>
              {EXIT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </Field>
          <Field label="Resignation Date">
            <DatePicker value={details.resignationDate} disabled={!isHR}
              onChange={v => setDetails(p => ({ ...p, resignationDate: v }))} />
          </Field>
          <Field label="Notice Period Buyout (₹)">
            <input className={inp} type="number" placeholder="0" value={details.buyoutAmount} disabled={!isHR}
              onChange={e => setDetails(p => ({ ...p, buyoutAmount: e.target.value }))} />
          </Field>
        </div>

        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" className="w-4 h-4 rounded" checked={details.noticePeriodServed} disabled={!isHR}
            onChange={e => setDetails(p => ({ ...p, noticePeriodServed: e.target.checked }))} />
          <span className="text-sm text-slate-600">Notice period served</span>
        </label>

        {isHR && (
          <div className="flex justify-end">
            <Button icon={<Save size={14} />} loading={detailsMut.isPending}
              onClick={() => { setError(''); setSuccess(''); detailsMut.mutate() }}>
              Save Exit Details
            </Button>
          </div>
        )}
      </div>

      {/* ── Section 4: Exit Interview ──────────────────────────────────── */}
      <div className="space-y-3 pt-4 border-t border-slate-100">
        <SectionHeader icon={User} title="Exit Interview" color="text-violet-600" bg="bg-violet-50" />

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Interview Date">
            <DatePicker value={interview.interviewDate} disabled={!isHR}
              onChange={v => setInterview(p => ({ ...p, interviewDate: v }))} />
          </Field>
          <Field label="Status">
            <div className="flex items-center gap-2 pt-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" className="w-4 h-4 rounded" disabled={!isHR}
                  checked={interview.isDone}
                  onChange={e => setInterview(p => ({ ...p, isDone: e.target.checked }))} />
                <span className="text-sm text-slate-600">Interview completed</span>
              </label>
            </div>
          </Field>
        </div>

        <Field label="Interview Notes">
          <textarea className={`${inp} resize-none`} rows={3} disabled={!isHR}
            placeholder="Notes from the exit interview..."
            value={interview.notes}
            onChange={e => setInterview(p => ({ ...p, notes: e.target.value }))} />
        </Field>

        {isHR && (
          <div className="flex justify-end">
            <Button variant="secondary" icon={<Save size={14} />} loading={interviewMut.isPending}
              onClick={() => { setError(''); setSuccess(''); interviewMut.mutate() }}>
              Save Interview
            </Button>
          </div>
        )}
      </div>

      {/* ── Section 5: Clearance Checklist ────────────────────────────── */}
      <div className="space-y-3 pt-4 border-t border-slate-100">
        <SectionHeader icon={CheckSquare} title="Clearance Checklist" color="text-emerald-600" bg="bg-emerald-50" />

        <div className="bg-white border border-slate-200 rounded-xl px-4">
          <ClearanceRow
            label="IT Clearance" done={cl?.itClearance} doneAt={cl?.itClearedAt} doneByName={cl?.itClearedByName}
            disabled={!isHR}
            onToggle={(v: boolean) => { setError(''); clearanceMut.mutate({ itClearance: v }) }}
          />
          <ClearanceRow
            label="Asset Returned" done={cl?.assetReturned} doneAt={cl?.assetReturnedAt} doneByName={cl?.assetReturnedByName}
            disabled={!isHR}
            onToggle={(v: boolean) => { setError(''); clearanceMut.mutate({ assetReturned: v }) }}
          />
          <ClearanceRow
            label="Finance Clearance" done={cl?.financeClearance} doneAt={cl?.financeClearedAt} doneByName={cl?.financeClearedByName}
            disabled={!isHR}
            onToggle={(v: boolean) => { setError(''); clearanceMut.mutate({ financeClearance: v }) }}
          />
          <ClearanceRow
            label="Manager Clearance" done={cl?.managerClearance} doneAt={cl?.managerClearedAt} doneByName={cl?.managerClearedByName}
            disabled={!isHR}
            onToggle={(v: boolean) => { setError(''); clearanceMut.mutate({ managerClearance: v }) }}
          />
        </div>

        {allClear && (
          <div className="flex items-center gap-2 text-emerald-600 text-xs font-medium">
            <CheckSquare size={13} /> All clearances complete
          </div>
        )}
      </div>

      {/* ── Section 6: F&F & Separation (Super Admin only) ─────────────── */}
      {isSuperAdmin && (
        <div className="space-y-3 pt-4 border-t border-slate-100">
          <SectionHeader icon={Shield} title="F&F & Final Separation" color="text-red-600" bg="bg-red-50" />

          <div className="flex items-center gap-3 flex-wrap">
            {!cl?.ffUnlocked ? (
              <Button
                variant="secondary"
                icon={<Unlock size={14} />}
                loading={ffUnlockMut.isPending}
                disabled={!allClear}
                onClick={() => { setError(''); setSuccess(''); ffUnlockMut.mutate() }}
              >
                Unlock F&F
              </Button>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-600 bg-emerald-50 px-3 py-1.5 rounded-full">
                <CheckSquare size={12} /> F&F Unlocked
              </span>
            )}

            {emp.status === 'ON_NOTICE' && (
              <Button
                variant="danger"
                icon={<UserMinus size={14} />}
                loading={separateMut.isPending}
                disabled={!cl?.ffUnlocked}
                onClick={() => {
                  if (window.confirm(`Separate ${emp.name}? This is irreversible.`)) {
                    setError(''); setSuccess(''); separateMut.mutate()
                  }
                }}
              >
                Separate Employee
              </Button>
            )}

            {emp.status === 'ON_NOTICE' && (
              <Button
                variant="ghost"
                icon={<RotateCcw size={14} />}
                loading={enableWithdrawalMut.isPending}
                onClick={() => enableWithdrawalMut.mutate(!ed?.withdrawalEnabled)}
              >
                {ed?.withdrawalEnabled ? 'Disable Withdrawal' : 'Enable Withdrawal'}
              </Button>
            )}
          </div>

          {!allClear && (
            <p className="text-xs text-slate-400">Complete all clearances to unlock F&F and separation.</p>
          )}

          {/* LOP → Paid conversion */}
          <div className="pt-2">
            <button
              className="flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-700"
              onClick={() => setShowLop(p => !p)}
            >
              {showLop ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
              LOP Leaves During Notice Period
            </button>

            {showLop && (
              <div className="mt-3 border border-slate-200 rounded-xl overflow-hidden">
                {!lopLeaves || lopLeaves.length === 0 ? (
                  <p className="text-xs text-slate-400 p-4">No LOP leaves during notice period.</p>
                ) : (
                  <table className="w-full text-xs">
                    <thead className="bg-slate-50">
                      <tr>
                        <th className="text-left px-3 py-2 text-slate-500 font-medium">Dates</th>
                        <th className="text-left px-3 py-2 text-slate-500 font-medium">Type</th>
                        <th className="text-left px-3 py-2 text-slate-500 font-medium">Days</th>
                        <th className="px-3 py-2" />
                      </tr>
                    </thead>
                    <tbody>
                      {lopLeaves.map((l: any) => (
                        <tr key={l.id} className="border-t border-slate-100">
                          <td className="px-3 py-2 text-slate-700">
                            {new Date(l.startDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
                            {' → '}
                            {new Date(l.endDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
                          </td>
                          <td className="px-3 py-2 text-slate-600">{l.leaveKind}</td>
                          <td className="px-3 py-2 text-slate-600">{Number(l.lopDays)}</td>
                          <td className="px-3 py-2">
                            <button
                              className="text-brand-600 font-medium hover:underline"
                              onClick={() => { setError(''); convertLopMut.mutate(l.id) }}
                            >
                              Convert to Paid
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Section 7: History ────────────────────────────────────────── */}
      {ed?.resignationHistory?.length > 0 && (
        <div className="space-y-3 pt-4 border-t border-slate-100">
          <SectionHeader icon={Clock} title="Activity Log" color="text-slate-500" bg="bg-slate-100" />
          <div className="space-y-2">
            {ed.resignationHistory.map((h: any) => (
              <div key={h.id} className="flex items-start gap-3">
                <div className="w-1.5 h-1.5 rounded-full bg-slate-300 mt-2 flex-shrink-0" />
                <div>
                  <p className="text-xs font-medium text-slate-700">{h.action.replace(/_/g, ' ')}</p>
                  <p className="text-xs text-slate-400">
                    {h.performedByName} · {new Date(h.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                  </p>
                  {h.notes && <p className="text-xs text-slate-500 mt-0.5">{h.notes}</p>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
