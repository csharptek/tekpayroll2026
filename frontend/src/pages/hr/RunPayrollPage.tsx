import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft, Play, Lock, Unlock, Banknote,
  CheckCircle2, AlertCircle, RefreshCw, ChevronDown, ChevronUp
} from 'lucide-react'
import { format } from 'date-fns'
import { payrollApi } from '../../services/api'
import {
  PageHeader, Button, Card, StatusBadge, Rupee,
  Table, Th, Td, Tr, Skeleton, Modal, Alert
} from '../../components/ui'
import clsx from 'clsx'
import { useAuthStore } from '../../store/authStore'

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

  const [runConfirm,     setRunConfirm]     = useState(false)
  const [lockConfirm,    setLockConfirm]    = useState(false)
  const [unlockConfirm,  setUnlockConfirm]  = useState(false)
  const [disburseConfirm,setDisburseConfirm]= useState(false)
  const [unlockReason,   setUnlockReason]   = useState('')
  const [expandedRow,    setExpandedRow]    = useState<string | null>(null)

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

  if (isLoading) return <div className="space-y-4"><Skeleton className="h-32 rounded-xl" /><Skeleton className="h-64 rounded-xl" /></div>

  const cycle   = cycleData
  const entries = cycle?.entries || []
  const status  = cycle?.status

  const canRun      = status === 'DRAFT' || status === 'CALCULATED'
  const canLock     = status === 'CALCULATED'
  const canUnlock   = status === 'LOCKED' && isSuperAdmin
  const canDisburse = status === 'LOCKED'

  // Validation checks
  const missingBank = entries.filter((e: any) => !e.employee).length
  const errors_count = entries.filter((e: any) => e.status === 'error').length

  return (
    <div className="space-y-5">
      <PageHeader
        title={`Payroll — ${cycle?.payrollMonth}`}
        subtitle={`${format(new Date(cycle?.cycleStart), 'dd MMM')} – ${format(new Date(cycle?.cycleEnd), 'dd MMM yyyy')}`}
        actions={
          <Button variant="ghost" icon={<ArrowLeft size={14} />} onClick={() => navigate('/hr/payroll')}>
            Back
          </Button>
        }
      />

      {/* Status bar */}
      <Card>
        <div className="p-5 flex flex-col sm:flex-row items-start sm:items-center gap-4">
          <div className="flex-1">
            <div className="flex items-center gap-3 mb-2">
              <StatusBadge status={status} />
              {cycle?.runAt && (
                <span className="text-xs text-slate-400">
                  Last run: {format(new Date(cycle.runAt), 'dd MMM yyyy, HH:mm')} by {cycle.runBy}
                </span>
              )}
              {cycle?.lockedAt && (
                <span className="text-xs text-slate-400">
                  Locked: {format(new Date(cycle.lockedAt), 'dd MMM yyyy, HH:mm')}
                </span>
              )}
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

          {/* Action buttons */}
          <div className="flex flex-wrap gap-2">
            {canRun && (
              <Button icon={<RefreshCw size={14} />} onClick={() => setRunConfirm(true)} loading={runMut.isPending}>
                {status === 'CALCULATED' ? 'Re-run Payroll' : 'Run Payroll'}
              </Button>
            )}
            {canLock && (
              <Button variant="secondary" icon={<Lock size={14} />} onClick={() => setLockConfirm(true)}>
                Lock Cycle
              </Button>
            )}
            {canUnlock && (
              <Button variant="secondary" icon={<Unlock size={14} />} onClick={() => setUnlockConfirm(true)}>
                Unlock
              </Button>
            )}
            {canDisburse && (
              <Button variant="primary" icon={<Banknote size={14} />} onClick={() => setDisburseConfirm(true)}>
                Mark Disbursed
              </Button>
            )}
          </div>
        </div>
      </Card>

      {/* Unlock reason notice */}
      {cycle?.unlockReason && (
        <Alert type="warning" title="Previously unlocked"
          message={`Unlocked by ${cycle.unlockedBy} — Reason: ${cycle.unlockReason}`} />
      )}

      {/* Validation warnings */}
      {status === 'CALCULATED' && (
        <div className="flex flex-col sm:flex-row gap-3">
          {errors_count === 0
            ? <Alert type="success" message={`All ${entries.length} employees calculated successfully. Review below then lock the cycle.`} />
            : <Alert type="error" message={`${errors_count} employees had calculation errors. Fix before locking.`} />
          }
        </div>
      )}

      {/* Payroll preview table */}
      {entries.length > 0 && (
        <Card title={`Employee Breakdown — ${entries.length} employees`}>
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
                <Th className="text-right">Loan</Th>
                <Th className="text-right font-bold">Net</Th>
                <Th></Th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry: any) => {
                const isExpanded = expandedRow === entry.id
                return (
                  <>
                    <Tr key={entry.id} onClick={() => setExpandedRow(isExpanded ? null : entry.id)}>
                      <Td>
                        <div className="flex items-center gap-2">
                          <div className="w-7 h-7 rounded-full bg-brand-100 flex items-center justify-center flex-shrink-0">
                            <span className="text-xs font-semibold text-brand-700">
                              {entry.employee?.name?.charAt(0)}
                            </span>
                          </div>
                          <div>
                            <p className="text-sm font-medium text-slate-800">{entry.employee?.name}</p>
                            <p className="text-xs text-slate-400">{entry.employee?.department}</p>
                          </div>
                        </div>
                      </Td>
                      <Td className="text-right"><Rupee amount={entry.proratedGross} className="text-xs" /></Td>
                      <Td className="text-right">
                        {Number(entry.lopAmount) > 0
                          ? <Rupee amount={entry.lopAmount} className="text-xs text-red-500" />
                          : <span className="text-slate-300 text-xs">—</span>}
                      </Td>
                      <Td className="text-right"><Rupee amount={entry.pfAmount} className="text-xs" /></Td>
                      <Td className="text-right">
                        {Number(entry.esiAmount) > 0
                          ? <Rupee amount={entry.esiAmount} className="text-xs" />
                          : <span className="text-slate-300 text-xs">—</span>}
                      </Td>
                      <Td className="text-right">
                        {Number(entry.ptAmount) > 0
                          ? <Rupee amount={entry.ptAmount} className="text-xs" />
                          : <span className="text-slate-300 text-xs">—</span>}
                      </Td>
                      <Td className="text-right">
                        {Number(entry.tdsAmount) > 0
                          ? <Rupee amount={entry.tdsAmount} className="text-xs" />
                          : <span className="text-slate-300 text-xs">—</span>}
                      </Td>
                      <Td className="text-right">
                        {Number(entry.loanDeduction) > 0
                          ? <Rupee amount={entry.loanDeduction} className="text-xs text-amber-600" />
                          : <span className="text-slate-300 text-xs">—</span>}
                      </Td>
                      <Td className="text-right">
                        <Rupee amount={entry.netSalary} className="text-sm font-bold text-slate-900" />
                      </Td>
                      <Td>
                        {isExpanded ? <ChevronUp size={14} className="text-slate-400" /> : <ChevronDown size={14} className="text-slate-400" />}
                      </Td>
                    </Tr>

                    {/* Expanded row */}
                    {isExpanded && (
                      <tr key={`${entry.id}-expanded`} className="bg-slate-50/80">
                        <td colSpan={10} className="px-5 py-4">
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
                            <div>
                              <p className="text-slate-400 mb-1 font-semibold uppercase tracking-wide">Salary Structure</p>
                              {[
                                { label: 'Annual CTC',   value: entry.annualCtc },
                                { label: 'Monthly CTC',  value: entry.monthlyCtc },
                                { label: 'Basic',        value: entry.basic },
                                { label: 'HRA',          value: entry.hra },
                                { label: 'Allowances',   value: entry.allowances },
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
                                { label: 'Prorated Gross',  value: <Rupee amount={entry.proratedGross} /> },
                                { label: 'Incentive',       value: <Rupee amount={entry.incentive} /> },
                                { label: 'Reimbursements',  value: <Rupee amount={entry.reimbursementTotal} /> },
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
                                <Rupee amount={Number(entry.proratedGross) + Number(entry.incentive) + Number(entry.reimbursementTotal)} className="text-slate-700" />
                              </div>
                              <div className="flex justify-between py-0.5 text-red-500">
                                <span>Total Deductions</span>
                                <Rupee amount={[entry.pfAmount,entry.esiAmount,entry.ptAmount,entry.tdsAmount,entry.lopAmount,entry.incentiveRecovery,entry.loanDeduction].reduce((s:number,v:any)=>s+Number(v||0),0)} />
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

      {/* Confirm modals */}
      <ConfirmModal open={runConfirm} onClose={() => setRunConfirm(false)} title="Run Payroll"
        message={`This will calculate net salaries for all active employees in the ${cycle?.payrollMonth} cycle. Any existing calculations will be overwritten.`}
        onConfirm={() => runMut.mutate()} loading={runMut.isPending} />

      <ConfirmModal open={lockConfirm} onClose={() => setLockConfirm(false)} title="Lock Cycle"
        message="Locking this cycle will prevent any further edits. Only a Super Admin can unlock it. Proceed?"
        onConfirm={() => lockMut.mutate()} loading={lockMut.isPending} variant="primary" />

      <ConfirmModal open={disburseConfirm} onClose={() => setDisburseConfirm(false)} title="Mark Disbursed"
        message="Confirm that salaries have been transferred to all employee bank accounts. This action cannot be undone."
        onConfirm={() => disburseMut.mutate()} loading={disburseMut.isPending} variant="primary" />

      <Modal open={unlockConfirm} onClose={() => setUnlockConfirm(false)} title="Unlock Cycle"
        footer={
          <>
            <Button variant="secondary" onClick={() => setUnlockConfirm(false)}>Cancel</Button>
            <Button variant="danger" loading={unlockMut.isPending}
              onClick={() => unlockMut.mutate()} disabled={!unlockReason.trim()}>
              Unlock Cycle
            </Button>
          </>
        }>
        <div className="space-y-3">
          <Alert type="warning" message="This action is restricted to Super Admins. Unlocking will allow edits to a locked cycle. This will be logged." />
          <div className="flex flex-col gap-1">
            <label className="label">Reason for unlocking *</label>
            <textarea value={unlockReason} onChange={e => setUnlockReason(e.target.value)}
              className="input resize-none" rows={3} placeholder="Describe why this cycle needs to be unlocked…" />
          </div>
        </div>
      </Modal>
    </div>
  )
}
