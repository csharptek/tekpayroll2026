import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import {
  GitMerge, Calculator, CheckCircle2, Eye,
  User, Calendar, AlertTriangle, ArrowRight
} from 'lucide-react'
import { format } from 'date-fns'
import { fnfApi } from '../../services/api'
import {
  PageHeader, Button, Card, Modal, Alert, Skeleton,
  Table, Th, Td, Tr, EmptyState, Rupee, StatusBadge
} from '../../components/ui'
import clsx from 'clsx'

// ─── CALCULATION PREVIEW MODAL ───────────────────────────────────────────────

function FnfCalculationModal({
  employeeId,
  employeeName,
  open,
  onClose,
  onInitiate,
}: {
  employeeId: string
  employeeName: string
  open: boolean
  onClose: () => void
  onInitiate: (id: string) => void
}) {
  const qc = useQueryClient()

  const { data: calc, isLoading } = useQuery({
    queryKey: ['fnf-calc', employeeId],
    queryFn: () => fnfApi.calculate(employeeId).then(r => r.data.data),
    enabled: open && !!employeeId,
  })

  const initiateMut = useMutation({
    mutationFn: () => fnfApi.initiate(employeeId),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['fnf-list'] })
      qc.invalidateQueries({ queryKey: ['fnf-eligible'] })
      onClose()
      onInitiate(res.data.data.settlement.id)
    },
  })

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`F&F Calculation — ${employeeName}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button
            loading={initiateMut.isPending}
            onClick={() => initiateMut.mutate()}
            icon={<CheckCircle2 size={13} />}
          >
            Initiate F&F
          </Button>
        </>
      }
    >
      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-4 bg-slate-100 animate-pulse rounded" />
          ))}
        </div>
      ) : calc ? (
        <div className="space-y-4">
          {/* Date summary */}
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: 'Resignation Date', value: format(new Date(calc.resignationDate), 'dd MMM yyyy') },
              { label: 'Last Working Day', value: format(new Date(calc.lastWorkingDay), 'dd MMM yyyy') },
              { label: 'Salary Days',      value: `${calc.salaryDays} of ${calc.totalCycleDays} days` },
              { label: 'Gross (monthly)',  value: <Rupee amount={calc.grossSalary} /> },
            ].map(({ label, value }) => (
              <div key={label} className="bg-slate-50 rounded-xl p-3">
                <p className="text-xs text-slate-400 mb-0.5">{label}</p>
                <p className="text-sm font-semibold text-slate-800">{value}</p>
              </div>
            ))}
          </div>

          {/* Breakdown */}
          <div className="space-y-1">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Breakdown</p>
            {calc.breakdown.map((item: any) => (
              <div key={item.label} className={clsx(
                'flex justify-between items-center px-3 py-2 rounded-lg text-sm',
                item.type === 'addition' ? 'bg-emerald-50' : 'bg-red-50'
              )}>
                <span className={item.type === 'addition' ? 'text-emerald-700' : 'text-red-600'}>
                  {item.label}
                </span>
                <span className={clsx('font-semibold', item.type === 'addition' ? 'text-emerald-800' : 'text-red-700')}>
                  {item.type === 'deduction' ? '−' : '+'}&nbsp;
                  <Rupee amount={item.amount} />
                </span>
              </div>
            ))}
          </div>

          {/* Net */}
          <div className="flex justify-between items-center bg-brand-50 border border-brand-200 rounded-xl px-4 py-3">
            <span className="text-sm font-bold text-brand-700">Net Payable to Employee</span>
            <Rupee amount={calc.netPayable} className="text-lg font-display font-bold text-brand-800" />
          </div>

          {initiateMut.isError && (
            <Alert type="error" message={(initiateMut.error as any)?.response?.data?.error || 'Failed to initiate F&F'} />
          )}
        </div>
      ) : (
        <Alert type="error" message="Could not calculate F&F. Ensure resignation date and last working day are set." />
      )}
    </Modal>
  )
}

// ─── APPROVE MODAL ───────────────────────────────────────────────────────────

function ApproveModal({
  settlement,
  open,
  onClose,
}: {
  settlement: any
  open: boolean
  onClose: () => void
}) {
  const qc = useQueryClient()
  const [notes, setNotes] = useState('')

  const approveMut = useMutation({
    mutationFn: () => fnfApi.approve(settlement.id, notes),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['fnf-list'] })
      onClose()
    },
  })

  if (!settlement) return null

  const breakdown = [
    { label: `Salary (${settlement.salaryDays} days)`, amount: settlement.salaryAmount,      type: 'addition' },
    { label: 'Reimbursements',                          amount: settlement.reimbursements,    type: 'addition',  hide: Number(settlement.reimbursements) === 0 },
    { label: 'PF',                                      amount: settlement.pfAmount,          type: 'deduction' },
    { label: 'ESI',                                     amount: settlement.esiAmount,         type: 'deduction', hide: Number(settlement.esiAmount) === 0 },
    { label: 'Professional Tax',                        amount: settlement.ptAmount,          type: 'deduction', hide: Number(settlement.ptAmount) === 0 },
    { label: 'TDS',                                     amount: settlement.tdsAmount,         type: 'deduction', hide: Number(settlement.tdsAmount) === 0 },
    { label: 'Incentive Recovery',                      amount: settlement.incentiveRecovery, type: 'deduction', hide: Number(settlement.incentiveRecovery) === 0 },
    { label: 'Loan Outstanding',                        amount: settlement.loanOutstanding,   type: 'deduction', hide: Number(settlement.loanOutstanding) === 0 },
  ].filter((b: any) => !b.hide)

  return (
    <Modal open={open} onClose={onClose} title={`Approve F&F — ${settlement.employee?.name}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button loading={approveMut.isPending} onClick={() => approveMut.mutate()} icon={<CheckCircle2 size={13} />}>
            Approve & Mark Separated
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Alert type="warning"
          title="This action is irreversible"
          message="Approving will mark the employee as SEPARATED and finalise the settlement amount." />

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

        <div className="flex flex-col gap-1">
          <label className="label">Notes (optional)</label>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            className="input resize-none"
            rows={2}
            placeholder="Any notes for this settlement…"
          />
        </div>
      </div>
    </Modal>
  )
}

// ─── MAIN PAGE ────────────────────────────────────────────────────────────────

export default function FnfPage() {
  const navigate = useNavigate()
  const [calcEmployee, setCalcEmployee] = useState<any>(null)
  const [approveTarget, setApproveTarget] = useState<any>(null)

  const { data: settlements, isLoading: loadingSettlements } = useQuery({
    queryKey: ['fnf-list'],
    queryFn: () => fnfApi.list().then(r => r.data.data),
  })

  const { data: eligible, isLoading: loadingEligible } = useQuery({
    queryKey: ['fnf-eligible'],
    queryFn: () => fnfApi.eligible().then(r => r.data.data),
  })

  const pending    = (settlements || []).filter((s: any) => s.status === 'INITIATED')
  const approved   = (settlements || []).filter((s: any) => ['APPROVED', 'SETTLED'].includes(s.status))

  return (
    <div className="space-y-5">
      <PageHeader
        title="Full & Final Settlement"
        subtitle="Process F&F for resigned employees"
      />

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: 'Eligible for F&F', value: (eligible || []).length, color: 'text-amber-600' },
          { label: 'Pending Approval', value: pending.length,           color: 'text-blue-600' },
          { label: 'Completed',        value: approved.length,          color: 'text-emerald-600' },
        ].map(({ label, value, color }) => (
          <div key={label} className="card p-4">
            <p className="stat-label">{label}</p>
            <p className={clsx('text-2xl font-display font-bold mt-1', color)}>{value}</p>
          </div>
        ))}
      </div>

      {/* Eligible employees — need F&F initiated */}
      {(eligible || []).length > 0 && (
        <Card title="Employees Pending F&F Initiation">
          <div className="divide-y divide-slate-50">
            {(eligible || []).map((emp: any) => (
              <div key={emp.id} className="flex items-center gap-4 px-5 py-3.5">
                <div className="w-9 h-9 rounded-full bg-amber-100 flex items-center justify-center flex-shrink-0">
                  <span className="text-sm font-semibold text-amber-700">{emp.name.charAt(0)}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-slate-800">{emp.name}</p>
                  <p className="text-xs text-slate-400">
                    {emp.department} ·{' '}
                    {emp.resignationDate && `Resigned ${format(new Date(emp.resignationDate), 'dd MMM yyyy')}`}
                    {emp.lastWorkingDay && ` · LWD ${format(new Date(emp.lastWorkingDay), 'dd MMM yyyy')}`}
                  </p>
                </div>
                <StatusBadge status={emp.status} />
                <Button
                  size="sm"
                  icon={<Calculator size={13} />}
                  onClick={() => setCalcEmployee(emp)}
                  disabled={!emp.lastWorkingDay}
                >
                  Calculate F&F
                </Button>
                {!emp.lastWorkingDay && (
                  <span className="text-xs text-amber-500 flex items-center gap-1">
                    <AlertTriangle size={11} /> Set last working day first
                  </span>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Initiated settlements — pending HR approval */}
      {pending.length > 0 && (
        <Card title="Pending Approval">
          <Table>
            <thead>
              <tr className="border-b border-slate-100">
                <Th>Employee</Th>
                <Th>Last Working Day</Th>
                <Th className="text-right">Salary Days</Th>
                <Th className="text-right">Additions</Th>
                <Th className="text-right">Deductions</Th>
                <Th className="text-right">Net Payable</Th>
                <Th>Actions</Th>
              </tr>
            </thead>
            <tbody>
              {pending.map((s: any) => {
                const additions  = Number(s.salaryAmount) + Number(s.reimbursements)
                const deductions = Number(s.pfAmount) + Number(s.esiAmount) + Number(s.ptAmount) +
                  Number(s.tdsAmount) + Number(s.incentiveRecovery) + Number(s.loanOutstanding) + Number(s.otherDeductions)
                return (
                  <Tr key={s.id}>
                    <Td>
                      <p className="font-semibold text-slate-800">{s.employee?.name}</p>
                      <p className="text-xs text-slate-400 font-mono">{s.employee?.employeeCode}</p>
                    </Td>
                    <Td>
                      {s.lastWorkingDay
                        ? format(new Date(s.lastWorkingDay), 'dd MMM yyyy')
                        : '—'}
                    </Td>
                    <Td className="text-right">{s.salaryDays}</Td>
                    <Td className="text-right text-emerald-600 font-semibold">
                      <Rupee amount={additions} />
                    </Td>
                    <Td className="text-right text-red-600 font-semibold">
                      <Rupee amount={deductions} />
                    </Td>
                    <Td className="text-right font-bold text-brand-700">
                      <Rupee amount={s.netPayable} />
                    </Td>
                    <Td>
                      <div className="flex gap-2">
                        <Button
                          variant="secondary"
                          size="sm"
                          icon={<Eye size={12} />}
                          onClick={() => navigate(`/hr/employees/${s.employeeId}`)}
                        >
                          View
                        </Button>
                        <Button
                          size="sm"
                          icon={<CheckCircle2 size={12} />}
                          onClick={() => setApproveTarget(s)}
                        >
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

      {/* Completed settlements */}
      <Card title="Completed Settlements">
        {loadingSettlements ? <Skeleton className="h-40 m-4" /> : approved.length === 0 ? (
          <EmptyState
            icon={<GitMerge size={20} />}
            title="No completed settlements yet"
            description="Approved F&F settlements will appear here."
          />
        ) : (
          <Table>
            <thead>
              <tr className="border-b border-slate-100">
                <Th>Employee</Th>
                <Th>Approved By</Th>
                <Th>Approved On</Th>
                <Th className="text-right">Net Paid</Th>
                <Th>Status</Th>
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
                  <Td>
                    {s.approvedAt ? format(new Date(s.approvedAt), 'dd MMM yyyy') : '—'}
                  </Td>
                  <Td className="text-right font-bold">
                    <Rupee amount={s.netPayable} />
                  </Td>
                  <Td><StatusBadge status={s.status} /></Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      {/* Calculation modal */}
      {calcEmployee && (
        <FnfCalculationModal
          employeeId={calcEmployee.id}
          employeeName={calcEmployee.name}
          open={!!calcEmployee}
          onClose={() => setCalcEmployee(null)}
          onInitiate={(id) => {
            setCalcEmployee(null)
          }}
        />
      )}

      {/* Approve modal */}
      <ApproveModal
        settlement={approveTarget}
        open={!!approveTarget}
        onClose={() => setApproveTarget(null)}
      />
    </div>
  )
}
