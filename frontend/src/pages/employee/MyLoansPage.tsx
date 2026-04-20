import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Wallet, Plus, X } from 'lucide-react'
import { loanApi } from '../../services/api'
import { PageHeader, Card, Rupee, EmptyState, Skeleton, StatusBadge, Button, Input } from '../../components/ui'
import { format } from 'date-fns'

type LoanType = 'LOAN' | 'SALARY_ADVANCE'

function LoanRequestModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient()
  const [type, setType]                 = useState<LoanType>('LOAN')
  const [amount, setAmount]             = useState('')
  const [tenure, setTenure]             = useState('6')
  const [suggestedEmi, setSuggestedEmi] = useState('')
  const [purpose, setPurpose]           = useState('')
  const [error, setError]               = useState('')

  const suggested = amount && tenure ? Math.ceil(Number(amount) / Number(tenure)) : 0

  const mut = useMutation({
    mutationFn: (payload: any) => loanApi.request(payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['my-loans'] })
      onClose()
    },
    onError: (e: any) => setError(e?.response?.data?.error || 'Failed to submit request'),
  })

  function submit() {
    setError('')
    if (!amount || Number(amount) <= 0) return setError('Enter a valid amount')
    if (!tenure || Number(tenure) <= 0) return setError('Enter a valid tenure')
    mut.mutate({
      type,
      principalAmount:    Number(amount),
      tenureMonths:       Number(tenure),
      suggestedEmiAmount: suggestedEmi ? Number(suggestedEmi) : suggested,
      purpose,
    })
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-40 flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <div className="p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-base font-semibold text-slate-800">Request Loan / Salary Advance</h3>
            <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
          </div>

          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium text-slate-500 mb-1 block">Type</label>
              <select className="input" value={type} onChange={e => setType(e.target.value as LoanType)}>
                <option value="LOAN">Loan</option>
                <option value="SALARY_ADVANCE">Salary Advance</option>
              </select>
            </div>

            <div>
              <label className="text-xs font-medium text-slate-500 mb-1 block">Amount (₹)</label>
              <Input type="number" value={amount} onChange={e => setAmount(e.target.value)} placeholder="50000" />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-slate-500 mb-1 block">Tenure (months)</label>
                <Input type="number" value={tenure} onChange={e => setTenure(e.target.value)} />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-500 mb-1 block">Suggested EMI (₹)</label>
                <Input type="number" value={suggestedEmi} onChange={e => setSuggestedEmi(e.target.value)} placeholder={String(suggested || '')} />
              </div>
            </div>

            <div>
              <label className="text-xs font-medium text-slate-500 mb-1 block">Purpose / reason</label>
              <Input value={purpose} onChange={e => setPurpose(e.target.value)} placeholder="Medical emergency, home repairs, etc." />
            </div>

            {error && <p className="text-xs text-red-600">{error}</p>}

            <p className="text-[11px] text-slate-400 bg-slate-50 rounded-lg p-2.5">
              Admin will review and set final EMI, tenure and disbursement date.
            </p>
          </div>

          <div className="flex justify-end gap-2 mt-5">
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button variant="primary" onClick={submit} disabled={mut.isPending}>
              {mut.isPending ? 'Submitting...' : 'Submit Request'}
            </Button>
          </div>
        </div>
      </Card>
    </div>
  )
}

export default function MyLoansPage() {
  const [showRequest, setShowRequest] = useState(false)

  const { data: loans, isLoading } = useQuery({
    queryKey: ['my-loans'],
    queryFn: () => loanApi.my().then(r => r.data.data),
  })

  return (
    <div className="space-y-5">
      <PageHeader
        title="My Loans"
        subtitle="View your loans and request new loan or salary advance"
        actions={<Button variant="primary" onClick={() => setShowRequest(true)}><Plus size={14} /> New Request</Button>}
      />

      {showRequest && <LoanRequestModal onClose={() => setShowRequest(false)} />}

      {isLoading ? (
        <Skeleton className="h-64 rounded-xl" />
      ) : !loans?.length ? (
        <Card><EmptyState icon={<Wallet size={22} />} title="No loans" description="You have no loans. Click 'New Request' to request one." /></Card>
      ) : (
        <div className="space-y-4">
          {loans.map((loan: any) => <LoanCard key={loan.id} loan={loan} />)}
        </div>
      )}
    </div>
  )
}

function LoanCard({ loan }: { loan: any }) {
  const principal = Number(loan.principalAmount)
  const repaid    = Number(loan.totalRepaid)
  const pct       = principal > 0 ? Math.min(100, (repaid / principal) * 100) : 0
  const pending   = (loan.schedule || []).filter((s: any) => s.status === 'PENDING')
  const paused    = (loan.schedule || []).filter((s: any) => s.status === 'PAUSED')
  const typeLabel = loan.type === 'SALARY_ADVANCE' ? 'Salary Advance' : 'Loan'

  return (
    <Card>
      <div className="p-5">
        <div className="flex items-start justify-between mb-4">
          <div>
            <p className="text-base font-semibold text-slate-800">
              {typeLabel} #{loan.id.slice(-6).toUpperCase()}
            </p>
            <p className="text-xs text-slate-400 mt-0.5">
              {loan.purpose || '—'}
              {loan.disbursedOn && <> · Disbursed {format(new Date(loan.disbursedOn), 'dd MMM yyyy')}</>}
              {!loan.disbursedOn && loan.requestedAt && <> · Requested {format(new Date(loan.requestedAt), 'dd MMM yyyy')}</>}
            </p>
          </div>
          <StatusBadge status={loan.status} />
        </div>

        {loan.status === 'REJECTED' && loan.rejectionReason && (
          <div className="bg-red-50 border border-red-100 rounded-lg p-2.5 mb-4 text-xs text-red-700">
            <strong>Rejected:</strong> {loan.rejectionReason}
          </div>
        )}

        {loan.status !== 'PENDING_APPROVAL' && loan.status !== 'REJECTED' && (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
              {[
                { label: 'Amount',        value: <Rupee amount={loan.principalAmount} /> },
                { label: 'Outstanding',   value: <Rupee amount={loan.outstandingBalance} className={Number(loan.outstandingBalance) > 0 ? 'text-red-600 font-bold' : 'text-emerald-600 font-bold'} /> },
                { label: 'Monthly EMI',   value: <Rupee amount={loan.emiAmount} /> },
                { label: 'Tenure',        value: `${loan.tenureMonths} months` },
              ].map(({ label, value }) => (
                <div key={label} className="bg-slate-50 rounded-xl p-3">
                  <p className="text-xs text-slate-400 mb-1">{label}</p>
                  <p className="text-sm font-bold text-slate-800">{value}</p>
                </div>
              ))}
            </div>

            <div>
              <div className="flex justify-between text-xs text-slate-400 mb-1.5">
                <span>Repayment progress</span>
                <span>{pct.toFixed(0)}% repaid</span>
              </div>
              <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                <div className="h-full bg-gradient-to-r from-brand-400 to-emerald-500 rounded-full transition-all duration-500" style={{ width: `${pct}%` }} />
              </div>
            </div>

            {paused.length > 0 && (
              <div className="mt-4 bg-amber-50 border border-amber-100 rounded-lg p-2.5 text-xs text-amber-800">
                <strong>{paused.length}</strong> deduction{paused.length > 1 ? 's' : ''} paused by admin.
                Tenure extended to compensate.
              </div>
            )}

            {pending.length > 0 && loan.status === 'ACTIVE' && (
              <div className="mt-4 pt-4 border-t border-slate-100">
                <p className="text-xs font-semibold text-slate-500 mb-2">Upcoming deductions</p>
                <div className="flex flex-wrap gap-1.5">
                  {pending.slice(0, 6).map((s: any) => (
                    <span key={s.id} className="text-[11px] px-2 py-0.5 bg-slate-100 text-slate-600 rounded">
                      {s.cycleMonth}
                    </span>
                  ))}
                  {pending.length > 6 && <span className="text-[11px] text-slate-400">+{pending.length - 6} more</span>}
                </div>
              </div>
            )}

            {loan.repayments?.length > 0 && (
              <div className="mt-4 pt-4 border-t border-slate-100">
                <p className="text-xs font-semibold text-slate-500 mb-2">Recent repayments</p>
                <div className="space-y-1.5">
                  {loan.repayments.slice(0, 4).map((r: any) => (
                    <div key={r.id} className="flex justify-between text-xs text-slate-600">
                      <span>{r.cycleMonth}</span>
                      <Rupee amount={r.amount} className="font-medium text-emerald-600" />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </Card>
  )
}
