import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft, Play, Lock, Unlock, Banknote,
  RefreshCw, ChevronDown, ChevronUp, Pencil, Check, X as XIcon, UserMinus, Plus, Trash2
} from 'lucide-react'
import { format } from 'date-fns'
import { payrollApi, employeeApi } from '../../services/api'
import api from '../../services/api'
import {
  PageHeader, Button, Card, StatusBadge, Rupee,
  Table, Th, Td, Tr, Skeleton, Modal, Alert
} from '../../components/ui'
import clsx from 'clsx'
import { useAuthStore } from '../../store/authStore'

interface EditState {
  lopDays:        string
  tdsAmount:      string
  reimbursements: string
  adjustmentNote: string
}

function ConfirmModal({ open, onClose, title, message, onConfirm, loading, variant = 'primary' }: any) {
  return (
    <Modal open={open} onClose={onClose} title={title}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant={variant} loading={loading} onClick={onConfirm}>{title}</Button>
        </>
      }>
      <p className="text-sm text-slate-600">{message}</p>
    </Modal>
  )
}

export default function RunPayrollPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { user } = useAuthStore()
  const isSuperAdmin = user?.role === 'SUPER_ADMIN'

  const [runConfirm,      setRunConfirm]      = useState(false)
  const [lockConfirm,     setLockConfirm]     = useState(false)
  const [unlockConfirm,   setUnlockConfirm]   = useState(false)
  const [disburseConfirm, setDisburseConfirm] = useState(false)
  const [unlockReason,    setUnlockReason]    = useState('')
  const [expandedRow,     setExpandedRow]     = useState<string | null>(null)
  const [editingRow,      setEditingRow]      = useState<string | null>(null)
  const [editState,       setEditState]       = useState<EditState>({ lopDays: '', tdsAmount: '', reimbursements: '', adjustmentNote: '' })
  const [saveError,       setSaveError]       = useState<string | null>(null)

  const { data: cycleData, isLoading } = useQuery({
    queryKey: ['payroll-cycle', id],
    queryFn: () => payrollApi.cycle(id!).then(r => r.data.data),
    enabled: !!id,
    refetchInterval: false,
  })

  const runMut = useMutation({
    mutationFn: () => payrollApi.run(id!),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['payroll-cycle', id] }); setRunConfirm(false) },
  })
  const lockMut = useMutation({
    mutationFn: () => payrollApi.lock(id!),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['payroll-cycle', id] }); setLockConfirm(false) },
  })
  const unlockMut = useMutation({
    mutationFn: () => payrollApi.unlock(id!, unlockReason),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['payroll-cycle', id] }); setUnlockConfirm(false); setUnlockReason('') },
  })
  const disburseMut = useMutation({
    mutationFn: () => payrollApi.disburse(id!),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['payroll-cycle', id] }); setDisburseConfirm(false) },
  })
  const editMut = useMutation({
    mutationFn: ({ entryId, data }: { entryId: string; data: any }) =>
      api.put(`/api/payroll/entries/${entryId}`, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['payroll-cycle', id] }); setEditingRow(null); setSaveError(null) },
    onError: (err: any) => setSaveError(err?.response?.data?.error || 'Failed to save'),
  })

  function startEdit(entry: any) {
    setEditingRow(entry.id)
    setExpandedRow(null)
    setSaveError(null)
    setEditState({
      lopDays:        String(Number(entry.lopDays) || 0),
      tdsAmount:      String(Number(entry.tdsAmount) || 0),
      reimbursements: String(Number(entry.reimbursementTotal) || 0),
      adjustmentNote: entry.adjustmentNote || '',
    })
  }

  function cancelEdit() { setEditingRow(null); setSaveError(null) }

  function saveEdit(entryId: string) {
    editMut.mutate({
      entryId,
      data: {
        lopDays:        Number(editState.lopDays),
        tdsAmount:      Number(editState.tdsAmount),
        reimbursements: Number(editState.reimbursements),
        adjustmentNote: editState.adjustmentNote || null,
      },
    })
  }

  if (isLoading) return <div className="space-y-4"><Skeleton className="h-32 rounded-xl" /><Skeleton className="h-64 rounded-xl" /></div>

  const cycle   = cycleData
  const entries = cycle?.entries || []
  const status  = cycle?.status
  const canRun      = status === 'DRAFT' || status === 'CALCULATED'
  const canLock     = status === 'CALCULATED'
  const canUnlock   = status === 'LOCKED' && isSuperAdmin
  const canDisburse = status === 'LOCKED'
  const canEdit     = status === 'CALCULATED' && isSuperAdmin
  const errors_count = entries.filter((e: any) => e.status === 'error').length

  return (
    <div className="space-y-5">
      <PageHeader
        title={`Payroll — ${cycle?.payrollMonth}`}
        subtitle={`${format(new Date(cycle?.cycleStart), 'dd MMM')} – ${format(new Date(cycle?.cycleEnd), 'dd MMM yyyy')}`}
        actions={<Button variant="ghost" icon={<ArrowLeft size={14} />} onClick={() => navigate('/hr/payroll')}>Back</Button>}
      />

      <Card>
        <div className="p-5 flex flex-col sm:flex-row items-start sm:items-center gap-4">
          <div className="flex-1">
            <div className="flex items-center gap-3 mb-2">
              <StatusBadge status={status} />
              {cycle?.runAt && <span className="text-xs text-slate-400">Last run: {format(new Date(cycle.runAt), 'dd MMM yyyy, HH:mm')}</span>}
              {cycle?.lockedAt && <span className="text-xs text-slate-400">Locked: {format(new Date(cycle.lockedAt), 'dd MMM yyyy, HH:mm')}</span>}
            </div>
            <div className="flex flex-wrap gap-4">
              {[
                { label: 'Employees',   value: cycle?.employeeCount ?? entries.length },
                { label: 'Total Gross', value: cycle?.totalGross ? <Rupee amount={cycle.totalGross} /> : '—' },
                { label: 'Total Net',   value: cycle?.totalNet   ? <Rupee amount={cycle.totalNet} />   : '—' },
                { label: 'Total PF',    value: cycle?.totalPf    ? <Rupee amount={cycle.totalPf} />    : '—' },
              ].map(({ label, value }) => (
                <div key={label}>
                  <p className="text-xs text-slate-400">{label}</p>
                  <p className="text-sm font-bold text-slate-800">{value}</p>
                </div>
              ))}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {canRun      && <Button icon={<RefreshCw size={14} />} onClick={() => setRunConfirm(true)} loading={runMut.isPending}>{status === 'CALCULATED' ? 'Re-run Payroll' : 'Run Payroll'}</Button>}
            {canLock     && <Button variant="secondary" icon={<Lock size={14} />} onClick={() => setLockConfirm(true)}>Lock Cycle</Button>}
            {canUnlock   && <Button variant="secondary" icon={<Unlock size={14} />} onClick={() => setUnlockConfirm(true)}>Unlock</Button>}
            {canDisburse && <Button variant="primary" icon={<Banknote size={14} />} onClick={() => setDisburseConfirm(true)}>Mark Disbursed</Button>}
          </div>
        </div>
      </Card>

      {cycle?.unlockReason && <Alert type="warning" title="Previously unlocked" message={`Reason: ${cycle.unlockReason}`} />}

      {status === 'CALCULATED' && (
        errors_count === 0
          ? <Alert type="success" message={`All ${entries.length} employees calculated. Review and edit if needed, then lock.`} />
          : <Alert type="error" message={`${errors_count} employees had errors. Fix before locking.`} />
      )}

      {/* Skip Payroll Panel — SA only, only before lock */}
      {isSuperAdmin && cycle?.payrollMonth && (canRun || canLock) && (
        <PayrollSkipPanel payrollMonth={cycle.payrollMonth} />
      )}

      {entries.length > 0 && (
        <Card title={`Employee Breakdown — ${entries.length} employees`}>
          {canEdit && (
            <div className="px-5 pt-3 pb-1">
              <p className="text-xs text-slate-400 flex items-center gap-1">
                <Pencil size={11} /> Click the pencil icon on any row to adjust LOP, TDS, or Reimbursements before locking.
              </p>
            </div>
          )}
          <Table>
            <thead>
              <tr className="border-b border-slate-100">
                <Th>Employee</Th>
                <Th className="text-right">Gross</Th>
                <Th className="text-right">LOP</Th>
                <Th className="text-right">PF</Th>
                <Th className="text-right">ESI</Th>
                <Th className="text-right">PT</Th>
                <Th className="text-right">TDS</Th>
                <Th className="text-right">Reimb</Th>
                <Th className="text-right">Loan</Th>
                <Th className="text-right font-bold">Net</Th>
                <Th></Th>
                {canEdit && <Th></Th>}
              </tr>
            </thead>
            <tbody>
              {entries.map((entry: any) => {
                const isExpanded = expandedRow === entry.id
                const isEditing  = editingRow  === entry.id
                const isAdjusted = entry.status === 'ADJUSTED'
                return (
                  <>
                    <Tr key={entry.id}
                      className={clsx(isEditing && 'bg-amber-50/60 ring-1 ring-inset ring-amber-200')}
                      onClick={() => !isEditing && setExpandedRow(isExpanded ? null : entry.id)}>
                      <Td>
                        <div className="flex items-center gap-2">
                          <div className="w-7 h-7 rounded-full bg-brand-100 flex items-center justify-center flex-shrink-0">
                            <span className="text-xs font-semibold text-brand-700">{entry.employee?.name?.charAt(0)}</span>
                          </div>
                          <div>
                            <p className="text-sm font-medium text-slate-800">{entry.employee?.name}</p>
                            <p className="text-xs text-slate-400">{entry.employee?.department}</p>
                          </div>
                          {isAdjusted && <span className="ml-1 px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-100 text-amber-700">EDITED</span>}
                        </div>
                      </Td>
                      <Td className="text-right"><Rupee amount={entry.proratedGross} className="text-xs" /></Td>
                      <Td className="text-right">{Number(entry.lopAmount) > 0 ? <Rupee amount={entry.lopAmount} className="text-xs text-red-500" /> : <span className="text-slate-300 text-xs">—</span>}</Td>
                      <Td className="text-right"><Rupee amount={entry.pfAmount} className="text-xs" /></Td>
                      <Td className="text-right">{Number(entry.esiAmount) > 0 ? <Rupee amount={entry.esiAmount} className="text-xs" /> : <span className="text-slate-300 text-xs">—</span>}</Td>
                      <Td className="text-right">{Number(entry.ptAmount) > 0 ? <Rupee amount={entry.ptAmount} className="text-xs" /> : <span className="text-slate-300 text-xs">—</span>}</Td>
                      <Td className="text-right">{Number(entry.tdsAmount) > 0 ? <Rupee amount={entry.tdsAmount} className="text-xs" /> : <span className="text-slate-300 text-xs">—</span>}</Td>
                      <Td className="text-right">{Number(entry.reimbursementTotal) > 0 ? <Rupee amount={entry.reimbursementTotal} className="text-xs text-emerald-600" /> : <span className="text-slate-300 text-xs">—</span>}</Td>
                      <Td className="text-right">{Number(entry.loanDeduction) > 0 ? <Rupee amount={entry.loanDeduction} className="text-xs text-amber-600" /> : <span className="text-slate-300 text-xs">—</span>}</Td>
                      <Td className="text-right"><Rupee amount={entry.netSalary} className="text-sm font-bold text-slate-900" /></Td>
                      <Td>{!isEditing && (isExpanded ? <ChevronUp size={14} className="text-slate-400" /> : <ChevronDown size={14} className="text-slate-400" />)}</Td>
                      {canEdit && (
                        <Td onClick={e => e.stopPropagation()}>
                          {!isEditing ? (
                            <button onClick={() => startEdit(entry)} className="p-1.5 rounded-lg hover:bg-amber-100 text-slate-400 hover:text-amber-700 transition-colors">
                              <Pencil size={13} />
                            </button>
                          ) : (
                            <div className="flex items-center gap-1">
                              <button onClick={() => saveEdit(entry.id)} disabled={editMut.isPending} className="p-1.5 rounded-lg bg-brand-600 hover:bg-brand-700 text-white transition-colors">
                                <Check size={13} />
                              </button>
                              <button onClick={cancelEdit} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors">
                                <XIcon size={13} />
                              </button>
                            </div>
                          )}
                        </Td>
                      )}
                    </Tr>

                    {isEditing && (
                      <tr key={`${entry.id}-edit`} className="bg-amber-50/40 border-b border-amber-100">
                        <td colSpan={canEdit ? 12 : 11} className="px-5 py-4">
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                            <div className="flex flex-col gap-1">
                              <label className="text-xs font-semibold text-slate-500">LOP Days</label>
                              <input type="number" min="0" step="0.5" className="input text-sm" value={editState.lopDays} onChange={e => setEditState(s => ({ ...s, lopDays: e.target.value }))} />
                              <p className="text-[10px] text-slate-400">Current: {entry.lopDays} days</p>
                            </div>
                            <div className="flex flex-col gap-1">
                              <label className="text-xs font-semibold text-slate-500">TDS Amount (₹)</label>
                              <input type="number" min="0" className="input text-sm" value={editState.tdsAmount} onChange={e => setEditState(s => ({ ...s, tdsAmount: e.target.value }))} />
                              <p className="text-[10px] text-slate-400">Current: ₹{Number(entry.tdsAmount).toLocaleString('en-IN')}</p>
                            </div>
                            <div className="flex flex-col gap-1">
                              <label className="text-xs font-semibold text-slate-500">Reimbursements (₹)</label>
                              <input type="number" min="0" className="input text-sm" value={editState.reimbursements} onChange={e => setEditState(s => ({ ...s, reimbursements: e.target.value }))} />
                              <p className="text-[10px] text-slate-400">Current: ₹{Number(entry.reimbursementTotal).toLocaleString('en-IN')}</p>
                            </div>
                            <div className="flex flex-col gap-1">
                              <label className="text-xs font-semibold text-slate-500">Adjustment Note</label>
                              <input type="text" className="input text-sm" placeholder="Reason for change…" value={editState.adjustmentNote} onChange={e => setEditState(s => ({ ...s, adjustmentNote: e.target.value }))} />
                            </div>
                          </div>
                          {saveError && <p className="mt-2 text-xs text-red-600">{saveError}</p>}
                          <p className="mt-2 text-[10px] text-slate-400">Net salary recalculated automatically on save.</p>
                        </td>
                      </tr>
                    )}

                    {isExpanded && !isEditing && (
                      <tr key={`${entry.id}-expanded`} className="bg-slate-50/80">
                        <td colSpan={canEdit ? 12 : 11} className="px-5 py-4">
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
                            <div>
                              <p className="text-slate-400 mb-1 font-semibold uppercase tracking-wide">Salary Structure</p>
                              {[
                                { label: 'Annual CTC',  value: entry.annualCtc },
                                { label: 'Monthly CTC', value: entry.monthlyCtc },
                                { label: 'Basic',       value: entry.basic },
                                { label: 'HRA',         value: entry.hra },
                                { label: 'Transport',   value: entry.transport },
                                { label: 'FBP',         value: entry.fbp },
                                { label: 'HYI',         value: entry.hyi },
                              ].map(({ label, value }) => (
                                <div key={label} className="flex justify-between py-0.5">
                                  <span className="text-slate-500">{label}</span>
                                  <Rupee amount={value} className="font-medium text-slate-700" />
                                </div>
                              ))}
                            </div>
                            <div>
                              <p className="text-slate-400 mb-1 font-semibold uppercase tracking-wide">Proration</p>
                              {[
                                { label: 'Total Days',   value: entry.totalDays },
                                { label: 'Payable Days', value: entry.payableDays },
                                { label: 'Prorated',     value: entry.isProrated ? 'Yes' : 'No' },
                                { label: 'LOP Days',     value: entry.lopDays },
                              ].map(({ label, value }) => (
                                <div key={label} className="flex justify-between py-0.5">
                                  <span className="text-slate-500">{label}</span>
                                  <span className="font-medium text-slate-700">{value}</span>
                                </div>
                              ))}
                            </div>
                            <div>
                              <p className="text-slate-400 mb-1 font-semibold uppercase tracking-wide">Additions</p>
                              {[
                                { label: 'Prorated Gross', value: <Rupee amount={entry.proratedGross} /> },
                                { label: 'Reimbursements', value: <Rupee amount={entry.reimbursementTotal} /> },
                                { label: 'Incentive',      value: <Rupee amount={entry.incentive} /> },
                              ].map(({ label, value }) => (
                                <div key={label} className="flex justify-between py-0.5">
                                  <span className="text-slate-500">{label}</span>
                                  <span className="font-medium text-slate-700">{value}</span>
                                </div>
                              ))}
                            </div>
                            <div>
                              <p className="text-slate-400 mb-1 font-semibold uppercase tracking-wide">Net Calculation</p>
                              <div className="flex justify-between py-0.5 border-b border-slate-200 mb-1">
                                <span className="text-slate-500">Gross + Additions</span>
                                <Rupee amount={Number(entry.proratedGross) + Number(entry.reimbursementTotal) + Number(entry.incentive)} className="text-slate-700" />
                              </div>
                              <div className="flex justify-between py-0.5 text-red-500">
                                <span>Total Deductions</span>
                                <Rupee amount={[entry.pfAmount, entry.esiAmount, entry.ptAmount, entry.tdsAmount, entry.lopAmount, entry.incentiveRecovery, entry.loanDeduction].reduce((s: number, v: any) => s + Number(v || 0), 0)} />
                              </div>
                              <div className="flex justify-between py-0.5 font-bold border-t border-slate-200 mt-1 text-brand-700">
                                <span>Net Salary</span>
                                <Rupee amount={entry.netSalary} />
                              </div>
                            </div>
                          </div>
                          {entry.adjustmentNote && (
                            <div className="mt-3 text-xs bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 text-amber-700">
                              <strong>Adjustment note:</strong> {entry.adjustmentNote}
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </>
                )
              })}
            </tbody>
          </Table>
        </Card>
      )}

      <ConfirmModal open={runConfirm} onClose={() => setRunConfirm(false)} title="Run Payroll"
        message={`This will calculate salaries for all active employees in ${cycle?.payrollMonth}. Existing calculations will be overwritten.`}
        onConfirm={() => runMut.mutate()} loading={runMut.isPending} />
      <ConfirmModal open={lockConfirm} onClose={() => setLockConfirm(false)} title="Lock Cycle"
        message="Locking prevents further edits. Only a Super Admin can unlock. Proceed?"
        onConfirm={() => lockMut.mutate()} loading={lockMut.isPending} variant="primary" />
      <ConfirmModal open={disburseConfirm} onClose={() => setDisburseConfirm(false)} title="Mark Disbursed"
        message="Confirm salaries have been transferred to all employees. This cannot be undone."
        onConfirm={() => disburseMut.mutate()} loading={disburseMut.isPending} variant="primary" />
      <Modal open={unlockConfirm} onClose={() => setUnlockConfirm(false)} title="Unlock Cycle"
        footer={
          <>
            <Button variant="secondary" onClick={() => setUnlockConfirm(false)}>Cancel</Button>
            <Button variant="danger" loading={unlockMut.isPending} onClick={() => unlockMut.mutate()} disabled={!unlockReason.trim()}>Unlock Cycle</Button>
          </>
        }>
        <div className="space-y-3">
          <Alert type="warning" message="Unlocking will allow edits to a locked cycle. This will be logged." />
          <div className="flex flex-col gap-1">
            <label className="label">Reason for unlocking *</label>
            <textarea value={unlockReason} onChange={e => setUnlockReason(e.target.value)} className="input resize-none" rows={3} placeholder="Describe why this cycle needs to be unlocked…" />
          </div>
        </div>
      </Modal>
    </div>
  )
}

// ─── PAYROLL SKIP PANEL ───────────────────────────────────────────────────────

function PayrollSkipPanel({ payrollMonth }: { payrollMonth: string }) {
  const qc = useQueryClient()
  const [showAdd, setShowAdd] = useState(false)
  const [selectedEmpId, setSelectedEmpId] = useState('')
  const [reason, setReason] = useState('')
  const [empSearch, setEmpSearch] = useState('')

  const { data: skips = [], isLoading: loadingSkips } = useQuery({
    queryKey: ['payroll-skips', payrollMonth],
    queryFn: () => payrollApi.getSkips(payrollMonth).then(r => r.data.data),
  })

  const { data: empList = [] } = useQuery({
    queryKey: ['employees-list', empSearch],
    queryFn: () => employeeApi.list({ search: empSearch || undefined, limit: 50 }).then(r => r.data.data),
    enabled: empSearch.length > 0,
  })

  const addMut = useMutation({
    mutationFn: () => payrollApi.addSkip({ employeeId: selectedEmpId, payrollMonth, reason }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['payroll-skips', payrollMonth] })
      setShowAdd(false); setSelectedEmpId(''); setReason(''); setEmpSearch('')
    },
  })

  const removeMut = useMutation({
    mutationFn: (id: string) => payrollApi.removeSkip(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['payroll-skips', payrollMonth] }),
  })

  const filteredEmps = (empList as any[]).filter((e: any) =>
    !skips.some((s: any) => s.employeeId === e.id)
  )

  return (
    <Card title={`Skip Payroll — ${payrollMonth}`}>
      <div className="p-5 space-y-4">
        {loadingSkips ? (
          <p className="text-sm text-slate-400">Loading…</p>
        ) : skips.length === 0 ? (
          <p className="text-sm text-slate-400">No employees skipped for this month.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100">
                <th className="text-left text-xs text-slate-400 font-medium pb-2">Employee</th>
                <th className="text-left text-xs text-slate-400 font-medium pb-2">Code</th>
                <th className="text-left text-xs text-slate-400 font-medium pb-2">Reason</th>
                <th className="text-left text-xs text-slate-400 font-medium pb-2">Skipped By</th>
                <th className="pb-2" />
              </tr>
            </thead>
            <tbody>
              {(skips as any[]).map((s: any) => (
                <tr key={s.id} className="border-b border-slate-50">
                  <td className="py-2 text-slate-700 font-medium">{s.employee?.name}</td>
                  <td className="py-2 text-slate-500">{s.employee?.employeeCode}</td>
                  <td className="py-2 text-slate-500">{s.reason || '—'}</td>
                  <td className="py-2 text-slate-500">{s.skippedByName}</td>
                  <td className="py-2 text-right">
                    <button
                      onClick={() => removeMut.mutate(s.id)}
                      disabled={removeMut.isPending}
                      className="text-red-400 hover:text-red-600 disabled:opacity-40"
                      title="Remove skip"
                    >
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {showAdd ? (
          <div className="border border-slate-200 rounded-xl p-4 space-y-3 bg-slate-50">
            <p className="text-sm font-medium text-slate-700">Add Employee to Skip List</p>
            <input
              type="text"
              placeholder="Search employee name or code…"
              value={empSearch}
              onChange={e => setEmpSearch(e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            {empSearch && (
              <div className="max-h-40 overflow-y-auto border border-slate-200 rounded-lg bg-white">
                {filteredEmps.length === 0 ? (
                  <p className="p-3 text-sm text-slate-400">No employees found</p>
                ) : filteredEmps.slice(0, 10).map((e: any) => (
                  <button
                    key={e.id}
                    onClick={() => { setSelectedEmpId(e.id); setEmpSearch(`${e.name} (${e.employeeCode})`) }}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50 border-b border-slate-50 last:border-0"
                  >
                    <span className="font-medium">{e.name}</span>
                    <span className="text-slate-400 ml-2">{e.employeeCode}</span>
                  </button>
                ))}
              </div>
            )}
            <input
              type="text"
              placeholder="Reason (optional)"
              value={reason}
              onChange={e => setReason(e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <div className="flex gap-2">
              <Button
                onClick={() => addMut.mutate()}
                disabled={!selectedEmpId || addMut.isPending}
              >
                {addMut.isPending ? 'Adding…' : 'Add to Skip List'}
              </Button>
              <Button variant="secondary" onClick={() => { setShowAdd(false); setSelectedEmpId(''); setReason(''); setEmpSearch('') }}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <Button variant="secondary" icon={<Plus size={14} />} onClick={() => setShowAdd(true)}>
            Add Employee
          </Button>
        )}
      </div>
    </Card>
  )
}
