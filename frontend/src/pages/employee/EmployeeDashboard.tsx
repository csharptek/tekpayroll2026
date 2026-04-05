import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { FileText, Wallet, User, Download, Calendar, TrendingUp } from 'lucide-react'
import { format } from 'date-fns'
import { payslipApi, employeeApi } from '../../services/api'
import { useAuthStore } from '../../store/authStore'
import { Card, Rupee, Button, StatusBadge, Skeleton } from '../../components/ui'
import MonthCalendar from '../../components/MonthCalendar'

export default function EmployeeDashboard() {
  const { user } = useAuthStore()
  const navigate = useNavigate()

  const { data: profile, isLoading: loadingProfile } = useQuery({
    queryKey: ['my-profile', user?.id],
    queryFn: () => employeeApi.get(user!.id).then(r => r.data.data),
    enabled: !!user?.id,
  })

  const { data: payslips, isLoading: loadingPayslips } = useQuery({
    queryKey: ['my-payslips', user?.id],
    queryFn: () => payslipApi.forEmployee(user!.id).then(r => r.data.data),
    enabled: !!user?.id,
  })

  const { data: history } = useQuery({
    queryKey: ['my-payroll-history', user?.id],
    queryFn: () => employeeApi.payrollHistory(user!.id).then(r => r.data.data),
    enabled: !!user?.id,
  })

  const latestPayslip = payslips?.[0]
  const latestEntry   = history?.[0]
  const monthly = profile ? Number(profile.annualCtc) / 12 : 0
  const basic   = monthly * 0.40
  const hra     = basic * 0.80
  const allw    = monthly - basic - hra

  return (
    <div className="space-y-6">
      {/* Welcome */}
      <div>
        <h1 className="page-title">Welcome back, {user?.name?.split(' ')[0]} 👋</h1>
        <p className="text-sm text-slate-500 mt-0.5">{format(new Date(), 'EEEE, dd MMMM yyyy')}</p>
      </div>

      {/* Top stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="card p-5">
          <p className="stat-label">Last Net Salary</p>
          {loadingProfile
            ? <Skeleton className="h-8 w-36 mt-1" />
            : latestEntry
              ? <Rupee amount={latestEntry.netSalary} className="text-2xl font-display font-bold text-slate-900 mt-1" />
              : <p className="text-2xl font-display font-bold text-slate-300 mt-1">—</p>
          }
          <p className="stat-sub mt-1">{latestEntry?.cycle?.payrollMonth || 'No payroll yet'}</p>
        </div>

        <div className="card p-5">
          <p className="stat-label">Monthly CTC</p>
          {loadingProfile
            ? <Skeleton className="h-8 w-32 mt-1" />
            : <Rupee amount={monthly} className="text-2xl font-display font-bold text-slate-900 mt-1" />
          }
          <p className="stat-sub mt-1">
            <Rupee amount={profile?.annualCtc || 0} /> per year
          </p>
        </div>

        <div className="card p-5">
          <p className="stat-label">Latest Payslip</p>
          <p className="text-2xl font-display font-bold text-slate-900 mt-1">
            {latestPayslip ? latestPayslip.cycle?.payrollMonth : '—'}
          </p>
          {latestPayslip?.status === 'EMAILED'
            ? <span className="badge badge-green mt-1">Delivered</span>
            : latestPayslip
              ? <StatusBadge status={latestPayslip.status} />
              : <p className="stat-sub mt-1">Not generated yet</p>
          }
        </div>
      </div>

      <MonthCalendar />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Salary breakdown */}
        <div className="lg:col-span-2 space-y-5">
          <Card title="My Salary Structure">
            <div className="p-5">
              <div className="space-y-3">
                {[
                  { label: 'Annual CTC',          value: profile?.annualCtc || 0, bold: true },
                  { label: 'Monthly CTC',          value: monthly, bold: true },
                  { label: 'Basic (40%)',           value: basic },
                  { label: 'HRA (80% of Basic)',    value: hra },
                  { label: 'Allowances',            value: allw },
                  { label: 'Annual Incentive',      value: profile?.annualIncentive || 0 },
                ].map(({ label, value, bold }, i) => (
                  <div key={label}>
                    {(i === 2 || i === 5) && <hr className="border-slate-100 my-3" />}
                    <div className="flex justify-between items-center">
                      <span className={bold ? 'text-sm font-semibold text-slate-700' : 'text-sm text-slate-500'}>{label}</span>
                      {loadingProfile
                        ? <Skeleton className="h-4 w-24" />
                        : <Rupee amount={value} className={bold ? 'text-sm font-bold text-slate-900' : 'text-sm text-slate-600'} />
                      }
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </Card>

          {/* Payslip history */}
          <Card title="Recent Payslips" action={
            <Button variant="ghost" size="sm" onClick={() => navigate('/my/payslips')}>View all</Button>
          }>
            <div className="divide-y divide-slate-50">
              {(payslips || []).slice(0, 4).map((ps: any) => (
                <div key={ps.id} className="flex items-center gap-4 px-5 py-3">
                  <div className="w-9 h-9 rounded-xl bg-brand-50 flex items-center justify-center flex-shrink-0">
                    <FileText size={16} className="text-brand-600" />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-slate-800">{ps.cycle?.payrollMonth}</p>
                    <StatusBadge status={ps.status} />
                  </div>
                  {ps.pdfUrl && (
                    <a href={ps.pdfUrl} target="_blank" rel="noreferrer">
                      <Button variant="secondary" size="sm" icon={<Download size={12} />}>PDF</Button>
                    </a>
                  )}
                </div>
              ))}
              {!payslips?.length && (
                <div className="px-5 py-8 text-center text-sm text-slate-400">No payslips yet</div>
              )}
            </div>
          </Card>
        </div>

        {/* Quick links */}
        <div className="space-y-5">
          <Card title="Quick Links">
            <div className="p-4 space-y-2">
              {[
                { label: 'My Payslips',  icon: FileText, to: '/my/payslips', color: 'bg-blue-50 text-blue-700' },
                { label: 'My Loans',     icon: Wallet,   to: '/my/loans',    color: 'bg-amber-50 text-amber-700' },
                { label: 'My Profile',   icon: User,     to: '/my/profile',  color: 'bg-emerald-50 text-emerald-700' },
              ].map(({ label, icon: Icon, to, color }) => (
                <button key={label} onClick={() => navigate(to)}
                  className={`w-full flex items-center gap-3 p-3 rounded-xl text-left transition-all duration-150 hover:opacity-80 ${color}`}>
                  <Icon size={16} />
                  <span className="text-sm font-medium">{label}</span>
                </button>
              ))}
            </div>
          </Card>

          {profile && (
            <Card>
              <div className="p-5">
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">My Details</p>
                <div className="space-y-2">
                  {[
                    { label: 'Employee ID',  value: profile.employeeCode },
                    { label: 'Department',   value: profile.department || '—' },
                    { label: 'Designation',  value: profile.jobTitle || '—' },
                    { label: 'Joining Date', value: format(new Date(profile.joiningDate), 'dd MMM yyyy') },
                  ].map(({ label, value }) => (
                    <div key={label} className="flex justify-between text-xs">
                      <span className="text-slate-400">{label}</span>
                      <span className="font-medium text-slate-700">{value}</span>
                    </div>
                  ))}
                </div>
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}
