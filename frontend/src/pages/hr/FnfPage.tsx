import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import {
  GitMerge, Calculator, CheckCircle2, Eye,
  Calendar, AlertTriangle, Banknote, IndianRupee, FileText, Wand2,
} from 'lucide-react'
import { format } from 'date-fns'
import { fnfApi } from '../../services/api'
import {
  PageHeader, Button, Card, Modal, Alert, Skeleton,
  Table, Th, Td, Tr, EmptyState, Rupee, StatusBadge
} from '../../components/ui'
import clsx from 'clsx'

// ─── EXPANDABLE CALCULATION DETAILS PANEL ─────────────────────────────────

function CalculationDetailsPanel({ calc, hyiOverrides, onHyiOverrideChange }: {
  calc: any
  hyiOverrides?: Record<string, number>
  onHyiOverrideChange?: (next: Record<string, number>) => void
}) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<Record<string, string>>({})
  const cycles = calc.cycles || []
  const editable = !!onHyiOverrideChange

  const commitDraft = (monthKey: string, systemAmount: number) => {
    const raw = draft[monthKey]
    if (raw === undefined) return
    setDraft(d => { const next = { ...d }; delete next[monthKey]; return next })
    if (raw.trim() === '') return
    const val = Number(raw)
    if (Number.isNaN(val)) return
    onHyiOverrideChange!({ ...hyiOverrides, [monthKey]: val })
  }

  return (
    <div className="border border-slate-200 rounded-xl overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex justify-between items-center px-4 py-2.5 text-xs font-semibold text-slate-600 bg-slate-50 hover:bg-slate-100"
      >
        <span>{open ? 'Hide' : 'Show'} Calculation Details</span>
        <span className="text-slate-400">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="p-4 space-y-5 text-xs">
          {/* Per-month salary / PF / ESI / LOP */}
          {cycles.length > 0 && (
            <div>
              <p className="font-semibold text-slate-700 mb-1.5">Salary, PF, ESI & LOP by month</p>
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="text-slate-400 border-b border-slate-100">
                    <th className="text-left font-medium pb-1">Month</th>
                    <th className="text-right font-medium pb-1">Days</th>
                    <th className="text-right font-medium pb-1">Gross</th>
                    <th className="text-right font-medium pb-1">Prorated</th>
                    <th className="text-right font-medium pb-1">PF</th>
                    <th className="text-right font-medium pb-1">ESI</th>
                    <th className="text-right font-medium pb-1">LOP</th>
                  </tr>
                </thead>
                <tbody>
                  {cycles.map((c: any) => (
                    <tr key={c.cycleLabel} className="text-slate-700">
                      <td className="py-1">{c.cycleLabel}</td>
                      <td className="py-1 text-right">{c.salaryDays}/{c.totalDays}</td>
                      <td className="py-1 text-right">₹{Math.round(c.grossMonthly).toLocaleString('en-IN')}</td>
                      <td className="py-1 text-right">₹{Math.round(c.proratedSalary).toLocaleString('en-IN')}</td>
                      <td className="py-1 text-right">₹{Math.round(c.pfAmount).toLocaleString('en-IN')}</td>
                      <td className="py-1 text-right">₹{Math.round(c.esiAmount).toLocaleString('en-IN')}</td>
                      <td className="py-1 text-right">{c.lopDays > 0 ? `${c.lopDays}d / ₹${Math.round(c.lopAmount).toLocaleString('en-IN')}` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* HYI recovery */}
          {calc.hyiRecoveryDetail?.length > 0 && (
            <div>
              <p className="font-semibold text-slate-700 mb-1.5">HYI Recovery by month</p>
              {editable && (
                <p className="text-[10px] text-slate-400 mb-1.5">
                  Figures are pulled from each month's salary history. If a mid-year revision means the system's value is wrong for a month, edit it directly.
                </p>
              )}
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="text-slate-400 border-b border-slate-100">
                    <th className="text-left font-medium pb-1">Month</th>
                    <th className="text-right font-medium pb-1">HYI Recovered</th>
                    {editable && <th className="text-right font-medium pb-1"></th>}
                  </tr>
                </thead>
                <tbody>
                  {calc.hyiRecoveryDetail.map((r: any, i: number) => (
                    <tr key={i} className="text-slate-700">
                      <td className="py-1">{r.monthLabel}</td>
                      <td className="py-1 text-right">
                        {editable ? (
                          <input
                            type="number"
                            value={draft[r.monthKey] !== undefined ? draft[r.monthKey] : r.amount}
                            onChange={e => setDraft(d => ({ ...d, [r.monthKey]: e.target.value }))}
                            onBlur={() => commitDraft(r.monthKey, r.systemAmount)}
                            onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                            className={clsx(
                              'w-24 text-right border rounded px-1.5 py-0.5 text-[11px]',
                              r.isOverridden ? 'border-amber-400 bg-amber-50 text-amber-800 font-semibold' : 'border-slate-200'
                            )}
                          />
                        ) : (
                          `₹${Math.round(r.amount).toLocaleString('en-IN')}`
                        )}
                      </td>
                      {editable && (
                        <td className="py-1 text-right">
                          {r.isOverridden && (
                            <button
                              type="button"
                              title={`Reset to system value ₹${Math.round(r.systemAmount).toLocaleString('en-IN')}`}
                              onClick={() => {
                                setDraft(d => { const next = { ...d }; delete next[r.monthKey]; return next })
                                const next = { ...hyiOverrides }
                                delete next[r.monthKey]
                                onHyiOverrideChange!(next)
                              }}
                              className="text-[10px] text-slate-400 hover:text-slate-600 underline"
                            >
                              Reset
                            </button>
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="font-semibold text-slate-800 border-t border-slate-100">
                    <td className="py-1">Total</td>
                    <td className="py-1 text-right">₹{Math.round(calc.hyiRecovery).toLocaleString('en-IN')}</td>
                    {editable && <td></td>}
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          {/* Excess leave recovery */}
          {calc.excessLeaveDetail?.length > 0 && (
            <div>
              <p className="font-semibold text-slate-700 mb-1.5">Excess Leave Recovery</p>
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="text-slate-400 border-b border-slate-100">
                    <th className="text-left font-medium pb-1">Leave</th>
                    <th className="text-right font-medium pb-1">Annual</th>
                    <th className="text-right font-medium pb-1">Allowed</th>
                    <th className="text-right font-medium pb-1">Used</th>
                    <th className="text-right font-medium pb-1">Excess</th>
                    <th className="text-right font-medium pb-1">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {calc.excessLeaveDetail.map((r: any) => (
                    <tr key={r.leaveKind} className="text-slate-700">
                      <td className="py-1 capitalize">{r.leaveKind.toLowerCase()}</td>
                      <td className="py-1 text-right">{r.annualEntitlement}</td>
                      <td className="py-1 text-right">{r.proratedAllowed}</td>
                      <td className="py-1 text-right">{r.usedDays}</td>
                      <td className={clsx('py-1 text-right font-semibold', r.excessDays > 0 ? 'text-red-600' : 'text-slate-400')}>
                        {r.excessDays > 0 ? r.excessDays : '—'}
                      </td>
                      <td className={clsx('py-1 text-right font-semibold', r.excessAmount > 0 ? 'text-red-600' : 'text-slate-400')}>
                        {r.excessAmount > 0 ? `₹${Math.round(r.excessAmount).toLocaleString('en-IN')}` : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="font-semibold text-slate-800 border-t border-slate-100">
                    <td colSpan={4} className="py-1">Total</td>
                    <td className="py-1 text-right">{calc.excessLeaveDays}</td>
                    <td className="py-1 text-right">₹{Math.round(calc.excessLeaveAmount).toLocaleString('en-IN')}</td>
                  </tr>
                </tfoot>
              </table>
              <p className="text-[10px] text-slate-400 mt-1.5">
                Allowed = Annual × months-elapsed (Jan → resignation month) ÷ 12. No encashment for unused leave.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── CALCULATION PREVIEW MODAL ────────────────────────────────────────────────

function FnfCalculationModal({ employeeId, employeeName, open, onClose, onInitiate }: {
  employeeId: string; employeeName: string; open: boolean; onClose: () => void; onInitiate: () => void
}) {
  const qc = useQueryClient()
  const [hyiOverrides, setHyiOverrides] = useState<Record<string, number>>({})

  const { data: calc, isLoading, error } = useQuery({
    queryKey: ['fnf-calc', employeeId, hyiOverrides],
    queryFn:  () => fnfApi.calculate(employeeId, hyiOverrides).then(r => r.data.data),
    enabled:  open && !!employeeId,
    retry:    false,
    placeholderData: (prev: any) => prev,
  })

  const initiateMut = useMutation({
    mutationFn: () => fnfApi.initiate(employeeId, hyiOverrides),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['fnf-list'] })
      qc.invalidateQueries({ queryKey: ['fnf-eligible'] })
      onClose()
      onInitiate()
    },
  })

  const additions  = (calc?.breakdown || []).filter((b: any) => b.type === 'addition')
  const deductions = (calc?.breakdown || []).filter((b: any) => b.type === 'deduction')

  return (
    <Modal open={open} onClose={onClose} title={`F&F Calculation — ${employeeName}`} size="xl"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button loading={initiateMut.isPending} disabled={!calc} onClick={() => initiateMut.mutate()} icon={<CheckCircle2 size={13} />}>
            Initiate F&F
          </Button>
        </>
      }
    >
      {isLoading ? (
        <div className="space-y-2">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-4 bg-slate-100 animate-pulse rounded" />)}</div>
      ) : error || !calc ? (
        <Alert type="error" message="Could not calculate F&F. Ensure resignation date and last working day are set." />
      ) : (
        <div className="space-y-4">
          {/* Summary */}
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: 'Resignation Date', value: format(new Date(calc.resignationDate), 'dd MMM yyyy') },
              { label: 'Last Working Day', value: format(new Date(calc.lastWorkingDay),  'dd MMM yyyy') },
              { label: 'Notice Period',    value: `${calc.noticePeriodDays} days` },
              { label: 'Months Covered',   value: `${calc.noticePeriodMonths} month(s)` },
            ].map(({ label, value }) => (
              <div key={label} className="bg-slate-50 rounded-xl p-3">
                <p className="text-xs text-slate-400 mb-0.5">{label}</p>
                <p className="text-sm font-semibold text-slate-800">{value}</p>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-slate-400 -mt-1">
            Resignation month salary is paid via the normal monthly payroll, not F&F — earnings below cover only {(calc.cycles || []).map((c: any) => c.cycleLabel).join(', ')}.
          </p>

          {/* Breakdown grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-0 border border-slate-200 rounded-xl">
            <div className="px-4 py-3 border-b sm:border-b-0 sm:border-r border-slate-200">
              <p className="text-xs font-semibold text-emerald-700 mb-2">Earnings</p>
              <div className="space-y-1.5">
                {additions.map((b: any) => (
                  <div key={b.label} className="flex justify-between text-xs">
                    <span className="text-slate-600">{b.label}</span>
                    <span className="font-semibold text-slate-800">₹{Number(b.amount).toLocaleString('en-IN', { maximumFractionDigits: 0 })}</span>
                  </div>
                ))}
              </div>
              <div className="flex justify-between text-xs font-bold text-emerald-700 mt-2 pt-2 border-t border-slate-100">
                <span>Total Earnings</span>
                <span>₹{Number(calc.totalAdditions).toLocaleString('en-IN', { maximumFractionDigits: 0 })}</span>
              </div>
            </div>
            <div className="px-4 py-3">
              <p className="text-xs font-semibold text-red-600 mb-2">Deductions</p>
              <div className="space-y-1.5">
                {deductions.length === 0
                  ? <p className="text-xs text-slate-400">No deductions</p>
                  : deductions.map((b: any) => (
                    <div key={b.label} className="flex justify-between text-xs">
                      <span className="text-slate-600">{b.label}</span>
                      <span className="font-semibold text-red-700">−₹{Number(b.amount).toLocaleString('en-IN', { maximumFractionDigits: 0 })}</span>
                    </div>
                  ))}
              </div>
              <div className="flex justify-between text-xs font-bold text-red-600 mt-2 pt-2 border-t border-slate-100">
                <span>Total Deductions</span>
                <span>−₹{Number(calc.totalDeductions).toLocaleString('en-IN', { maximumFractionDigits: 0 })}</span>
              </div>
            </div>
          </div>

          {/* Calculation details (expandable) */}
          <CalculationDetailsPanel calc={calc} hyiOverrides={hyiOverrides} onHyiOverrideChange={setHyiOverrides} />

          {/* Net */}
          <div className={clsx(
            'flex justify-between items-center rounded-xl px-4 py-3 border',
            calc.isNegative ? 'bg-red-50 border-red-200' : 'bg-brand-50 border-brand-200'
          )}>
            <span className={clsx('text-sm font-bold', calc.isNegative ? 'text-red-700' : 'text-brand-700')}>
              {calc.isNegative ? 'Recoverable from Employee' : 'Net Payable to Employee'}
            </span>
            <Rupee
              amount={Math.abs(calc.netPayable)}
              className={clsx('text-lg font-display font-bold', calc.isNegative ? 'text-red-800' : 'text-brand-800')}
            />
          </div>
          {calc.isNegative && (
            <Alert type="warning" message="Deductions exceed earnings. Employee owes this amount to the company — does not auto-recover anywhere." />
          )}

          {initiateMut.isError && (
            <Alert type="error" message={(initiateMut.error as any)?.response?.data?.error || 'Failed to initiate F&F'} />
          )}
        </div>
      )}
    </Modal>
  )
}

// ─── APPROVE MODAL ────────────────────────────────────────────────────────────

function ApproveModal({ settlement, open, onClose, viewOnly = false }: { settlement: any; open: boolean; onClose: () => void; viewOnly?: boolean }) {
  const qc = useQueryClient()
  const [notes, setNotes] = useState('')

  const approveMut = useMutation({
    mutationFn: () => fnfApi.approve(settlement.id, notes),
    onSuccess:  () => { qc.invalidateQueries({ queryKey: ['fnf-list'] }); onClose() },
  })

  if (!settlement) return null

  // Use stored breakdown if available, else build from fields
  const breakdown: any[] = settlement.breakdownJson
    ? JSON.parse(settlement.breakdownJson)
    : [
        { label: `Salary (${settlement.salaryDays} days)`, amount: settlement.salaryAmount,      type: 'addition' },
        ...(Number(settlement.reimbursements) > 0 ? [{ label: 'Reimbursements', amount: settlement.reimbursements, type: 'addition' }] : []),
        { label: 'Employee PF',       amount: settlement.pfAmount,          type: 'deduction' },
        ...(Number(settlement.esiAmount) > 0        ? [{ label: 'ESI',               amount: settlement.esiAmount,         type: 'deduction' }] : []),
        ...(Number(settlement.ptAmount) > 0         ? [{ label: 'Professional Tax',  amount: settlement.ptAmount,          type: 'deduction' }] : []),
        ...(Number(settlement.tdsAmount) > 0        ? [{ label: 'TDS',               amount: settlement.tdsAmount,         type: 'deduction' }] : []),
        ...(Number(settlement.incentiveRecovery) > 0 ? [{ label: 'HYI Recovery',     amount: settlement.incentiveRecovery, type: 'deduction' }] : []),
        ...(Number(settlement.loanOutstanding) > 0   ? [{ label: 'Loan Outstanding', amount: settlement.loanOutstanding,   type: 'deduction' }] : []),
      ]

  // Frozen detail tables from initiation — same data CalculationDetailsPanel
  // shows in the live preview, but read-only and never recomputed (no drift).
  const detailCalc = {
    cycles:            settlement.cyclesJson ? JSON.parse(settlement.cyclesJson) : [],
    hyiRecovery:       settlement.incentiveRecovery,
    hyiRecoveryDetail: settlement.hyiRecoveryDetailJson ? JSON.parse(settlement.hyiRecoveryDetailJson) : [],
    excessLeaveDetail: settlement.excessLeaveDetailJson ? JSON.parse(settlement.excessLeaveDetailJson) : [],
  }

  return (
    <Modal open={open} onClose={onClose} title={viewOnly ? `F&F Settlement — ${settlement.employee?.name}` : `Approve F&F — ${settlement.employee?.name}`} size="lg"
      footer={
        viewOnly ? (
          <Button variant="secondary" onClick={onClose}>Close</Button>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button loading={approveMut.isPending} onClick={() => approveMut.mutate()} icon={<CheckCircle2 size={13} />}>
              Approve & Mark Separated
            </Button>
          </>
        )
      }
    >
      <div className="space-y-4">
        {!viewOnly && (
          <Alert type="warning" title="This action is irreversible"
            message="Approving will mark the employee as SEPARATED and finalise the settlement amount." />
        )}

        <div className="space-y-1">
          {breakdown.map((item: any) => (
            <div key={item.label} className="flex justify-between text-sm py-1.5 border-b border-slate-50">
              <span className="text-slate-600">{item.label}</span>
              <span className={clsx('font-semibold', item.type === 'addition' ? 'text-emerald-700' : 'text-red-600')}>
                {item.type === 'deduction' ? '−' : '+'} <Rupee amount={item.amount} />
              </span>
            </div>
          ))}
          <div className="flex justify-between font-bold text-brand-700 pt-2">
            <span>Net Payable</span>
            <Rupee amount={settlement.netPayable} className="text-base" />
          </div>
        </div>

        <CalculationDetailsPanel calc={detailCalc} />

        <div className="flex flex-col gap-1">
          <label className="label">Notes (optional)</label>
          <textarea value={notes} onChange={e => setNotes(e.target.value)}
            className="input resize-none" rows={2} placeholder="Any notes for this settlement…" />
        </div>
      </div>
    </Modal>
  )
}

// ─── SETTLE MODAL ─────────────────────────────────────────────────────────────

function SettleModal({ settlement, open, onClose }: { settlement: any; open: boolean; onClose: () => void }) {
  const qc = useQueryClient()
  const [notes, setNotes] = useState('')

  const settleMut = useMutation({
    mutationFn: () => fnfApi.settle(settlement.id, notes),
    onSuccess:  () => { qc.invalidateQueries({ queryKey: ['fnf-list'] }); onClose() },
  })

  if (!settlement) return null

  return (
    <Modal open={open} onClose={onClose} title={`Mark as Settled — ${settlement.employee?.name}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button loading={settleMut.isPending} onClick={() => settleMut.mutate()} icon={<Banknote size={13} />}>
            Mark as Settled
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-slate-600">
          Confirm that <strong>{settlement.employee?.name}</strong>'s F&F payment of{' '}
          <strong>₹{Number(settlement.netPayable).toLocaleString('en-IN', { maximumFractionDigits: 0 })}</strong> has been disbursed.
        </p>
        <div className="flex flex-col gap-1">
          <label className="label">Notes (optional)</label>
          <textarea value={notes} onChange={e => setNotes(e.target.value)}
            className="input resize-none" rows={2} placeholder="Payment reference, UTR number, etc." />
        </div>
        {settleMut.isError && (
          <Alert type="error" message={(settleMut.error as any)?.response?.data?.error || 'Failed'} />
        )}
      </div>
    </Modal>
  )
}

// ─── STATEMENT DOWNLOAD / GENERATE BUTTON ─────────────────────────────────

function StatementButton({ settlement }: { settlement: any }) {
  const qc = useQueryClient()
  const genMut = useMutation({
    mutationFn: () => fnfApi.generatePdf(settlement.id),
    onSuccess:  (res) => {
      qc.invalidateQueries({ queryKey: ['fnf-list'] })
      const url = res?.data?.data?.pdfUrl
      if (url) window.open(url, '_blank')
    },
  })

  if (settlement.pdfUrl) {
    return (
      <Button variant="secondary" size="sm" icon={<FileText size={12} />}
        onClick={() => window.open(settlement.pdfUrl, '_blank')}>
        Statement
      </Button>
    )
  }
  return (
    <Button variant="secondary" size="sm" icon={<FileText size={12} />}
      loading={genMut.isPending} onClick={() => genMut.mutate()}>
      Generate Statement
    </Button>
  )
}

// ─── MAIN PAGE ────────────────────────────────────────────────────────────────

export default function FnfPage() {
  const navigate = useNavigate()
  const [calcEmployee, setCalcEmployee]   = useState<any>(null)
  const [approveTarget, setApproveTarget] = useState<any>(null)
  const [settleTarget, setSettleTarget]   = useState<any>(null)
  const [viewTarget, setViewTarget]       = useState<any>(null)

  const { data: settlements, isLoading: loadingSettlements } = useQuery({
    queryKey: ['fnf-list'],
    queryFn:  () => fnfApi.list().then(r => r.data.data),
  })

  const { data: eligible, isLoading: loadingEligible } = useQuery({
    queryKey: ['fnf-eligible'],
    queryFn:  () => fnfApi.eligible().then(r => r.data.data),
  })

  const initiated = (settlements || []).filter((s: any) => s.status === 'INITIATED')
  const approved  = (settlements || []).filter((s: any) => s.status === 'APPROVED')
  const settled   = (settlements || []).filter((s: any) => s.status === 'SETTLED')

  return (
    <div className="space-y-5">
      <PageHeader title="Full & Final Settlement" subtitle="Process F&F for resigned employees" />

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: 'Eligible for F&F', value: (eligible || []).length, color: 'text-amber-600' },
          { label: 'Initiated',        value: initiated.length,        color: 'text-blue-600' },
          { label: 'Approved',         value: approved.length,         color: 'text-violet-600' },
          { label: 'Settled',          value: settled.length,          color: 'text-emerald-600' },
        ].map(({ label, value, color }) => (
          <div key={label} className="card p-4">
            <p className="stat-label">{label}</p>
            <p className={clsx('text-2xl font-display font-bold mt-1', color)}>{value}</p>
          </div>
        ))}
      </div>

      {/* Eligible — need F&F initiated */}
      {loadingEligible ? <Skeleton className="h-24" /> : (eligible || []).length > 0 && (
        <Card title="Employees Pending F&F Initiation">
          <div className="divide-y divide-slate-50">
            {(eligible || []).map((emp: any) => (
              <div key={emp.id} className="flex items-center gap-4 px-5 py-3.5 flex-wrap">
                <div className="w-9 h-9 rounded-full bg-amber-100 flex items-center justify-center flex-shrink-0">
                  <span className="text-sm font-semibold text-amber-700">{emp.name.charAt(0)}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-slate-800">{emp.name}</p>
                  <p className="text-xs text-slate-400">
                    {emp.department}
                    {emp.resignationDate && ` · Resigned ${format(new Date(emp.resignationDate), 'dd MMM yyyy')}`}
                    {emp.lastWorkingDay  && ` · LWD ${format(new Date(emp.lastWorkingDay), 'dd MMM yyyy')}`}
                  </p>
                </div>
                <StatusBadge status={emp.status} />
                {emp.lastWorkingDay ? (
                  <div className="flex gap-2">
                    <Button size="sm" icon={<Wand2 size={13} />}
                      onClick={() => navigate(`/hr/fnf/wizard/${emp.id}`)}>
                      FnF Wizard
                    </Button>
                    <Button size="sm" variant="secondary" icon={<Calculator size={13} />} onClick={() => setCalcEmployee(emp)}>
                      Calculate F&F
                    </Button>
                  </div>
                ) : (
                  <span className="text-xs text-amber-500 flex items-center gap-1">
                    <AlertTriangle size={11} /> Set last working day first
                  </span>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Initiated — pending approval */}
      {initiated.length > 0 && (
        <Card title="Pending Approval">
          <Table>
            <thead>
              <tr className="border-b border-slate-100">
                <Th>Employee</Th>
                <Th>LWD</Th>
                <Th className="text-right">Earnings</Th>
                <Th className="text-right">Deductions</Th>
                <Th className="text-right">Net Payable</Th>
                <Th>Actions</Th>
              </tr>
            </thead>
            <tbody>
              {initiated.map((s: any) => {
                const additions  = Number(s.salaryAmount) + Number(s.reimbursements)
                const deductions = Number(s.pfAmount) + Number(s.esiAmount) + Number(s.ptAmount) +
                  Number(s.tdsAmount) + Number(s.incentiveRecovery) + Number(s.loanOutstanding) + Number(s.otherDeductions)
                return (
                  <Tr key={s.id}>
                    <Td>
                      <p className="font-semibold text-slate-800">{s.employee?.name}</p>
                      <p className="text-xs text-slate-400 font-mono">{s.employee?.employeeCode}</p>
                    </Td>
                    <Td className="text-sm">{s.lastWorkingDay ? format(new Date(s.lastWorkingDay), 'dd MMM yyyy') : '—'}</Td>
                    <Td className="text-right text-emerald-600 font-semibold"><Rupee amount={additions} /></Td>
                    <Td className="text-right text-red-600 font-semibold"><Rupee amount={deductions} /></Td>
                    <Td className="text-right font-bold text-brand-700"><Rupee amount={s.netPayable} /></Td>
                    <Td>
                      <div className="flex gap-2">
                        <Button variant="secondary" size="sm" icon={<Eye size={12} />}
                          onClick={() => navigate(`/hr/employees/${s.employeeId}`)}>
                          View
                        </Button>
                        <StatementButton settlement={s} />
                        <Button size="sm" icon={<CheckCircle2 size={12} />} onClick={() => setApproveTarget(s)}>
                          Approve
                        </Button>
                      </div>
                    </Td>
                  </Tr>
                )
              })}
            </tbody>
          </Table>
        </Card>
      )}

      {/* Approved — pending payment */}
      {approved.length > 0 && (
        <Card title="Approved — Pending Payment">
          <Table>
            <thead>
              <tr className="border-b border-slate-100">
                <Th>Employee</Th>
                <Th>Approved By</Th>
                <Th>Approved On</Th>
                <Th className="text-right">Net Payable</Th>
                <Th>Actions</Th>
              </tr>
            </thead>
            <tbody>
              {approved.map((s: any) => (
                <Tr key={s.id}>
                  <Td>
                    <p className="font-semibold text-slate-800">{s.employee?.name}</p>
                    <p className="text-xs text-slate-400">{s.employee?.department}</p>
                  </Td>
                  <Td>{s.approvedByName || '—'}</Td>
                  <Td>{s.approvedAt ? format(new Date(s.approvedAt), 'dd MMM yyyy') : '—'}</Td>
                  <Td className="text-right font-bold text-brand-700"><Rupee amount={s.netPayable} /></Td>
                  <Td>
                    <div className="flex gap-2">
                      <StatementButton settlement={s} />
                      <Button size="sm" icon={<Banknote size={12} />} onClick={() => setSettleTarget(s)}>
                        Mark Settled
                      </Button>
                    </div>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}

      {/* Settled */}
      <Card title="Settled">
        {loadingSettlements ? <Skeleton className="h-40 m-4" /> : settled.length === 0 ? (
          <EmptyState icon={<GitMerge size={20} />} title="No settled payments yet"
            description="Approved F&F payments marked as settled will appear here." />
        ) : (
          <Table>
            <thead>
              <tr className="border-b border-slate-100">
                <Th>Employee</Th>
                <Th>Approved By</Th>
                <Th>Approved On</Th>
                <Th className="text-right">Net Paid</Th>
                <Th>Notes</Th>
                <Th>Statement</Th>
                <Th>Details</Th>
              </tr>
            </thead>
            <tbody>
              {settled.map((s: any) => (
                <Tr key={s.id}>
                  <Td>
                    <p className="font-semibold text-slate-800">{s.employee?.name}</p>
                    <p className="text-xs text-slate-400">{s.employee?.department}</p>
                  </Td>
                  <Td>{s.approvedByName || '—'}</Td>
                  <Td>{s.approvedAt ? format(new Date(s.approvedAt), 'dd MMM yyyy') : '—'}</Td>
                  <Td className="text-right font-bold"><Rupee amount={s.netPayable} /></Td>
                  <Td className="text-xs text-slate-400">{s.notes || '—'}</Td>
                  <Td><StatementButton settlement={s} /></Td>
                  <Td>
                    <Button variant="secondary" size="sm" icon={<Eye size={12} />} onClick={() => setViewTarget(s)}>
                      View
                    </Button>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      {calcEmployee && (
        <FnfCalculationModal
          employeeId={calcEmployee.id}
          employeeName={calcEmployee.name}
          open={!!calcEmployee}
          onClose={() => setCalcEmployee(null)}
          onInitiate={() => setCalcEmployee(null)}
        />
      )}
      <ApproveModal settlement={approveTarget} open={!!approveTarget} onClose={() => setApproveTarget(null)} />
      <ApproveModal settlement={viewTarget} open={!!viewTarget} onClose={() => setViewTarget(null)} viewOnly />
      <SettleModal  settlement={settleTarget}  open={!!settleTarget}  onClose={() => setSettleTarget(null)} />
    </div>
  )
}
