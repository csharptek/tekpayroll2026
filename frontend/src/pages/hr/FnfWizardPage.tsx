import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  CheckCircle2, ChevronLeft, ChevronRight, AlertTriangle,
  RotateCcw, User, Calendar, IndianRupee, Package,
  CreditCard, Briefcase, Clock, TrendingDown, FileText,
  Gift, Percent, BarChart3,
} from 'lucide-react'
import { format } from 'date-fns'
import clsx from 'clsx'
import { fnfApi } from '../../services/api'
import { PageHeader, Button, Alert, Skeleton, Rupee } from '../../components/ui'

// ─── TYPES ────────────────────────────────────────────────────────────────────

interface WizardStep {
  key: string
  number: number
  label: string
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function fmt(n: number) {
  return `₹${Math.round(n).toLocaleString('en-IN')}`
}

function fmtDate(d: string | Date | null | undefined) {
  if (!d) return '—'
  try { return format(new Date(d), 'dd MMM yyyy') } catch { return '—' }
}

// ─── STEP PROGRESS BAR ────────────────────────────────────────────────────────

function StepProgressBar({
  steps, currentStep, confirmedKeys, onStepClick,
}: {
  steps: WizardStep[]
  currentStep: string
  confirmedKeys: Set<string>
  onStepClick: (key: string) => void
}) {
  return (
    <div className="w-full overflow-x-auto pb-2">
      <div className="flex items-center min-w-max gap-0">
        {steps.map((step, idx) => {
          const isConfirmed = confirmedKeys.has(step.key)
          const isCurrent   = step.key === currentStep
          const isPast      = isConfirmed
          return (
            <div key={step.key} className="flex items-center">
              <button
                type="button"
                onClick={() => onStepClick(step.key)}
                className={clsx(
                  'flex flex-col items-center gap-1 px-2 transition-all',
                  isCurrent ? 'opacity-100' : isPast ? 'opacity-80 hover:opacity-100' : 'opacity-40 hover:opacity-60',
                )}
              >
                <div className={clsx(
                  'w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold border-2 transition-all',
                  isCurrent   ? 'bg-brand-600 border-brand-600 text-white shadow-md scale-110' :
                  isPast      ? 'bg-emerald-500 border-emerald-500 text-white' :
                                'bg-white border-slate-300 text-slate-400',
                )}>
                  {isPast && !isCurrent ? <CheckCircle2 size={14} /> : step.number}
                </div>
                <span className={clsx(
                  'text-[9px] font-medium leading-tight text-center max-w-[56px]',
                  isCurrent ? 'text-brand-700' : isPast ? 'text-emerald-600' : 'text-slate-400',
                )}>
                  {step.label}
                </span>
              </button>
              {idx < steps.length - 1 && (
                <div className={clsx(
                  'w-6 h-0.5 flex-shrink-0 -mt-4',
                  isPast ? 'bg-emerald-400' : 'bg-slate-200',
                )} />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── STEP WRAPPER ─────────────────────────────────────────────────────────────

function StepCard({
  title, icon, children, isConfirmed,
}: {
  title: string
  icon: React.ReactNode
  children: React.ReactNode
  isConfirmed?: boolean
}) {
  return (
    <div className={clsx(
      'border rounded-2xl overflow-hidden',
      isConfirmed ? 'border-emerald-300 bg-emerald-50/30' : 'border-slate-200 bg-white',
    )}>
      <div className={clsx(
        'flex items-center gap-3 px-5 py-3.5 border-b',
        isConfirmed ? 'border-emerald-200 bg-emerald-50' : 'border-slate-100 bg-slate-50',
      )}>
        <span className={clsx('text-sm', isConfirmed ? 'text-emerald-600' : 'text-brand-600')}>{icon}</span>
        <h3 className={clsx('text-sm font-semibold', isConfirmed ? 'text-emerald-700' : 'text-slate-800')}>{title}</h3>
        {isConfirmed && <CheckCircle2 size={14} className="ml-auto text-emerald-500" />}
      </div>
      <div className="p-5">{children}</div>
    </div>
  )
}

// ─── DATA ROW ─────────────────────────────────────────────────────────────────

function DataRow({ label, value, sub, highlight }: { label: string; value: React.ReactNode; sub?: string; highlight?: 'red' | 'green' }) {
  return (
    <div className="flex justify-between items-start py-2 border-b border-slate-50 last:border-0">
      <div>
        <span className="text-sm text-slate-600">{label}</span>
        {sub && <p className="text-[11px] text-slate-400 mt-0.5">{sub}</p>}
      </div>
      <span className={clsx(
        'text-sm font-semibold ml-4 text-right',
        highlight === 'red' ? 'text-red-600' : highlight === 'green' ? 'text-emerald-600' : 'text-slate-800',
      )}>
        {value}
      </span>
    </div>
  )
}

// ─── OVERRIDE INPUT ───────────────────────────────────────────────────────────

function OverrideField({
  label, originalValue, value, onChange, type = 'number',
}: {
  label: string
  originalValue?: number | string
  value: string
  onChange: (v: string) => void
  type?: 'number' | 'text'
}) {
  const isDirty = value !== '' && value !== String(originalValue)
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs text-slate-500">{label}</label>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        className={clsx(
          'input text-sm',
          isDirty ? 'border-amber-400 bg-amber-50 font-semibold text-amber-800' : '',
        )}
        placeholder={originalValue !== undefined ? String(originalValue) : ''}
      />
      {isDirty && originalValue !== undefined && (
        <p className="text-[10px] text-amber-600">
          Original: {typeof originalValue === 'number' ? fmt(originalValue) : originalValue}
        </p>
      )}
    </div>
  )
}

// ─── STEP COMPONENTS ─────────────────────────────────────────────────────────

function Step1BaseSalary({ data, savedOverride, onConfirm, isConfirmed }: any) {
  const d = data.baseSalary
  return (
    <StepCard title="Base Salary Structure" icon={<IndianRupee size={16} />} isConfirmed={isConfirmed}>
      <div className="space-y-1">
        <DataRow label="Annual CTC" value={fmt(d.annualCtc)} />
        <DataRow label="Basic (Monthly)" value={fmt(d.basicMonthly)} />
        <DataRow label="HRA (Monthly)" value={fmt(d.hraMonthly)} />
        <DataRow label="Transport (Monthly)" value={fmt(d.transportMonthly)} />
        <DataRow label="FBP (Monthly)" value={fmt(d.fbpMonthly)} />
        <DataRow label="HYI (Monthly)" value={fmt(d.hyiMonthly)} />
        <DataRow label="Grand Total (Monthly)" value={fmt(d.grandTotalMonthly)} highlight="green" />
        {d.effectiveDate && (
          <p className="text-[11px] text-slate-400 pt-2">
            Snapshot effective: {fmtDate(d.effectiveDate)}
          </p>
        )}
      </div>
      <div className="mt-4">
        <Button onClick={() => onConfirm(d, null)} icon={<CheckCircle2 size={13} />} disabled={isConfirmed}>
          {isConfirmed ? 'Confirmed' : 'Confirm Base Salary'}
        </Button>
      </div>
    </StepCard>
  )
}

function Step2LeavesLop({ data, savedOverride, onConfirm, isConfirmed }: any) {
  const d = data.leavesLop
  const [notes, setNotes] = useState(savedOverride?.notes || '')
  const [lopOverride, setLopOverride] = useState(savedOverride?.lopAmountOverride != null ? String(savedOverride.lopAmountOverride) : '')
  const [excessOverride, setExcessOverride] = useState(savedOverride?.excessAmountOverride != null ? String(savedOverride.excessAmountOverride) : '')

  return (
    <StepCard title="Leaves Taken & LOP" icon={<Calendar size={16} />} isConfirmed={isConfirmed}>
      {d.leaves.length === 0 ? (
        <p className="text-sm text-slate-400 mb-4">No leave applications during FnF period.</p>
      ) : (
        <div className="mb-4 overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-100 text-slate-400">
                <th className="text-left pb-1.5 font-medium">Leave Type</th>
                <th className="text-left pb-1.5 font-medium">Period</th>
                <th className="text-right pb-1.5 font-medium">Days</th>
                <th className="text-right pb-1.5 font-medium">LOP Days</th>
                <th className="text-left pb-1.5 font-medium">Note</th>
              </tr>
            </thead>
            <tbody>
              {d.leaves.map((l: any) => (
                <tr key={l.id} className="border-b border-slate-50">
                  <td className="py-1.5 capitalize font-medium text-slate-700">{l.leaveKind.toLowerCase()}</td>
                  <td className="py-1.5 text-slate-600">{fmtDate(l.startDate)} – {fmtDate(l.endDate)}</td>
                  <td className="py-1.5 text-right">{l.totalDays}{l.isHalfDay ? ' (½)' : ''}</td>
                  <td className={clsx('py-1.5 text-right font-semibold', l.lopDays > 0 || (l.appliedAfterResignation && !l.isLop) ? 'text-red-600' : 'text-slate-400')}>
                    {l.isLop ? l.lopDays : l.appliedAfterResignation ? l.totalDays : '—'}
                  </td>
                  <td className="py-1.5 text-slate-400 text-[10px]">
                    {l.isLop ? 'LOP flagged' : l.appliedAfterResignation ? 'Applied after resignation' : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="space-y-2 mb-4">
        <DataRow label="Total LOP Days" value={`${d.totalLopDays} days`} />
        <DataRow label="LOP Deduction" value={fmt(d.totalLopAmount)} highlight="red" />
        {d.excessLeaveDays > 0 && (
          <>
            <DataRow label="Excess Leave Days" value={`${d.excessLeaveDays} days`} />
            <DataRow label="Excess Leave Deduction" value={fmt(d.excessLeaveAmount)} highlight="red" />
          </>
        )}
      </div>

      <div className="space-y-3 mb-4 p-3 bg-amber-50 border border-amber-100 rounded-xl">
        <p className="text-xs font-semibold text-amber-700">Override (if incorrect)</p>
        <div className="grid grid-cols-2 gap-3">
          <OverrideField label="LOP Amount Override (₹)" originalValue={d.totalLopAmount}
            value={lopOverride} onChange={setLopOverride} />
          {d.excessLeaveAmount > 0 && (
            <OverrideField label="Excess Leave Amount Override (₹)" originalValue={d.excessLeaveAmount}
              value={excessOverride} onChange={setExcessOverride} />
          )}
        </div>
      </div>

      <div className="flex flex-col gap-2 mb-4">
        <label className="text-xs text-slate-500">Notes</label>
        <textarea value={notes} onChange={e => setNotes(e.target.value)}
          className="input resize-none text-sm" rows={2} placeholder="Optional notes…" />
      </div>

      <Button onClick={() => onConfirm(d, {
        lopAmountOverride:    lopOverride     ? Number(lopOverride)     : undefined,
        excessAmountOverride: excessOverride  ? Number(excessOverride)  : undefined,
        notes,
      })} icon={<CheckCircle2 size={13} />} disabled={isConfirmed}>
        {isConfirmed ? 'Confirmed' : 'Confirm Leaves & LOP'}
      </Button>
    </StepCard>
  )
}

function Step3ProratedSalary({ data, savedOverride, onConfirm, isConfirmed }: any) {
  const d = data.proratedSalary
  const [overrideTotal, setOverrideTotal] = useState(
    savedOverride?.totalProratedSalary != null ? String(savedOverride.totalProratedSalary) : ''
  )
  const [notes, setNotes] = useState(savedOverride?.notes || '')

  return (
    <StepCard title="Pro-rated Salary" icon={<BarChart3 size={16} />} isConfirmed={isConfirmed}>
      <div className="mb-4 overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-slate-100 text-slate-400">
              <th className="text-left pb-1.5 font-medium">Month</th>
              <th className="text-right pb-1.5 font-medium">Days (Paid/Total)</th>
              <th className="text-right pb-1.5 font-medium">Gross</th>
              <th className="text-right pb-1.5 font-medium">Prorated</th>
              <th className="text-right pb-1.5 font-medium">LOP</th>
            </tr>
          </thead>
          <tbody>
            {d.cycles.map((c: any) => (
              <tr key={c.cycleLabel} className="border-b border-slate-50">
                <td className="py-1.5 font-medium text-slate-700">{c.cycleLabel}</td>
                <td className="py-1.5 text-right text-slate-600">{c.salaryDays}/{c.totalDays}</td>
                <td className="py-1.5 text-right">{fmt(c.grossMonthly)}</td>
                <td className="py-1.5 text-right font-semibold text-emerald-700">{fmt(c.proratedSalary)}</td>
                <td className="py-1.5 text-right text-red-500">
                  {c.lopDays > 0 ? `${c.lopDays}d / ${fmt(c.lopAmount)}` : '—'}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="font-semibold text-slate-800 border-t border-slate-200">
              <td colSpan={3} className="py-1.5">Total Pro-rated Salary</td>
              <td className="py-1.5 text-right text-emerald-700">{fmt(d.totalProratedSalary)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="space-y-1 mb-4">
        <DataRow label="Resignation Date" value={fmtDate(d.resignationDate)} />
        <DataRow label="Last Working Day" value={fmtDate(d.lastWorkingDay)} />
        <DataRow label="Notice Period" value={`${d.noticePeriodDays} days (${d.noticePeriodMonths} month(s))`} />
        <p className="text-[11px] text-slate-400 pt-1">
          Resignation month salary paid via normal payroll. F&F covers the months shown above.
        </p>
      </div>

      <div className="p-3 bg-amber-50 border border-amber-100 rounded-xl mb-4">
        <p className="text-xs font-semibold text-amber-700 mb-2">Override (if incorrect)</p>
        <OverrideField label="Total Pro-rated Salary Override (₹)" originalValue={d.totalProratedSalary}
          value={overrideTotal} onChange={setOverrideTotal} />
      </div>

      <div className="flex flex-col gap-2 mb-4">
        <label className="text-xs text-slate-500">Notes</label>
        <textarea value={notes} onChange={e => setNotes(e.target.value)}
          className="input resize-none text-sm" rows={2} placeholder="Optional notes…" />
      </div>

      <Button onClick={() => onConfirm(d, {
        totalProratedSalary: overrideTotal ? Number(overrideTotal) : undefined,
        notes,
      })} icon={<CheckCircle2 size={13} />} disabled={isConfirmed}>
        {isConfirmed ? 'Confirmed' : 'Confirm Pro-rated Salary'}
      </Button>
    </StepCard>
  )
}

function Step4Reimbursements({ data, savedOverride, onConfirm, isConfirmed }: any) {
  const d = data.reimbursements
  const [overrideTotal, setOverrideTotal] = useState(
    savedOverride?.total != null ? String(savedOverride.total) : ''
  )
  const [notes, setNotes] = useState(savedOverride?.notes || '')

  return (
    <StepCard title="Reimbursements" icon={<Briefcase size={16} />} isConfirmed={isConfirmed}>
      {d.items.length === 0 ? (
        <p className="text-sm text-slate-400 mb-4">No pending reimbursements.</p>
      ) : (
        <div className="mb-4 overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-100 text-slate-400">
                <th className="text-left pb-1.5 font-medium">Category</th>
                <th className="text-left pb-1.5 font-medium">Description</th>
                <th className="text-left pb-1.5 font-medium">Date</th>
                <th className="text-right pb-1.5 font-medium">Amount</th>
              </tr>
            </thead>
            <tbody>
              {d.items.map((r: any) => (
                <tr key={r.id} className="border-b border-slate-50">
                  <td className="py-1.5 font-medium text-slate-700">{r.category}</td>
                  <td className="py-1.5 text-slate-500 max-w-[140px] truncate">{r.description || '—'}</td>
                  <td className="py-1.5 text-slate-500">{fmtDate(r.expenseDate)}</td>
                  <td className="py-1.5 text-right font-semibold text-emerald-700">{fmt(r.amount)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="font-semibold text-slate-800 border-t border-slate-200">
                <td colSpan={3} className="py-1.5">Total</td>
                <td className="py-1.5 text-right text-emerald-700">{fmt(d.total)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      <div className="p-3 bg-amber-50 border border-amber-100 rounded-xl mb-4">
        <p className="text-xs font-semibold text-amber-700 mb-2">Override</p>
        <OverrideField label="Total Reimbursements Override (₹)" originalValue={d.total}
          value={overrideTotal} onChange={setOverrideTotal} />
      </div>

      <div className="flex flex-col gap-2 mb-4">
        <label className="text-xs text-slate-500">Notes</label>
        <textarea value={notes} onChange={e => setNotes(e.target.value)}
          className="input resize-none text-sm" rows={2} placeholder="Optional notes…" />
      </div>

      <Button onClick={() => onConfirm(d, {
        total: overrideTotal ? Number(overrideTotal) : undefined,
        notes,
      })} icon={<CheckCircle2 size={13} />} disabled={isConfirmed}>
        {isConfirmed ? 'Confirmed' : 'Confirm Reimbursements'}
      </Button>
    </StepCard>
  )
}

function Step5Loans({ data, savedOverride, onConfirm, isConfirmed }: any) {
  const d = data.loans
  const [overrideTotal, setOverrideTotal] = useState(
    savedOverride?.total != null ? String(savedOverride.total) : ''
  )
  const [notes, setNotes] = useState(savedOverride?.notes || '')

  return (
    <StepCard title="Loan Deductions" icon={<CreditCard size={16} />} isConfirmed={isConfirmed}>
      {d.items.length === 0 ? (
        <p className="text-sm text-slate-400 mb-4">No active loans.</p>
      ) : (
        <div className="mb-4 overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-100 text-slate-400">
                <th className="text-left pb-1.5 font-medium">Type</th>
                <th className="text-left pb-1.5 font-medium">Purpose</th>
                <th className="text-right pb-1.5 font-medium">Principal</th>
                <th className="text-right pb-1.5 font-medium">EMI</th>
                <th className="text-right pb-1.5 font-medium">Outstanding</th>
              </tr>
            </thead>
            <tbody>
              {d.items.map((l: any) => (
                <tr key={l.id} className="border-b border-slate-50">
                  <td className="py-1.5 font-medium text-slate-700 capitalize">{l.type.toLowerCase()}</td>
                  <td className="py-1.5 text-slate-500">{l.purpose || '—'}</td>
                  <td className="py-1.5 text-right">{fmt(l.principalAmount)}</td>
                  <td className="py-1.5 text-right">{fmt(l.emiAmount)}</td>
                  <td className="py-1.5 text-right font-semibold text-red-600">{fmt(l.outstandingBalance)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="font-semibold text-slate-800 border-t border-slate-200">
                <td colSpan={4} className="py-1.5">Total Outstanding</td>
                <td className="py-1.5 text-right text-red-600">{fmt(d.total)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      <div className="p-3 bg-amber-50 border border-amber-100 rounded-xl mb-4">
        <p className="text-xs font-semibold text-amber-700 mb-2">Override</p>
        <OverrideField label="Total Loan Deduction Override (₹)" originalValue={d.total}
          value={overrideTotal} onChange={setOverrideTotal} />
      </div>

      <div className="flex flex-col gap-2 mb-4">
        <label className="text-xs text-slate-500">Notes</label>
        <textarea value={notes} onChange={e => setNotes(e.target.value)}
          className="input resize-none text-sm" rows={2} placeholder="Optional notes…" />
      </div>

      <Button onClick={() => onConfirm(d, {
        total: overrideTotal ? Number(overrideTotal) : undefined,
        notes,
      })} icon={<CheckCircle2 size={13} />} disabled={isConfirmed}>
        {isConfirmed ? 'Confirmed' : 'Confirm Loan Deductions'}
      </Button>
    </StepCard>
  )
}

function Step6PfEsiPt({ data, savedOverride, onConfirm, isConfirmed }: any) {
  const d = data.pfEsiPt
  const [pfOverride,  setPfOverride]  = useState(savedOverride?.totalPf  != null ? String(savedOverride.totalPf)  : '')
  const [esiOverride, setEsiOverride] = useState(savedOverride?.totalEsi != null ? String(savedOverride.totalEsi) : '')
  const [ptOverride,  setPtOverride]  = useState(savedOverride?.totalPt  != null ? String(savedOverride.totalPt)  : '')
  const [notes, setNotes] = useState(savedOverride?.notes || '')

  return (
    <StepCard title="PF / ESI / PT Deductions" icon={<Percent size={16} />} isConfirmed={isConfirmed}>
      <div className="mb-4 overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-slate-100 text-slate-400">
              <th className="text-left pb-1.5 font-medium">Month</th>
              <th className="text-right pb-1.5 font-medium">PF</th>
              <th className="text-right pb-1.5 font-medium">ESI</th>
              <th className="text-right pb-1.5 font-medium">PT</th>
            </tr>
          </thead>
          <tbody>
            {d.cycles.map((c: any) => (
              <tr key={c.cycleLabel} className="border-b border-slate-50">
                <td className="py-1.5 font-medium text-slate-700">{c.cycleLabel}</td>
                <td className="py-1.5 text-right text-red-600">{fmt(c.pfAmount)}</td>
                <td className="py-1.5 text-right text-red-500">{c.esiAmount > 0 ? fmt(c.esiAmount) : '—'}</td>
                <td className="py-1.5 text-right text-red-500">{c.ptAmount > 0 ? fmt(c.ptAmount) : '—'}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="font-semibold text-slate-800 border-t border-slate-200">
              <td className="py-1.5">Totals</td>
              <td className="py-1.5 text-right text-red-600">{fmt(d.totalPf)}</td>
              <td className="py-1.5 text-right text-red-500">{d.totalEsi > 0 ? fmt(d.totalEsi) : '—'}</td>
              <td className="py-1.5 text-right text-red-500">{d.totalPt > 0 ? fmt(d.totalPt) : '—'}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="p-3 bg-amber-50 border border-amber-100 rounded-xl mb-4">
        <p className="text-xs font-semibold text-amber-700 mb-2">Override</p>
        <div className="grid grid-cols-3 gap-3">
          <OverrideField label="PF (₹)"  originalValue={d.totalPf}  value={pfOverride}  onChange={setPfOverride} />
          <OverrideField label="ESI (₹)" originalValue={d.totalEsi} value={esiOverride} onChange={setEsiOverride} />
          <OverrideField label="PT (₹)"  originalValue={d.totalPt}  value={ptOverride}  onChange={setPtOverride} />
        </div>
      </div>

      <div className="flex flex-col gap-2 mb-4">
        <label className="text-xs text-slate-500">Notes</label>
        <textarea value={notes} onChange={e => setNotes(e.target.value)}
          className="input resize-none text-sm" rows={2} placeholder="Optional notes…" />
      </div>

      <Button onClick={() => onConfirm(d, {
        totalPf:  pfOverride  ? Number(pfOverride)  : undefined,
        totalEsi: esiOverride ? Number(esiOverride) : undefined,
        totalPt:  ptOverride  ? Number(ptOverride)  : undefined,
        notes,
      })} icon={<CheckCircle2 size={13} />} disabled={isConfirmed}>
        {isConfirmed ? 'Confirmed' : 'Confirm PF / ESI / PT'}
      </Button>
    </StepCard>
  )
}

function Step7Assets({ data, savedOverride, onConfirm, isConfirmed }: any) {
  const d = data.assets
  const [notes, setNotes] = useState(savedOverride?.notes || '')
  const [clearedIds, setClearedIds] = useState<Set<string>>(
    new Set(savedOverride?.clearedIds || [])
  )

  const toggle = (id: string) => setClearedIds(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })

  const stillUnreturned = d.items.filter((a: any) => !clearedIds.has(a.id))

  return (
    <StepCard title="Asset Clearance" icon={<Package size={16} />} isConfirmed={isConfirmed}>
      {d.items.length === 0 ? (
        <div className="flex items-center gap-2 mb-4">
          <CheckCircle2 size={16} className="text-emerald-500" />
          <p className="text-sm text-emerald-600 font-medium">No unreturned assets. Clearance is clear.</p>
        </div>
      ) : (
        <>
          {stillUnreturned.length > 0 && (
            <Alert type="warning" message={`${stillUnreturned.length} asset(s) not yet returned. Mark as cleared below if returned physically.`} className="mb-4" />
          )}
          <div className="mb-4 overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-100 text-slate-400">
                  <th className="text-left pb-1.5 font-medium">Asset</th>
                  <th className="text-left pb-1.5 font-medium">Category</th>
                  <th className="text-left pb-1.5 font-medium">Assigned</th>
                  <th className="text-center pb-1.5 font-medium">Cleared</th>
                </tr>
              </thead>
              <tbody>
                {d.items.map((a: any) => (
                  <tr key={a.id} className={clsx(
                    'border-b border-slate-50',
                    clearedIds.has(a.id) ? 'opacity-50' : '',
                  )}>
                    <td className="py-1.5 font-medium text-slate-700">
                      {a.assetName}
                      <span className="block text-[10px] text-slate-400 font-mono">{a.assetCode}</span>
                    </td>
                    <td className="py-1.5 text-slate-500">{a.category}</td>
                    <td className="py-1.5 text-slate-500">{fmtDate(a.assignedDate)}</td>
                    <td className="py-1.5 text-center">
                      <input type="checkbox" checked={clearedIds.has(a.id)}
                        onChange={() => toggle(a.id)}
                        className="w-4 h-4 accent-emerald-500" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <div className="flex flex-col gap-2 mb-4">
        <label className="text-xs text-slate-500">Notes</label>
        <textarea value={notes} onChange={e => setNotes(e.target.value)}
          className="input resize-none text-sm" rows={2} placeholder="Optional notes on asset return…" />
      </div>

      <Button onClick={() => onConfirm(d, { clearedIds: Array.from(clearedIds), notes })}
        icon={<CheckCircle2 size={13} />} disabled={isConfirmed}>
        {isConfirmed ? 'Confirmed' : 'Confirm Asset Clearance'}
      </Button>
    </StepCard>
  )
}

function Step8NoticeRecovery({ data, savedOverride, onConfirm, isConfirmed }: any) {
  const d = data.noticeRecovery
  const [overrideAmt, setOverrideAmt] = useState(
    savedOverride?.recoveryAmount != null ? String(savedOverride.recoveryAmount) : ''
  )
  const [notes, setNotes] = useState(savedOverride?.notes || '')

  return (
    <StepCard title="Notice Period Recovery" icon={<Clock size={16} />} isConfirmed={isConfirmed}>
      <div className="space-y-1 mb-4">
        <DataRow label="Required Notice" value={`${d.requiredNoticeDays} days`} />
        <DataRow label="Actual Notice Served" value={`${d.actualNoticeDays} days`} />
        <DataRow label="Shortfall" value={`${d.shortfallDays} days`}
          highlight={d.shortfallDays > 0 ? 'red' : undefined} />
        {d.shortfallDays > 0 && (
          <DataRow label="Recovery Amount" value={fmt(d.recoveryAmount)} highlight="red" />
        )}
        {d.buyoutAmount > 0 && (
          <DataRow label="Buyout Amount (already paid by employee)" value={fmt(d.buyoutAmount)} />
        )}
        {d.noticePeriodServed && (
          <div className="flex items-center gap-1.5 pt-1">
            <CheckCircle2 size={13} className="text-emerald-500" />
            <span className="text-xs text-emerald-600">Notice period marked as served</span>
          </div>
        )}
        {d.shortfallDays === 0 && (
          <p className="text-sm text-emerald-600 font-medium pt-2">No recovery needed.</p>
        )}
      </div>

      {d.shortfallDays > 0 && (
        <div className="p-3 bg-amber-50 border border-amber-100 rounded-xl mb-4">
          <p className="text-xs font-semibold text-amber-700 mb-2">Override</p>
          <OverrideField label="Recovery Amount Override (₹)" originalValue={d.recoveryAmount}
            value={overrideAmt} onChange={setOverrideAmt} />
        </div>
      )}

      <div className="flex flex-col gap-2 mb-4">
        <label className="text-xs text-slate-500">Notes</label>
        <textarea value={notes} onChange={e => setNotes(e.target.value)}
          className="input resize-none text-sm" rows={2} placeholder="Optional notes…" />
      </div>

      <Button onClick={() => onConfirm(d, {
        recoveryAmount: overrideAmt ? Number(overrideAmt) : d.recoveryAmount,
        notes,
      })} icon={<CheckCircle2 size={13} />} disabled={isConfirmed}>
        {isConfirmed ? 'Confirmed' : 'Confirm Notice Recovery'}
      </Button>
    </StepCard>
  )
}

function Step9SalaryPaid({ data, savedOverride, onConfirm, isConfirmed }: any) {
  const d = data.salaryPaid
  const [notes, setNotes] = useState(savedOverride?.notes || '')

  return (
    <StepCard title="Salary Already Paid via Payroll" icon={<TrendingDown size={16} />} isConfirmed={isConfirmed}>
      {d.entries.length === 0 ? (
        <p className="text-sm text-slate-400 mb-4">No payroll cycles processed after resignation date.</p>
      ) : (
        <>
          <Alert type="info"
            message="These are salaries already paid via normal payroll cycles after resignation. Shown for reference — no deduction here; accounted separately."
            className="mb-4" />
          <div className="mb-4 overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-100 text-slate-400">
                  <th className="text-left pb-1.5 font-medium">Cycle</th>
                  <th className="text-right pb-1.5 font-medium">Days</th>
                  <th className="text-right pb-1.5 font-medium">Gross</th>
                  <th className="text-right pb-1.5 font-medium">LOP</th>
                  <th className="text-right pb-1.5 font-medium">Net Paid</th>
                </tr>
              </thead>
              <tbody>
                {d.entries.map((e: any, i: number) => (
                  <tr key={i} className="border-b border-slate-50">
                    <td className="py-1.5 font-medium text-slate-700">{e.cycleMonth}</td>
                    <td className="py-1.5 text-right text-slate-600">
                      {e.isProrated ? `${e.payableDays}/${e.totalDays}` : 'Full'}
                    </td>
                    <td className="py-1.5 text-right">{fmt(e.proratedGross)}</td>
                    <td className="py-1.5 text-right text-red-500">
                      {e.lopDays > 0 ? `${e.lopDays}d / ${fmt(e.lopAmount)}` : '—'}
                    </td>
                    <td className="py-1.5 text-right font-semibold text-emerald-700">{fmt(e.netSalary)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="font-semibold text-slate-800 border-t border-slate-200">
                  <td colSpan={4} className="py-1.5">Total Paid</td>
                  <td className="py-1.5 text-right text-emerald-700">{fmt(d.totalPaid)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}

      <div className="flex flex-col gap-2 mb-4">
        <label className="text-xs text-slate-500">Notes</label>
        <textarea value={notes} onChange={e => setNotes(e.target.value)}
          className="input resize-none text-sm" rows={2} placeholder="Optional notes…" />
      </div>

      <Button onClick={() => onConfirm(d, { notes })} icon={<CheckCircle2 size={13} />} disabled={isConfirmed}>
        {isConfirmed ? 'Confirmed' : 'Confirm Salary Paid Reference'}
      </Button>
    </StepCard>
  )
}

function Step10Hyi({ data, savedOverride, onConfirm, isConfirmed }: any) {
  const d = data.hyi
  const [monthOverrides, setMonthOverrides] = useState<Record<string, string>>(
    savedOverride?.hyiMonthOverrides
      ? Object.fromEntries(Object.entries(savedOverride.hyiMonthOverrides).map(([k, v]) => [k, String(v)]))
      : {}
  )
  const [notes, setNotes] = useState(savedOverride?.notes || '')

  const setMonth = (key: string, val: string) => setMonthOverrides(prev => ({ ...prev, [key]: val }))

  const computedTotal = d.hyiRecoveryDetail.reduce((sum: number, r: any) => {
    const ov = monthOverrides[r.monthKey]
    return sum + (ov !== undefined && ov !== '' ? Number(ov) : r.amount)
  }, 0)

  return (
    <StepCard title="HYI Adjustment" icon={<TrendingDown size={16} />} isConfirmed={isConfirmed}>
      {d.hyiRecoveryDetail.length === 0 ? (
        <p className="text-sm text-slate-400 mb-4">No HYI recovery applicable.</p>
      ) : (
        <div className="mb-4 overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-100 text-slate-400">
                <th className="text-left pb-1.5 font-medium">Month</th>
                <th className="text-right pb-1.5 font-medium">System Amount</th>
                <th className="text-right pb-1.5 font-medium">Override</th>
              </tr>
            </thead>
            <tbody>
              {d.hyiRecoveryDetail.map((r: any) => {
                const ov = monthOverrides[r.monthKey]
                const isDirty = ov !== undefined && ov !== '' && Number(ov) !== r.amount
                return (
                  <tr key={r.monthKey} className="border-b border-slate-50">
                    <td className="py-1.5 font-medium text-slate-700">{r.monthLabel}</td>
                    <td className="py-1.5 text-right text-slate-500">{fmt(r.systemAmount)}</td>
                    <td className="py-1.5 text-right">
                      <input
                        type="number"
                        value={ov !== undefined ? ov : r.amount}
                        onChange={e => setMonth(r.monthKey, e.target.value)}
                        className={clsx(
                          'w-24 text-right border rounded px-1.5 py-0.5 text-[11px]',
                          isDirty ? 'border-amber-400 bg-amber-50 text-amber-800 font-semibold' : 'border-slate-200',
                        )}
                      />
                    </td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot>
              <tr className="font-semibold text-slate-800 border-t border-slate-200">
                <td colSpan={2} className="py-1.5">Total HYI Recovery</td>
                <td className="py-1.5 text-right text-red-600">{fmt(computedTotal)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      <div className="flex flex-col gap-2 mb-4">
        <label className="text-xs text-slate-500">Notes</label>
        <textarea value={notes} onChange={e => setNotes(e.target.value)}
          className="input resize-none text-sm" rows={2} placeholder="Optional notes…" />
      </div>

      <Button onClick={() => {
        const finalOverrides: Record<string, number> = {}
        for (const [k, v] of Object.entries(monthOverrides)) {
          if (v !== '' && v !== undefined) finalOverrides[k] = Number(v)
        }
        onConfirm(d, { hyiMonthOverrides: finalOverrides, hyiRecovery: computedTotal, notes })
      }} icon={<CheckCircle2 size={13} />} disabled={isConfirmed}>
        {isConfirmed ? 'Confirmed' : 'Confirm HYI Adjustment'}
      </Button>
    </StepCard>
  )
}

function Step11BonusProration({ data, savedOverride, onConfirm, isConfirmed }: any) {
  const d = data.bonusProration
  const [bonusRecoveryOverride, setBonusRecoveryOverride] = useState(
    savedOverride?.bonusRecovery != null ? String(savedOverride.bonusRecovery) : ''
  )
  const [bonusDueOverride, setBonusDueOverride] = useState(
    savedOverride?.bonusDue != null ? String(savedOverride.bonusDue) : ''
  )
  const [notes, setNotes] = useState(savedOverride?.notes || '')

  return (
    <StepCard title="Bonus Pro-ration" icon={<Gift size={16} />} isConfirmed={isConfirmed}>
      <div className="space-y-1 mb-4">
        <DataRow label="Annual Bonus (CTC)" value={fmt(d.annualBonus)} />
        <DataRow label="Months Worked / Period" value={`${d.monthsWorked} / ${d.monthsInPeriod}`} />
        <DataRow label="Prorated Bonus (Earned)" value={fmt(d.proratedBonus)} />
        <DataRow label="Bonus Already Paid via Payroll" value={fmt(d.bonusAlreadyPaid)} />
        {d.bonusRecovery > 0 && (
          <DataRow label="Bonus Recovery (Paid > Earned)" value={fmt(d.bonusRecovery)} highlight="red" />
        )}
        {d.bonusDue > 0 && (
          <DataRow label="Bonus Still Due (Earned > Paid)" value={fmt(d.bonusDue)} highlight="green" />
        )}
        {d.bonusRecovery === 0 && d.bonusDue === 0 && (
          <p className="text-sm text-slate-400 pt-2">Bonus already settled correctly. No adjustment needed.</p>
        )}
      </div>

      <div className="p-3 bg-amber-50 border border-amber-100 rounded-xl mb-4">
        <p className="text-xs font-semibold text-amber-700 mb-2">Override</p>
        <div className="grid grid-cols-2 gap-3">
          <OverrideField label="Bonus Recovery (₹)" originalValue={d.bonusRecovery}
            value={bonusRecoveryOverride} onChange={setBonusRecoveryOverride} />
          <OverrideField label="Bonus Due (₹)" originalValue={d.bonusDue}
            value={bonusDueOverride} onChange={setBonusDueOverride} />
        </div>
      </div>

      <div className="flex flex-col gap-2 mb-4">
        <label className="text-xs text-slate-500">Notes</label>
        <textarea value={notes} onChange={e => setNotes(e.target.value)}
          className="input resize-none text-sm" rows={2} placeholder="Optional notes…" />
      </div>

      <Button onClick={() => onConfirm(d, {
        bonusRecovery: bonusRecoveryOverride ? Number(bonusRecoveryOverride) : d.bonusRecovery,
        bonusDue:      bonusDueOverride      ? Number(bonusDueOverride)      : d.bonusDue,
        notes,
      })} icon={<CheckCircle2 size={13} />} disabled={isConfirmed}>
        {isConfirmed ? 'Confirmed' : 'Confirm Bonus Pro-ration'}
      </Button>
    </StepCard>
  )
}

function Step12Tds({ data, savedOverride, onConfirm, isConfirmed }: any) {
  const d = data.tds
  const [overrideTotal, setOverrideTotal] = useState(
    savedOverride?.total != null ? String(savedOverride.total) : ''
  )
  const [notes, setNotes] = useState(savedOverride?.notes || '')

  return (
    <StepCard title="TDS" icon={<FileText size={16} />} isConfirmed={isConfirmed}>
      {d.cycles.length === 0 ? (
        <p className="text-sm text-slate-400 mb-4">No TDS applicable.</p>
      ) : (
        <div className="mb-4 overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-100 text-slate-400">
                <th className="text-left pb-1.5 font-medium">Month</th>
                <th className="text-right pb-1.5 font-medium">TDS</th>
              </tr>
            </thead>
            <tbody>
              {d.cycles.map((c: any) => (
                <tr key={c.cycleLabel} className="border-b border-slate-50">
                  <td className="py-1.5 font-medium text-slate-700">{c.cycleLabel}</td>
                  <td className="py-1.5 text-right text-red-600">{fmt(c.tdsAmount)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="font-semibold text-slate-800 border-t border-slate-200">
                <td className="py-1.5">Total TDS</td>
                <td className="py-1.5 text-right text-red-600">{fmt(d.total)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      <div className="p-3 bg-amber-50 border border-amber-100 rounded-xl mb-4">
        <p className="text-xs font-semibold text-amber-700 mb-2">Override</p>
        <OverrideField label="Total TDS Override (₹)" originalValue={d.total}
          value={overrideTotal} onChange={setOverrideTotal} />
      </div>

      <div className="flex flex-col gap-2 mb-4">
        <label className="text-xs text-slate-500">Notes</label>
        <textarea value={notes} onChange={e => setNotes(e.target.value)}
          className="input resize-none text-sm" rows={2} placeholder="Optional notes…" />
      </div>

      <Button onClick={() => onConfirm(d, {
        total: overrideTotal ? Number(overrideTotal) : undefined,
        notes,
      })} icon={<CheckCircle2 size={13} />} disabled={isConfirmed}>
        {isConfirmed ? 'Confirmed' : 'Confirm TDS'}
      </Button>
    </StepCard>
  )
}

function Step13FinalSummary({ stepData, confirmedSteps, onComplete, isLoading, completedSettlement }: {
  stepData: any
  confirmedSteps: Record<string, any>
  onComplete: () => void
  isLoading: boolean
  completedSettlement: any
}) {
  if (completedSettlement) {
    const net = Number(completedSettlement.settlement?.netPayable || 0)
    const isNeg = completedSettlement.summary?.isNegative
    return (
      <StepCard title="F&F Complete" icon={<CheckCircle2 size={16} />} isConfirmed>
        <div className={clsx(
          'flex justify-between items-center rounded-xl px-4 py-4 mb-4',
          isNeg ? 'bg-red-50 border border-red-200' : 'bg-emerald-50 border border-emerald-200',
        )}>
          <span className={clsx('text-base font-bold', isNeg ? 'text-red-700' : 'text-emerald-700')}>
            {isNeg ? 'Recoverable from Employee' : 'Net Payable to Employee'}
          </span>
          <span className={clsx('text-xl font-display font-bold', isNeg ? 'text-red-800' : 'text-emerald-800')}>
            {fmt(net)}
          </span>
        </div>
        <div className="space-y-1 mb-4">
          {(completedSettlement.summary?.breakdown || []).map((b: any) => (
            <div key={b.label} className="flex justify-between text-sm py-1.5 border-b border-slate-50">
              <span className="text-slate-600">{b.label}</span>
              <span className={clsx('font-semibold', b.type === 'addition' ? 'text-emerald-600' : 'text-red-600')}>
                {b.type === 'deduction' ? '−' : '+'}{fmt(b.amount)}
              </span>
            </div>
          ))}
        </div>
        <Alert type="success" message="F&F wizard completed. Settlement record has been created/updated. You can now approve it from the F&F list." />
      </StepCard>
    )
  }

  const d = stepData

  // Build summary from step overrides
  const proratedStep   = confirmedSteps['PRORATED_SALARY']
  const reimStep       = confirmedSteps['REIMBURSEMENTS']
  const loansStep      = confirmedSteps['LOANS']
  const pfStep         = confirmedSteps['PF_ESI_PT']
  const noticeStep     = confirmedSteps['NOTICE_RECOVERY']
  const tdsStep        = confirmedSteps['TDS']
  const bonusStep      = confirmedSteps['BONUS_PRORATION']
  const hyiStep        = confirmedSteps['HYI']

  const salaryAmount    = proratedStep?.totalProratedSalary ?? d.proratedSalary.totalProratedSalary
  const reimbursements  = reimStep?.total ?? d.reimbursements.total
  const loanOutstanding = loansStep?.total ?? d.loans.total
  const pfAmount        = pfStep?.totalPf  ?? d.pfEsiPt.totalPf
  const esiAmount       = pfStep?.totalEsi ?? d.pfEsiPt.totalEsi
  const ptAmount        = pfStep?.totalPt  ?? d.pfEsiPt.totalPt
  const tdsAmount       = tdsStep?.total   ?? d.tds.total
  const hyiRecovery     = hyiStep?.hyiRecovery ?? d.hyi.hyiRecovery
  const noticeRecovery  = noticeStep?.recoveryAmount ?? 0
  const bonusRecovery   = bonusStep?.bonusRecovery   ?? 0
  const lopAmount       = d.leavesLop.totalLopAmount
  const excessLeave     = d.leavesLop.excessLeaveAmount || 0

  const totalAdditions  = salaryAmount + reimbursements
  const totalDeductions = pfAmount + esiAmount + ptAmount + tdsAmount +
    loanOutstanding + hyiRecovery + lopAmount + excessLeave + noticeRecovery + bonusRecovery
  const net = totalAdditions - totalDeductions
  const isNeg = net < 0

  const lines = [
    { label: 'Pro-rated Salary', amount: salaryAmount, type: 'addition' as const },
    ...(reimbursements > 0 ? [{ label: 'Reimbursements', amount: reimbursements, type: 'addition' as const }] : []),
    { label: 'Employee PF', amount: pfAmount, type: 'deduction' as const },
    ...(esiAmount > 0 ? [{ label: 'ESI', amount: esiAmount, type: 'deduction' as const }] : []),
    ...(ptAmount  > 0 ? [{ label: 'Professional Tax', amount: ptAmount, type: 'deduction' as const }] : []),
    ...(tdsAmount > 0 ? [{ label: 'TDS', amount: tdsAmount, type: 'deduction' as const }] : []),
    ...(loanOutstanding > 0 ? [{ label: 'Loan Outstanding', amount: loanOutstanding, type: 'deduction' as const }] : []),
    ...(hyiRecovery > 0 ? [{ label: 'HYI Recovery', amount: hyiRecovery, type: 'deduction' as const }] : []),
    ...(lopAmount > 0 ? [{ label: `LOP Deduction`, amount: lopAmount, type: 'deduction' as const }] : []),
    ...(excessLeave > 0 ? [{ label: 'Excess Leave Recovery', amount: excessLeave, type: 'deduction' as const }] : []),
    ...(noticeRecovery > 0 ? [{ label: 'Notice Period Recovery', amount: noticeRecovery, type: 'deduction' as const }] : []),
    ...(bonusRecovery  > 0 ? [{ label: 'Bonus Recovery', amount: bonusRecovery, type: 'deduction' as const }] : []),
  ]

  return (
    <StepCard title="Final F&F Summary" icon={<BarChart3 size={16} />}>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-0 border border-slate-200 rounded-xl mb-4 overflow-hidden">
        <div className="px-4 py-3 border-b sm:border-b-0 sm:border-r border-slate-200">
          <p className="text-xs font-semibold text-emerald-700 mb-2">Earnings</p>
          {lines.filter(l => l.type === 'addition').map(l => (
            <div key={l.label} className="flex justify-between text-sm py-1">
              <span className="text-slate-600">{l.label}</span>
              <span className="font-semibold text-emerald-700">+{fmt(l.amount)}</span>
            </div>
          ))}
          <div className="flex justify-between text-sm font-bold text-emerald-700 border-t border-slate-100 mt-1 pt-2">
            <span>Total Earnings</span><span>{fmt(totalAdditions)}</span>
          </div>
        </div>
        <div className="px-4 py-3">
          <p className="text-xs font-semibold text-red-600 mb-2">Deductions</p>
          {lines.filter(l => l.type === 'deduction').map(l => (
            <div key={l.label} className="flex justify-between text-sm py-1">
              <span className="text-slate-600">{l.label}</span>
              <span className="font-semibold text-red-600">−{fmt(l.amount)}</span>
            </div>
          ))}
          <div className="flex justify-between text-sm font-bold text-red-600 border-t border-slate-100 mt-1 pt-2">
            <span>Total Deductions</span><span>{fmt(totalDeductions)}</span>
          </div>
        </div>
      </div>

      <div className={clsx(
        'flex justify-between items-center rounded-xl px-4 py-4 mb-4 border',
        isNeg ? 'bg-red-50 border-red-200' : 'bg-emerald-50 border-emerald-200',
      )}>
        <span className={clsx('text-base font-bold', isNeg ? 'text-red-700' : 'text-emerald-700')}>
          {isNeg ? 'Recoverable from Employee' : 'Net Payable to Employee'}
        </span>
        <span className={clsx('text-xl font-display font-bold', isNeg ? 'text-red-800' : 'text-emerald-800')}>
          {fmt(Math.abs(net))}
        </span>
      </div>

      <Button loading={isLoading} onClick={onComplete} icon={<CheckCircle2 size={13} />}
        className="w-full justify-center">
        Complete Wizard & Create/Update Settlement
      </Button>
    </StepCard>
  )
}

// ─── MAIN PAGE ────────────────────────────────────────────────────────────────

export default function FnfWizardPage() {
  const { employeeId } = useParams<{ employeeId: string }>()
  const navigate = useNavigate()
  const qc = useQueryClient()

  const [activeStep, setActiveStep] = useState<string>('BASE_SALARY')
  const [confirmedSteps, setConfirmedSteps] = useState<Record<string, any>>({})
  const [completedSettlement, setCompletedSettlement] = useState<any>(null)

  const [hyiOverrides, setHyiOverrides] = useState<Record<string, number>>({})

  const { data: sessionData, isLoading: loadingSession } = useQuery({
    queryKey: ['fnf-wizard-session', employeeId],
    queryFn:  () => fnfApi.wizard.getSession(employeeId!).then(r => r.data.data),
    enabled:  !!employeeId,
  })

  const { data: stepData, isLoading: loadingStepData } = useQuery({
    queryKey: ['fnf-wizard-step-data', employeeId, hyiOverrides],
    queryFn:  () => fnfApi.wizard.getStepData(employeeId!, Object.keys(hyiOverrides).length ? hyiOverrides : undefined).then(r => r.data.data),
    enabled:  !!employeeId,
    retry:    false,
  })

  // Restore saved step overrides from session
  useEffect(() => {
    if (sessionData?.session?.steps) {
      const saved: Record<string, any> = {}
      for (const s of sessionData.session.steps) {
        saved[s.stepKey] = s.overrideData || {}
      }
      setConfirmedSteps(saved)

      // Restore HYI overrides if saved
      const hyiStep = sessionData.session.steps.find((s: any) => s.stepKey === 'HYI')
      if (hyiStep?.overrideData?.hyiMonthOverrides) {
        setHyiOverrides(hyiStep.overrideData.hyiMonthOverrides)
      }

      // Set current step from session
      if (sessionData.session.currentStep && !completedSettlement) {
        setActiveStep(sessionData.session.currentStep)
      }
    }
  }, [sessionData])

  const confirmMut = useMutation({
    mutationFn: ({ stepKey, originalData, overrideData, notes }: any) =>
      fnfApi.wizard.confirmStep(employeeId!, stepKey, { originalData, overrideData, notes }),
    onSuccess: (_, vars) => {
      setConfirmedSteps(prev => ({ ...prev, [vars.stepKey]: vars.overrideData || {} }))
      if (vars.stepKey === 'HYI' && vars.overrideData?.hyiMonthOverrides) {
        setHyiOverrides(vars.overrideData.hyiMonthOverrides)
        qc.invalidateQueries({ queryKey: ['fnf-wizard-step-data', employeeId] })
      }
      // Move to next step
      const steps = sessionData?.steps || []
      const idx = steps.findIndex((s: WizardStep) => s.key === vars.stepKey)
      if (idx < steps.length - 1) setActiveStep(steps[idx + 1].key)
      qc.invalidateQueries({ queryKey: ['fnf-wizard-session', employeeId] })
    },
  })

  const completeMut = useMutation({
    mutationFn: () => fnfApi.wizard.complete(employeeId!),
    onSuccess: (res) => {
      setCompletedSettlement(res.data.data)
      qc.invalidateQueries({ queryKey: ['fnf-list'] })
      qc.invalidateQueries({ queryKey: ['fnf-eligible'] })
    },
  })

  const resetMut = useMutation({
    mutationFn: () => fnfApi.wizard.reset(employeeId!),
    onSuccess: () => {
      setConfirmedSteps({})
      setCompletedSettlement(null)
      setHyiOverrides({})
      setActiveStep('BASE_SALARY')
      qc.invalidateQueries({ queryKey: ['fnf-wizard-session', employeeId] })
    },
  })

  const steps: WizardStep[] = sessionData?.steps || []
  const employee = sessionData?.employee
  const confirmedKeys = new Set(Object.keys(confirmedSteps).filter(k => {
    const savedStep = sessionData?.session?.steps?.find((s: any) => s.stepKey === k)
    return !!savedStep?.confirmedAt
  }))

  const handleConfirm = (stepKey: string, originalData: any, overrideData: any) => {
    const hasOverride = overrideData && Object.values(overrideData).some(v => v !== undefined && v !== null && v !== '')
    confirmMut.mutate({
      stepKey,
      originalData,
      overrideData: hasOverride ? overrideData : null,
      notes: overrideData?.notes,
    })
  }

  if (loadingSession) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  const savedOverrideFor = (key: string) => {
    const s = sessionData?.session?.steps?.find((st: any) => st.stepKey === key)
    return s?.overrideData || null
  }

  const stepProps = (key: string) => ({
    data: stepData,
    savedOverride: savedOverrideFor(key),
    isConfirmed: confirmedKeys.has(key),
    onConfirm: (orig: any, over: any) => handleConfirm(key, orig, over),
  })

  const renderStep = () => {
    if (!stepData) return <Skeleton className="h-64" />

    switch (activeStep) {
      case 'BASE_SALARY':     return <Step1BaseSalary     {...stepProps('BASE_SALARY')} />
      case 'LEAVES_LOP':      return <Step2LeavesLop      {...stepProps('LEAVES_LOP')} />
      case 'PRORATED_SALARY': return <Step3ProratedSalary {...stepProps('PRORATED_SALARY')} />
      case 'REIMBURSEMENTS':  return <Step4Reimbursements {...stepProps('REIMBURSEMENTS')} />
      case 'LOANS':           return <Step5Loans          {...stepProps('LOANS')} />
      case 'PF_ESI_PT':       return <Step6PfEsiPt        {...stepProps('PF_ESI_PT')} />
      case 'ASSETS':          return <Step7Assets         {...stepProps('ASSETS')} />
      case 'NOTICE_RECOVERY': return <Step8NoticeRecovery {...stepProps('NOTICE_RECOVERY')} />
      case 'SALARY_PAID':     return <Step9SalaryPaid     {...stepProps('SALARY_PAID')} />
      case 'HYI':             return <Step10Hyi           {...stepProps('HYI')} />
      case 'BONUS_PRORATION': return <Step11BonusProration {...stepProps('BONUS_PRORATION')} />
      case 'TDS':             return <Step12Tds           {...stepProps('TDS')} />
      case 'FINAL_SUMMARY':   return (
        <Step13FinalSummary
          stepData={stepData}
          confirmedSteps={confirmedSteps}
          onComplete={() => completeMut.mutate()}
          isLoading={completeMut.isPending}
          completedSettlement={completedSettlement}
        />
      )
      default: return null
    }
  }

  const currentStepIdx = steps.findIndex(s => s.key === activeStep)
  const canGoBack  = currentStepIdx > 0
  const canGoNext  = currentStepIdx < steps.length - 1

  return (
    <div className="space-y-5 pb-10">
      <div className="flex items-center gap-4 flex-wrap">
        <button onClick={() => navigate('/hr/fnf')}
          className="flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700">
          <ChevronLeft size={15} /> F&F List
        </button>
        <PageHeader
          title={`F&F Wizard${employee ? ` — ${employee.name}` : ''}`}
          subtitle={employee ? `${employee.department || ''} · ${employee.employeeCode}` : ''}
        />
        <div className="ml-auto flex gap-2">
          <Button variant="secondary" size="sm" icon={<RotateCcw size={13} />}
            loading={resetMut.isPending}
            onClick={() => { if (confirm('Reset wizard? All confirmed steps will be cleared.')) resetMut.mutate() }}>
            Reset
          </Button>
        </div>
      </div>

      {/* Progress bar */}
      <div className="card p-4">
        <StepProgressBar
          steps={steps}
          currentStep={activeStep}
          confirmedKeys={confirmedKeys}
          onStepClick={setActiveStep}
        />
      </div>

      {/* Error */}
      {(confirmMut.isError || completeMut.isError) && (
        <Alert type="error"
          message={(confirmMut.error as any)?.response?.data?.error ||
                   (completeMut.error as any)?.response?.data?.error || 'Something went wrong'} />
      )}

      {/* Step content */}
      {loadingStepData ? <Skeleton className="h-64" /> : renderStep()}

      {/* Navigation */}
      {!completedSettlement && (
        <div className="flex justify-between pt-2">
          <Button variant="secondary" disabled={!canGoBack}
            icon={<ChevronLeft size={14} />}
            onClick={() => setActiveStep(steps[currentStepIdx - 1]?.key)}>
            Previous
          </Button>
          <Button variant="secondary" disabled={!canGoNext}
            onClick={() => setActiveStep(steps[currentStepIdx + 1]?.key)}>
            Next <ChevronRight size={14} />
          </Button>
        </div>
      )}
    </div>
  )
}
