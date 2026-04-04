import { useQuery } from '@tanstack/react-query'
import { Mail, Phone, MapPin, Calendar, Building2, CreditCard } from 'lucide-react'
import { format } from 'date-fns'
import { employeeApi } from '../../services/api'
import { useAuthStore } from '../../store/authStore'
import { PageHeader, Card, Rupee, Skeleton, Alert } from '../../components/ui'

export default function MyProfilePage() {
  const { user } = useAuthStore()

  const { data: profile, isLoading } = useQuery({
    queryKey: ['my-profile', user?.id],
    queryFn: () => employeeApi.get(user!.id).then(r => r.data.data),
    enabled: !!user?.id,
  })

  if (isLoading) return <div className="space-y-4"><Skeleton className="h-32 rounded-xl" /><Skeleton className="h-64 rounded-xl" /></div>
  if (!profile) return <Alert type="error" message="Could not load profile." />

  const monthly    = Number(profile.annualCtc) / 12
  const basic      = monthly * 0.40
  const hra        = basic * 0.80
  const allowances = monthly - basic - hra

  return (
    <div className="space-y-5 max-w-4xl">
      <PageHeader title="My Profile" subtitle="Your employment and salary details" />

      {/* Hero */}
      <Card>
        <div className="p-5 flex items-start gap-5">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center flex-shrink-0 shadow-card-md">
            <span className="text-2xl font-display font-bold text-white">{profile.name.charAt(0)}</span>
          </div>
          <div className="flex-1">
            <h1 className="text-xl font-display font-bold text-slate-900">{profile.name}</h1>
            <p className="text-sm text-slate-500 mt-0.5">{profile.jobTitle || '—'}{profile.department ? ` · ${profile.department}` : ''}</p>
            <div className="flex items-center gap-4 mt-2 text-xs text-slate-400 flex-wrap">
              <span className="font-mono bg-slate-100 px-2 py-0.5 rounded">{profile.employeeCode}</span>
              <span className="flex items-center gap-1"><Calendar size={11} />Joined {format(new Date(profile.joiningDate), 'dd MMM yyyy')}</span>
            </div>
          </div>
          <div className="text-right hidden sm:block">
            <p className="text-xs text-slate-400">Annual CTC</p>
            <Rupee amount={profile.annualCtc} className="text-xl font-display font-bold text-slate-900" />
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Personal info */}
        <Card title="Personal Information">
          <div className="divide-y divide-slate-50">
            {[
              { label: 'Email',      value: profile.email,           icon: Mail },
              { label: 'Phone',      value: profile.mobilePhone || '—', icon: Phone },
              { label: 'Location',   value: profile.officeLocation || '—', icon: MapPin },
              { label: 'State',      value: profile.state || '—',    icon: MapPin },
            ].map(({ label, value, icon: Icon }) => (
              <div key={label} className="flex items-center gap-3 px-5 py-3">
                <Icon size={14} className="text-slate-400 flex-shrink-0" />
                <span className="text-xs text-slate-500 w-24 flex-shrink-0">{label}</span>
                <span className="text-sm font-medium text-slate-800">{value}</span>
              </div>
            ))}
          </div>
        </Card>

        {/* Salary structure */}
        <Card title="Salary Structure">
          <div className="p-5 space-y-3">
            {[
              { label: 'Annual CTC',     value: profile.annualCtc, bold: true },
              { label: 'Monthly CTC',    value: monthly, bold: true },
              null,
              { label: 'Basic (40%)',    value: basic },
              { label: 'HRA (80%)',      value: hra },
              { label: 'Allowances',     value: allowances },
              null,
              { label: 'Annual Incentive', value: profile.annualIncentive },
            ].map((row, i) =>
              row === null
                ? <hr key={i} className="border-slate-100" />
                : <div key={row.label} className="flex justify-between">
                    <span className={row.bold ? 'text-sm font-semibold text-slate-700' : 'text-sm text-slate-500'}>{row.label}</span>
                    <Rupee amount={row.value} className={row.bold ? 'text-sm font-bold text-slate-900' : 'text-sm text-slate-600'} />
                  </div>
            )}
          </div>
        </Card>

        {/* Bank details (masked) */}
        {profile.bankDetail && (
          <Card title="Bank Details">
            <div className="p-5 space-y-3">
              <Alert type="info" message="Bank details are partially hidden for security. Contact HR to update." />
              {[
                { label: 'Bank Name', value: profile.bankDetail.bankName },
                { label: 'Account',  value: '••••••••' + profile.bankDetail.accountNumber.slice(-4) },
                { label: 'IFSC',     value: profile.bankDetail.ifscCode },
              ].map(({ label, value }) => (
                <div key={label} className="flex justify-between text-sm">
                  <span className="text-slate-500">{label}</span>
                  <span className="font-mono font-medium text-slate-800">{value}</span>
                </div>
              ))}
              {profile.bankDetail.pendingChange && (
                <Alert type="warning" message="A bank detail change is pending HR approval." />
              )}
            </div>
          </Card>
        )}

        {/* Compliance (masked) */}
        <Card title="Compliance">
          <div className="p-5 space-y-3">
            {[
              { label: 'PAN',     value: profile.panNumber ? profile.panNumber.slice(0, 3) + '•••••••' + profile.panNumber.slice(-1) : 'Not provided' },
              { label: 'PF No.', value: profile.pfNumber || 'Not provided' },
              { label: 'ESI No.', value: profile.esiNumber || 'Not provided' },
              { label: 'UAN',    value: profile.uanNumber || 'Not provided' },
            ].map(({ label, value }) => (
              <div key={label} className="flex justify-between text-sm">
                <span className="text-slate-500">{label}</span>
                <span className="font-mono text-slate-700">{value}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  )
}
