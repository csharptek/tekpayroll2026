import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Save, AlertTriangle, CheckSquare, Square, Clock, Shield,
  FileCheck, User, Unlock, UserMinus, RotateCcw, ChevronDown, ChevronUp,
} from 'lucide-react'
import { exitApi } from '../../services/api'
import { Field, inp, sel } from './shared'
import { Button, Alert } from '../ui'

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

function DaysRemaining({ expectedLwd }: { expectedLwd: string }) {
  const lwd  = new Date(expectedLwd)
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
    noticePeriodServed: emp.noticePeriodServed || false,
    buyoutAmount:       emp.buyoutAmount       || '',
  })

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
      lastWorkingDay:    details.lastWorkingDay  ? new Date(details.lastWorkingDay).toISOString()  : undefined,
      noticePeriodServed:details.noticePeriodServed,
      buyoutAmount:      details.buyoutAmount || undefined,
    }),
    onSuccess: () => { setSuccess('Exit details saved'); onSaved(); qc.invalidateQueries({ queryKey: ['exit', emp.id] }) },
    onError:   (e: any) => setError(e?.response?.data?.error || 'Save failed'),
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
    onSuccess:  () => qc.invalidateQueries({ queryKey: ['exit', emp.id], queryKey2: ['lop-leaves', emp.id] } as any),
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
                  {new Date(ed.resignationSubmittedAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-400 mb-0.5">Expected LWD</p>
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-slate-700">
                    {expectedLwd ? new Date(expectedLwd).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}
                  </p>
                  {expectedLwd && emp.status === 'ON_NOTICE' && <DaysRemaining expectedLwd={expectedLwd} />}
                </div>
              </div>
              <div>
                <p className="text-xs text-slate-400 mb-0.5">Notice Period</p>
                <p className="text-sm font-medium text-slate-700">{ed.noticePeriodDays ?? 90} days</p>
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

      {/* ── Section 2: Exit Details ────────────────────────────────────── */}
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
            <input className={inp} type="date" value={details.resignationDate} disabled={!isHR}
              onChange={e => setDetails(p => ({ ...p, resignationDate: e.target.value }))} />
          </Field>
          <Field label="Last Working Day">
            <input className={inp} type="date" value={details.lastWorkingDay} disabled={!isHR}
              onChange={e => setDetails(p => ({ ...p, lastWorkingDay: e.target.value }))} />
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

      {/* ── Section 3: Exit Interview ──────────────────────────────────── */}
      <div className="space-y-3 pt-4 border-t border-slate-100">
        <SectionHeader icon={User} title="Exit Interview" color="text-violet-600" bg="bg-violet-50" />

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Interview Date">
            <input className={inp} type="date" disabled={!isHR}
              value={interview.interviewDate}
              onChange={e => setInterview(p => ({ ...p, interviewDate: e.target.value }))} />
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

      {/* ── Section 4: Clearance Checklist ────────────────────────────── */}
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

      {/* ── Section 5: F&F & Separation (Super Admin only) ─────────────── */}
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

      {/* ── Section 6: History ────────────────────────────────────────── */}
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
