import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import {
  GitMerge, Calculator, CheckCircle2, Eye,
  Calendar, AlertTriangle, Banknote, IndianRupee,
} from 'lucide-react'
import { format } from 'date-fns'
import { fnfApi } from '../../services/api'
import {
  PageHeader, Button, Card, Modal, Alert, Skeleton,
  Table, Th, Td, Tr, EmptyState, Rupee, StatusBadge
} from '../../components/ui'
import clsx from 'clsx'

// ─── CALCULATION PREVIEW MODAL ────────────────────────────────────────────────

function FnfCalculationModal({ employeeId, employeeName, open, onClose, onInitiate }: {
  employeeId: string; employeeName: string; open: boolean; onClose: () => void; onInitiate: () => void
}) {
  const qc = useQueryClient()

  const { data: calc, isLoading, error } = useQuery({
    queryKey: ['fnf-calc', employeeId],
    queryFn:  () => fnfApi.calculate(employeeId).then(r => r.data.data),
    enabled:  open && !!employeeId,
    retry:    false,
  })

  const initiateMut = useMutation({
    mutationFn: () => fnfApi.initiate(employeeId),
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
    <Modal open={open} onClose={onClose} title={`F&F Calculation — ${employeeName}`}
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
              { label: 'Total Salary Days', value: `${calc.salaryDays} days` },
              { label: 'Months Covered',   value: `${calc.cycles?.length || 1} month(s)` },
            ].map(({ label, value }) => (
              <div key={label} className="bg-slate-50 rounded-xl p-3">
                <p className="text-xs text-slate-400 mb-0.5">{label}</p>
                <p className="text-sm font-semibold text-slate-800">{value}</p>
              </div>
            ))}
          </div>

          {/* Breakdown grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-0 border border-slate-200 rounded-xl overflow-hidden">
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

          {/* Net */}
          <div className="flex justify-between items-center bg-brand-50 border border-brand-200 rounded-xl px-4 py-3">
            <span className="text-sm font-bold text-brand-700">Net Payable to Employee</span>
            <Rupee amount={calc.netPayable} className="text-lg font-display font-bold text-brand-800" />
          </div>

          {initiateMut.isError && (
            <Alert type="error" message={(initiateMut.error as any)?.response?.data?.error || 'Failed to initiate F&F'} />
          )}
        </div>
      )}
    </Modal>
  )
}

// ─── APPROVE MODAL ────────────────────────────────────────────────────────────

function ApproveModal({ settlement, open, onClose }: { settlement: any; open: boolean; onClose: () => void }) {
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
        <Alert type="warning" title="This action is irreversible"
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

// ─── MAIN PAGE ────────────────────────────────────────────────────────────────

export default function FnfPage() {
  const navigate = useNavigate()
  const [calcEmployee, setCalcEmployee]   = useState<any>(null)
  const [approveTarget, setApproveTarget] = useState<any>(null)
  const [settleTarget, setSettleTarget]   = useState<any>(null)

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
                  <Button size="sm" icon={<Calculator size={13} />} onClick={() => setCalcEmployee(emp)}>
                    Calculate F&F
                  </Button>
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
                    <Button size="sm" icon={<Banknote size={12} />} onClick={() => setSettleTarget(s)}>
                      Mark Settled
                    </Button>
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
      <SettleModal  settlement={settleTarget}  open={!!settleTarget}  onClose={() => setSettleTarget(null)} />
    </div>
  )
}
