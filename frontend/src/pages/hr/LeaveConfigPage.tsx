import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Save, RefreshCw, Plus, Trash2, AlertTriangle, Search, Edit3, Check, X as XIcon } from 'lucide-react'
import { leaveApi } from '../../services/api'
import { PageHeader, Button, Alert } from '../../components/ui'
import { useAuthStore } from '../../store/authStore'
import clsx from 'clsx'

const KIND_LABEL: Record<string, string> = { SICK: 'Sick Leave', CASUAL: 'Casual Leave', PLANNED: 'Planned Leave' }

export default function LeaveConfigPage() {
  const qc  = useQueryClient()
  const user = useAuthStore(s => s.user)
  const isSuperAdmin = user?.role === 'SUPER_ADMIN'

  const [error, setError]     = useState('')
  const [success, setSuccess] = useState('')
  const [policy, setPolicy]   = useState<any>(null)

  // Reason management
  const [selectedKind, setSelectedKind]   = useState<'SICK' | 'CASUAL' | 'PLANNED'>('SICK')
  const [newReasonLabel, setNewReasonLabel] = useState('')
  const [rolloverConfirm, setRolloverConfirm] = useState(false)
  const [balanceYear, setBalanceYear] = useState(new Date().getFullYear())
  const [balanceSearch, setBalanceSearch] = useState('')
  const [editing, setEditing] = useState<{ empId: string; values: Record<string, string> } | null>(null)

  const { data: policyData } = useQuery({ queryKey: ['leave-policy'], queryFn: () => leaveApi.policy().then(r => r.data.data) })
  const { data: reasons, isLoading: reasonsLoading } = useQuery({
    queryKey: ['leave-reasons', selectedKind],
    queryFn: () => leaveApi.reasons(selectedKind).then(r => r.data.data),
  })
  const { data: rolloverStatus } = useQuery({ queryKey: ['rollover-status'], queryFn: () => leaveApi.rolloverStatus().then(r => r.data.data) })
  const { data: rolloverHistory } = useQuery({ queryKey: ['rollover-history'], queryFn: () => leaveApi.rolloverHistory().then(r => r.data.data) })

  const { data: balanceEmployees, isLoading: balanceLoading } = useQuery({
    queryKey: ['balance-adjust-employees', balanceYear],
    queryFn: () => leaveApi.balanceAdjustEmployees(balanceYear).then(r => r.data.data),
    enabled: isSuperAdmin,
  })

  const adjustMutation = useMutation({
    mutationFn: (data: any) => leaveApi.balanceAdjust(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['balance-adjust-employees', balanceYear] })
    },
    onError: (e: any) => setError(e?.response?.data?.error || 'Failed to update balance'),
  })

  useEffect(() => { if (policyData && !policy) setPolicy(policyData) }, [policyData])

  const updatePolicyMutation = useMutation({
    mutationFn: (data: any) => leaveApi.updatePolicy(data),
    onSuccess: () => { setSuccess('Leave policy saved.'); qc.invalidateQueries({ queryKey: ['leave-policy'] }) },
    onError: (e: any) => setError(e?.response?.data?.error || 'Failed to save policy'),
  })

  const addReasonMutation = useMutation({
    mutationFn: (data: any) => leaveApi.addReason(data),
    onSuccess: () => { setNewReasonLabel(''); qc.invalidateQueries({ queryKey: ['leave-reasons'] }) },
    onError: (e: any) => setError(e?.response?.data?.error || 'Failed to add reason'),
  })

  const deleteReasonMutation = useMutation({
    mutationFn: (id: string) => leaveApi.deleteReason(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['leave-reasons'] }),
  })

  const toggleReasonMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) => leaveApi.updateReason(id, { isActive }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['leave-reasons'] }),
  })

  const rolloverMutation = useMutation({
    mutationFn: () => leaveApi.triggerRollover(),
    onSuccess: (res) => {
      const d = res.data.data
      setSuccess(`Rollover complete: ${d.employeeCount} employees processed (${d.fromYear} → ${d.toYear})`)
      setRolloverConfirm(false)
      qc.invalidateQueries({ queryKey: ['rollover-status'] })
      qc.invalidateQueries({ queryKey: ['rollover-history'] })
    },
    onError: (e: any) => { setError(e?.response?.data?.error || 'Rollover failed'); setRolloverConfirm(false) },
  })

  const seedMutation = useMutation({
    mutationFn: () => leaveApi.seedReasons(),
    onSuccess: () => { setSuccess('Default reasons seeded.'); qc.invalidateQueries({ queryKey: ['leave-reasons'] }) },
  })

  function setPolicyField(field: string, value: any) {
    setPolicy((p: any) => ({ ...p, [field]: value }))
  }

  if (!policy) return <div className="text-sm text-slate-400 p-8 text-center">Loading…</div>

  return (
    <div className="space-y-6">
      <PageHeader title="Leave Configuration" subtitle="Manage leave policy, reasons, and year-end rollover" />

      {error   && <Alert type="error"   message={error}   />}
      {success && <Alert type="success" message={success} />}

      {/* ── LEAVE POLICY ── */}
      <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-5">
        <div className="flex justify-between items-center">
          <h3 className="text-sm font-semibold text-slate-800">Leave Quotas &amp; Advance Notice</h3>
          <Button icon={<Save size={13} />} loading={updatePolicyMutation.isPending}
            onClick={() => { setError(''); updatePolicyMutation.mutate(policy) }}>
            Save Policy
          </Button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {['SICK', 'CASUAL', 'PLANNED'].map(kind => (
            <div key={kind} className="border border-slate-100 rounded-xl p-4 space-y-3">
              <h4 className="text-xs font-semibold text-slate-600 uppercase tracking-wide">{KIND_LABEL[kind]}</h4>
              <div>
                <label className="text-xs text-slate-500 block mb-1">Days per year</label>
                <input type="number" min={0} max={30} className="input w-full text-sm"
                  value={policy[`${kind.toLowerCase()}DaysPerYear`] ?? ''}
                  onChange={e => setPolicyField(`${kind.toLowerCase()}DaysPerYear`, Number(e.target.value))}
                />
              </div>
              <div>
                <label className="text-xs text-slate-500 block mb-1">Advance notice (days)</label>
                <input type="number" min={0} max={30} className="input w-full text-sm"
                  value={policy[`${kind.toLowerCase()}AdvanceDays`] ?? ''}
                  onChange={e => setPolicyField(`${kind.toLowerCase()}AdvanceDays`, Number(e.target.value))}
                />
                {kind === 'SICK' && <p className="text-xs text-slate-400 mt-1">0 = no advance needed, backdated allowed</p>}
              </div>
            </div>
          ))}
        </div>

        {/* Half day slots */}
        <div className="border-t border-slate-100 pt-4">
          <h4 className="text-xs font-semibold text-slate-600 mb-3">Half Day Slots</h4>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: '1st Half Start', field: 'firstHalfStart' },
              { label: '1st Half End',   field: 'firstHalfEnd' },
              { label: '2nd Half Start', field: 'secondHalfStart' },
              { label: '2nd Half End',   field: 'secondHalfEnd' },
            ].map(({ label, field }) => (
              <div key={field}>
                <label className="text-xs text-slate-500 block mb-1">{label}</label>
                <input type="time" className="input w-full text-sm"
                  value={policy[field] || ''}
                  onChange={e => setPolicyField(field, e.target.value)}
                />
              </div>
            ))}
          </div>
        </div>

        {/* Probation — SUPER_ADMIN only */}
        {isSuperAdmin && (
          <div className="border-t border-slate-100 pt-4">
            <h4 className="text-xs font-semibold text-slate-600 mb-3">Probation Settings <span className="text-violet-600 font-normal">(Super Admin only)</span></h4>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs text-slate-500 block mb-1">Default probation duration (months)</label>
                <input type="number" min={0} max={12} className="input w-full text-sm"
                  value={policy.probationMonths ?? 3}
                  onChange={e => setPolicyField('probationMonths', Number(e.target.value))}
                />
                <p className="text-xs text-slate-400 mt-1">Applies to new employees. 0 = no probation.</p>
              </div>
            </div>
          </div>
        )}

        {/* Carry forward — SUPER_ADMIN only */}
        {isSuperAdmin && (
          <div className="border-t border-slate-100 pt-4">
            <h4 className="text-xs font-semibold text-slate-600 mb-3">Planned Leave Carry Forward Rules <span className="text-violet-600 font-normal">(Super Admin only)</span></h4>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs text-slate-500 block mb-1">Max carry forward days</label>
                <input type="number" min={0} max={30} className="input w-full text-sm"
                  value={policy.plannedCarryForwardMax ?? ''}
                  onChange={e => setPolicyField('plannedCarryForwardMax', Number(e.target.value))}
                />
              </div>
              <div>
                <label className="text-xs text-slate-500 block mb-1">Max planned leave balance cap</label>
                <input type="number" min={0} max={60} className="input w-full text-sm"
                  value={policy.plannedBalanceCap ?? ''}
                  onChange={e => setPolicyField('plannedBalanceCap', Number(e.target.value))}
                />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── LEAVE REASONS ── */}
      <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4">
        <div className="flex justify-between items-center">
          <h3 className="text-sm font-semibold text-slate-800">Leave Reasons</h3>
          <Button variant="secondary" onClick={() => seedMutation.mutate()} loading={seedMutation.isPending}>
            Seed Defaults
          </Button>
        </div>

        {/* Kind tabs */}
        <div className="flex gap-1 bg-slate-100 rounded-xl p-1 w-fit">
          {(['SICK', 'CASUAL', 'PLANNED'] as const).map(k => (
            <button key={k} onClick={() => setSelectedKind(k)}
              className={clsx('px-3 py-1.5 text-xs font-medium rounded-lg transition-colors',
                selectedKind === k ? 'bg-white shadow-sm text-slate-800' : 'text-slate-500 hover:text-slate-700'
              )}>
              {KIND_LABEL[k]}
            </button>
          ))}
        </div>

        {/* Add reason */}
        <div className="flex gap-2">
          <input type="text" className="input text-sm flex-1" placeholder={`Add ${KIND_LABEL[selectedKind]} reason…`}
            value={newReasonLabel}
            onChange={e => setNewReasonLabel(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && newReasonLabel.trim()) addReasonMutation.mutate({ leaveKind: selectedKind, label: newReasonLabel.trim() }) }}
          />
          <Button icon={<Plus size={13} />} loading={addReasonMutation.isPending}
            disabled={!newReasonLabel.trim()}
            onClick={() => addReasonMutation.mutate({ leaveKind: selectedKind, label: newReasonLabel.trim() })}>
            Add
          </Button>
        </div>

        {/* Reasons list */}
        <div className="space-y-1">
          {reasonsLoading ? <p className="text-xs text-slate-400">Loading…</p>
            : (reasons || []).length === 0 ? <p className="text-xs text-slate-400">No reasons yet. Add some above or seed defaults.</p>
            : (reasons || []).map((r: any) => (
              <div key={r.id} className={clsx(
                'flex items-center justify-between px-3 py-2 rounded-lg border',
                r.isActive ? 'border-slate-100 bg-slate-50' : 'border-slate-100 bg-white opacity-50'
              )}>
                <span className="text-sm text-slate-700">{r.label}</span>
                <div className="flex items-center gap-2">
                  <button onClick={() => toggleReasonMutation.mutate({ id: r.id, isActive: !r.isActive })}
                    className={clsx('text-xs underline underline-offset-2', r.isActive ? 'text-slate-400' : 'text-brand-500')}>
                    {r.isActive ? 'Disable' : 'Enable'}
                  </button>
                  <button onClick={() => { if (confirm(`Delete "${r.label}"?`)) deleteReasonMutation.mutate(r.id) }}
                    className="text-slate-300 hover:text-red-400">
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            ))
          }
        </div>
      </div>

      {/* ── YEAR-END ROLLOVER ── */}
      {isSuperAdmin && (
        <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4">
          <h3 className="text-sm font-semibold text-slate-800">Year-End Rollover</h3>

          {rolloverStatus && (
            <div className={clsx(
              'rounded-xl p-4 text-sm',
              rolloverStatus.alreadyDone   ? 'bg-emerald-50 border border-emerald-200' :
              rolloverStatus.inWindow      ? 'bg-amber-50 border border-amber-200' :
                                             'bg-slate-50 border border-slate-200'
            )}>
              {rolloverStatus.alreadyDone ? (
                <p className="text-emerald-700 text-xs">
                  ✓ Rollover for {rolloverStatus.fromYear} → {rolloverStatus.toYear} already completed on{' '}
                  {new Date(rolloverStatus.existing?.triggeredAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                  {' '}by {rolloverStatus.existing?.triggeredByName}.
                </p>
              ) : rolloverStatus.inWindow ? (
                <div className="space-y-3">
                  <p className="text-amber-700 text-xs font-medium">
                    🟡 Rollover window is open — {rolloverStatus.fromYear} → {rolloverStatus.toYear}
                  </p>
                  <p className="text-amber-600 text-xs">
                    Planned leave balances will be carried forward (max {policy.plannedCarryForwardMax} days).
                    New allocations for {rolloverStatus.toYear} will be created for all active employees.
                    This cannot be undone.
                  </p>
                  {!rolloverConfirm ? (
                    <Button onClick={() => setRolloverConfirm(true)} icon={<RefreshCw size={13} />}>
                      Trigger Rollover
                    </Button>
                  ) : (
                    <div className="flex items-center gap-3">
                      <AlertTriangle size={14} className="text-amber-500" />
                      <span className="text-xs text-amber-700">Are you sure? This cannot be undone.</span>
                      <Button loading={rolloverMutation.isPending} onClick={() => rolloverMutation.mutate()}>
                        Yes, Run Rollover
                      </Button>
                      <Button variant="secondary" onClick={() => setRolloverConfirm(false)}>Cancel</Button>
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-slate-500 text-xs">
                  Rollover window opens on <strong>28 December {rolloverStatus.fromYear}</strong> and closes on <strong>5 January {rolloverStatus.toYear}</strong>. Button will be enabled then.
                </p>
              )}
            </div>
          )}

          {/* Rollover history */}
          {(rolloverHistory || []).length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-slate-600 mb-2">Rollover History</h4>
              <div className="space-y-2">
                {(rolloverHistory || []).map((h: any) => (
                  <div key={h.id} className="flex justify-between items-center px-3 py-2 bg-slate-50 rounded-lg text-xs">
                    <span className="text-slate-700 font-medium">{h.fromYear} → {h.toYear}</span>
                    <span className="text-slate-400">{h.employeeCount} employees</span>
                    <span className="text-slate-400">by {h.triggeredByName}</span>
                    <span className="text-slate-400">{new Date(h.triggeredAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
      {/* ── ADJUST LEAVE BALANCES ── */}
      {isSuperAdmin && (
        <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-slate-800">Adjust Leave Balances</h3>
              <p className="text-xs text-slate-400 mt-0.5">Edit total entitlement days per employee. Used/pending days are not changed.</p>
            </div>
            <div className="flex items-center gap-2">
              <select
                className="input text-sm w-28"
                value={balanceYear}
                onChange={e => setBalanceYear(Number(e.target.value))}
              >
                {[balanceYear - 1, balanceYear, balanceYear + 1].map(y => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Search */}
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              className="input pl-8 text-sm w-full"
              placeholder="Search employee…"
              value={balanceSearch}
              onChange={e => setBalanceSearch(e.target.value)}
            />
          </div>

          {/* Table */}
          {balanceLoading ? (
            <p className="text-xs text-slate-400">Loading…</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="border-b border-slate-100">
                    <th className="text-left text-xs font-semibold text-slate-500 py-2 pr-4 w-48">Employee</th>
                    {['SICK', 'CASUAL', 'PLANNED'].map(k => (
                      <th key={k} className="text-center text-xs font-semibold text-slate-500 py-2 px-3">{KIND_LABEL[k]}</th>
                    ))}
                    <th className="text-center text-xs font-semibold text-slate-500 py-2 px-3 w-24">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {(balanceEmployees || [])
                    .filter((e: any) =>
                      !balanceSearch ||
                      e.name.toLowerCase().includes(balanceSearch.toLowerCase()) ||
                      e.employeeCode.toLowerCase().includes(balanceSearch.toLowerCase())
                    )
                    .map((emp: any) => {
                      const isEdit = editing?.empId === emp.id
                      return (
                        <tr key={emp.id} className={clsx('border-b border-slate-50', isEdit ? 'bg-indigo-50/40' : 'hover:bg-slate-50/50')}>
                          <td className="py-2.5 pr-4">
                            <p className="text-slate-800 font-medium text-xs">{emp.name}</p>
                            <p className="text-slate-400 text-xs">{emp.employeeCode}</p>
                          </td>
                          {['SICK', 'CASUAL', 'PLANNED'].map(kind => {
                            const bal = emp.balances[kind]
                            return (
                              <td key={kind} className="py-2.5 px-3 text-center">
                                {isEdit ? (
                                  <input
                                    type="number"
                                    min={0}
                                    max={365}
                                    step={0.5}
                                    className="input text-sm text-center w-20"
                                    value={editing!.values[kind] ?? String(bal ? bal.totalDays : 0)}
                                    onChange={e => setEditing(prev => prev ? {
                                      ...prev,
                                      values: { ...prev.values, [kind]: e.target.value }
                                    } : null)}
                                  />
                                ) : (
                                  <div className="flex flex-col items-center gap-0.5">
                                    <span className="font-semibold text-slate-700">{bal ? bal.totalDays : '—'}</span>
                                    {bal && <span className="text-xs text-slate-400">used {bal.usedDays}</span>}
                                  </div>
                                )}
                              </td>
                            )
                          })}
                          <td className="py-2.5 px-3 text-center">
                            {isEdit ? (
                              <div className="flex items-center justify-center gap-1">
                                <button
                                  className="p-1.5 rounded-lg bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50"
                                  disabled={adjustMutation.isPending}
                                  onClick={async () => {
                                    setError('')
                                    const kinds = ['SICK', 'CASUAL', 'PLANNED']
                                    for (const kind of kinds) {
                                      const val = editing!.values[kind]
                                      if (val !== undefined) {
                                        await leaveApi.balanceAdjust({
                                          employeeId: emp.id,
                                          leaveKind: kind,
                                          year: balanceYear,
                                          totalDays: Number(val),
                                        }).catch((e: any) => setError(e?.response?.data?.error || 'Failed to update'))
                                      }
                                    }
                                    setEditing(null)
                                    qc.invalidateQueries({ queryKey: ['balance-adjust-employees', balanceYear] })
                                  }}
                                >
                                  <Check size={13} />
                                </button>
                                <button
                                  className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400"
                                  onClick={() => setEditing(null)}
                                >
                                  <XIcon size={13} />
                                </button>
                              </div>
                            ) : (
                              <button
                                className="p-1.5 rounded-lg text-slate-400 hover:text-brand-600 hover:bg-indigo-50 transition-colors"
                                onClick={() => {
                                  const vals: Record<string, string> = {}
                                  for (const k of ['SICK', 'CASUAL', 'PLANNED']) {
                                    const bal = emp.balances[k]
                                    vals[k] = String(bal ? bal.totalDays : 0)
                                  }
                                  setEditing({ empId: emp.id, values: vals })
                                }}
                              >
                                <Edit3 size={13} />
                              </button>
                            )}
                          </td>
                        </tr>
                      )
                    })
                  }
                </tbody>
              </table>
              {(balanceEmployees || []).filter((e: any) =>
                !balanceSearch ||
                e.name.toLowerCase().includes(balanceSearch.toLowerCase()) ||
                e.employeeCode.toLowerCase().includes(balanceSearch.toLowerCase())
              ).length === 0 && (
                <p className="text-xs text-slate-400 text-center py-6">No employees found.</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
