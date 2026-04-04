import { useQuery } from '@tanstack/react-query'
import { Wallet } from 'lucide-react'
import { loanApi } from '../../services/api'
import { useAuthStore } from '../../store/authStore'
import { PageHeader, Card, Rupee, EmptyState, Skeleton, StatusBadge } from '../../components/ui'
import { format } from 'date-fns'

export default function MyLoansPage() {
  const { user } = useAuthStore()

  const { data: loans, isLoading } = useQuery({
    queryKey: ['my-loans', user?.id],
    queryFn: () => loanApi.forEmployee(user!.id).then(r => r.data.data),
    enabled: !!user?.id,
  })

  if (isLoading) return <Skeleton className="h-64 rounded-xl" />

  return (
    <div className="space-y-5">
      <PageHeader title="My Loans" subtitle="View your active and past loan accounts" />

      {!loans?.length ? (
        <Card><EmptyState icon={<Wallet size={22} />} title="No loans" description="You have no active or past loans." /></Card>
      ) : (
        <div className="space-y-4">
          {loans.map((loan: any) => {
            const pct = Math.min(100, (Number(loan.totalRepaid) / Number(loan.principalAmount)) * 100)
            const monthsLeft = Math.ceil(Number(loan.outstandingBalance) / Number(loan.emiAmount))
            return (
              <Card key={loan.id}>
                <div className="p-5">
                  <div className="flex items-start justify-between mb-5">
                    <div>
                      <p className="text-base font-semibold text-slate-800">
                        Loan #{loan.id.slice(-6).toUpperCase()}
                      </p>
                      <p className="text-xs text-slate-400 mt-0.5">{loan.purpose || 'Personal loan'} · Disbursed {format(new Date(loan.disbursedOn), 'dd MMM yyyy')}</p>
                    </div>
                    <StatusBadge status={loan.status} />
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-5">
                    {[
                      { label: 'Loan Amount',    value: <Rupee amount={loan.principalAmount} /> },
                      { label: 'Outstanding',    value: <Rupee amount={loan.outstandingBalance} className={Number(loan.outstandingBalance) > 0 ? 'text-red-600 font-bold' : 'text-emerald-600 font-bold'} /> },
                      { label: 'Monthly EMI',    value: <Rupee amount={loan.emiAmount} /> },
                      { label: 'Months Left',    value: loan.status === 'ACTIVE' ? `~${monthsLeft} months` : 'Closed' },
                    ].map(({ label, value }) => (
                      <div key={label} className="bg-slate-50 rounded-xl p-3">
                        <p className="text-xs text-slate-400 mb-1">{label}</p>
                        <p className="text-sm font-bold text-slate-800">{value}</p>
                      </div>
                    ))}
                  </div>

                  {/* Progress */}
                  <div>
                    <div className="flex justify-between text-xs text-slate-400 mb-1.5">
                      <span>Repayment progress</span>
                      <span>{pct.toFixed(0)}% repaid (<Rupee amount={loan.totalRepaid} className="text-xs" /> of <Rupee amount={loan.principalAmount} className="text-xs" />)</span>
                    </div>
                    <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                      <div className="h-full bg-gradient-to-r from-brand-400 to-emerald-500 rounded-full transition-all duration-500"
                        style={{ width: `${pct}%` }} />
                    </div>
                  </div>

                  {/* Repayments */}
                  {loan.repayments?.length > 0 && (
                    <div className="mt-4 pt-4 border-t border-slate-100">
                      <p className="text-xs font-semibold text-slate-500 mb-2">Recent Repayments</p>
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
                </div>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
