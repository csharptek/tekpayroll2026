import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Pause, Play, Edit3, Check, CheckCircle2 } from 'lucide-react'
import { loanApi } from '../../services/api'
import { PageHeader, Card, Skeleton, Rupee, StatusBadge, Button, Modal, Input, Alert } from '../../components/ui'
import { format } from 'date-fns'

export default function LoanDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [pauseTarget, setPauseTarget] = useState<any>(null)
  const [editOpen, setEditOpen]       = useState(false)

  const { data: loan, isLoading } = useQuery({
    queryKey: ['loan', id],
    queryFn: () => loanApi.get(id!).then(r => r.data.data),
    enabled: !!id,
  })

  const pauseMut = useMutation({
    mutationFn: ({ sid, reason }: any) => loanApi.pauseMonth(id!, sid, reason),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['loan', id] }); setPauseTarget(null) },
  })

  const resumeMut = useMutation({
    mutationFn: (sid: string) => loanApi.resumeMonth(id!, sid),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['loan', id] }),
  })

  if (isLoading) return <Skeleton className="h-64 rounded-xl" />
  if (!loan)     return <Card><p className="p-5 text-sm text-slate-500">Loan not found</p></Card>

  const principal = Number(loan.principalAmount)
  const repaid    = Number(loan.totalRepaid)
  const pct       = principal > 0 ? Math.min(100, (repaid / principal) * 100) : 0

  return (
    <div className="space-y-5">
      <button onClick={() => navigate('/hr/loans')} className="flex items-center gap-1.5 text-sm text-brand-600 hover:text-brand-700">
        <ArrowLeft size={14} /> Back to Loans
      </button>

      <PageHeader
        title={`${loan.type === 'SALARY_ADVANCE' ? 'Salary Advance' : 'Loan'} #${loan.id.slice(-6).toUpperCase()}`}
        subtitle={`${loan.employee?.name} · ${loan.employee?.employeeCode}`}
        actions={loan.status === 'ACTIVE' && (
          <Button variant="secondary" icon={<Edit3 size={13} />} onClick={() => setEditOpen(true)}>Edit Terms</Button>
        )}
      />

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        {[
          { label: 'Principal',    value: <Rupee amount={loan.principalAmount} /> },
          { label: 'Outstanding',  value: <Rupee amount={loan.outstandingBalance}
              className={Number(loan.outstandingBalance) > 0 ? 'text-red-600 font-bold' : 'text-emerald-600 font-bold'} /> },
          { label: 'Total Repaid', value: <Rupee amount={loan.totalRepaid} /> },
          { label: 'EMI',          value: <Rupee amount={loan.emiAmount} /> },
          { label: 'Tenure',       value: `${loan.tenureMonths} months` },
        ].map(({ label, value }) => (
          <div key={label} className="card p-4">
            <p className="stat-label">{label}</p>
            <p className="text-lg font-display font-bold text-slate-900 mt-1">{value}</p>
          </div>
        ))}
      </div>

      <Card>
        <div className="p-5">
          <div className="flex justify-between text-xs text-slate-400 mb-2">
            <span>Repayment progress</span>
            <span>{pct.toFixed(0)}% repaid · <StatusBadge status={loan.status} /></span>
          </div>
          <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
            <div className="h-full bg-gradient-to-r from-brand-400 to-emerald-500 rounded-full transition-all duration-500" style={{ width: `${pct}%` }} />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4 text-xs">
            <InfoRow label="Purpose"     value={loan.purpose || '—'} />
            <InfoRow label="Approved by" value={loan.approvedByName || '—'} />
            <InfoRow label="Disbursed"   value={loan.disbursedOn ? format(new Date(loan.disbursedOn), 'dd MMM yyyy') : '—'} />
            <InfoRow label="Requested"   value={loan.requestedAt ? format(new Date(loan.requestedAt), 'dd MMM yyyy') : '—'} />
          </div>
        </div>
      </Card>

      {/* Schedule grid */}
      <Card title="Payment Schedule" action={<p className="text-xs text-slate-400">Pause a month to skip deduction (tenure extends by 1)</p>}>
        <div className="p-4">
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2">
            {(loan.schedule || []).map((s: any) => (
              <ScheduleCell key={s.id}
                entry={s}
                canModify={loan.status === 'ACTIVE'}
                onPause={() => setPauseTarget(s)}
                onResume={() => resumeMut.mutate(s.id)}
              />
            ))}
          </div>
          {(loan.schedule || []).length === 0 && (
            <p className="text-sm text-slate-400 text-center py-6">No schedule generated yet.</p>
          )}
        </div>
      </Card>

      <Modal open={!!pauseTarget} onClose={() => setPauseTarget(null)} title={`Pause ${pauseTarget?.cycleMonth || ''}`}
        footer={<>
          <Button variant="secondary" onClick={() => setPauseTarget(null)}>Cancel</Button>
          <Button loading={pauseMut.isPending} onClick={() =>
            pauseMut.mutate({ sid: pauseTarget.id, reason: (document.getElementById('pause-reason') as HTMLInputElement)?.value || '' })
          }>
            Pause This Month
          </Button>
        </>}>
        <p className="text-sm text-slate-600 mb-3">
          Skip deduction of <strong><Rupee amount={pauseTarget?.plannedAmount || 0} /></strong> for <strong>{pauseTarget?.cycleMonth}</strong>.
          Tenure will extend by 1 month.
        </p>
        <label className="label">Reason (optional)</label>
        <input id="pause-reason" className="input" placeholder="e.g. Employee requested due to medical expense" />
      </Modal>

      {editOpen && <EditLoanModal loan={loan} onClose={() => setEditOpen(false)} />}
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-slate-400">{label}</p>
      <p className="text-slate-700 font-medium mt-0.5">{value}</p>
    </div>
  )
}

function ScheduleCell({ entry, canModify, onPause, onResume }: { entry: any; canModify: boolean; onPause: () => void; onResume: () => void }) {
  const { status, cycleMonth, plannedAmount, actualAmount, pauseReason, sequenceNo } = entry

  const config: Record<string, { bg: string; icon: any; label: string }> = {
    PENDING:  { bg: 'bg-slate-50  border-slate-200',  icon: null,                                                               label: 'Pending'  },
    DEDUCTED: { bg: 'bg-emerald-50 border-emerald-200', icon: <CheckCircle2 size={14} className="text-emerald-600" />,          label: 'Deducted' },
    PAUSED:   { bg: 'bg-amber-50   border-amber-200',   icon: <Pause size={14} className="text-amber-600" />,                    label: 'Paused'   },
    SKIPPED:  { bg: 'bg-slate-100  border-slate-300',   icon: null,                                                               label: 'Skipped'  },
  }
  const c = config[status] || config.PENDING

  return (
    <div className={`border rounded-lg p-2.5 ${c.bg}`}>
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] font-semibold text-slate-500">#{sequenceNo}</span>
        {c.icon}
      </div>
      <p className="text-xs font-bold text-slate-800">{cycleMonth}</p>
      <p className="text-[11px] text-slate-600 mt-0.5">
        <Rupee amount={status === 'DEDUCTED' ? actualAmount : plannedAmount} className="text-[11px]" />
      </p>
      {pauseReason && <p className="text-[9px] text-amber-700 mt-1 truncate" title={pauseReason}>{pauseReason}</p>}

      {canModify && status === 'PENDING' && (
        <button onClick={onPause} className="mt-1.5 w-full text-[10px] flex items-center justify-center gap-1 text-slate-500 hover:text-amber-600">
          <Pause size={10} /> Pause
        </button>
      )}
      {canModify && status === 'PAUSED' && (
        <button onClick={onResume} className="mt-1.5 w-full text-[10px] flex items-center justify-center gap-1 text-slate-500 hover:text-brand-600">
          <Play size={10} /> Resume
        </button>
      )}
    </div>
  )
}

function EditLoanModal({ loan, onClose }: { loan: any; onClose: () => void }) {
  const qc = useQueryClient()
  const [emi, setEmi]       = useState(String(loan.emiAmount))
  const [tenure, setTenure] = useState(String(loan.tenureMonths))

  const deducted = (loan.schedule || []).filter((s: any) => s.status === 'DEDUCTED').length

  const mut = useMutation({
    mutationFn: () => loanApi.update(loan.id, {
      emiAmount:    parseFloat(emi),
      tenureMonths: parseInt(tenure),
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['loan', loan.id] }); onClose() },
  })

  return (
    <Modal open onClose={onClose} title="Edit Loan Terms"
      footer={<>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button loading={mut.isPending} icon={<Check size={13} />} onClick={() => mut.mutate()}>Save</Button>
      </>}>
      <div className="space-y-3">
        <p className="text-xs text-slate-500 bg-slate-50 p-2.5 rounded">
          {deducted} month(s) already deducted. Edits apply only to future/pending rows — pending schedule entries will be regenerated.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <Input label="New EMI (₹) *"   type="number" value={emi}    onChange={e => setEmi(e.target.value)} />
          <Input label="New tenure (m) *" type="number" value={tenure} onChange={e => setTenure(e.target.value)} />
        </div>
        {deducted > 0 && <p className="text-[11px] text-slate-400">Min tenure: {deducted} months</p>}
        {mut.isError && <Alert type="error" message={(mut.error as any)?.response?.data?.error || 'Failed to update'} />}
      </div>
    </Modal>
  )
}
