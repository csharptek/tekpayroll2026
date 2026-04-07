import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import {
  Users, CreditCard, TrendingUp, AlertCircle,
  Play, Plus, FileText, ArrowRight, CheckCircle2,
  Lock, Banknote, Clock, CalendarCheck, UserCheck, Palmtree
} from 'lucide-react'
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer
} from 'recharts'
import { reportApi, payrollApi } from '../../services/api'
import { StatCard, Card, Rupee, StatusBadge, Button, Skeleton } from '../../components/ui'
import { format } from 'date-fns'
import { useAuthStore } from '../../store/authStore'
import MonthCalendar from '../../components/MonthCalendar'

// ─── CUSTOM TOOLTIP ──────────────────────────────────────────────────────────

function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-white border border-slate-100 rounded-xl shadow-card-md p-3">
      <p className="text-xs font-semibold text-slate-600 mb-2">{label}</p>
      {payload.map((p: any) => (
        <div key={p.name} className="flex items-center gap-2 text-xs">
          <span className="w-2 h-2 rounded-full" style={{ background: p.color }} />
          <span className="text-slate-500">{p.name}:</span>
          <span className="font-semibold text-slate-800">
            ₹{Number(p.value).toLocaleString('en-IN')}
          </span>
        </div>
      ))}
    </div>
  )
}

// ─── CYCLE STATUS CARD (SUPER ADMIN ONLY) ────────────────────────────────────

function CycleStatusCard({ cycle }: { cycle: any }) {
  const navigate = useNavigate()
  if (!cycle) return null

  const statusConfig: Record<string, { label: string; color: string; icon: any; next: string }> = {
    DRAFT:      { label: 'Not run yet',               color: 'text-slate-500',   icon: Clock,        next: 'Run Payroll' },
    CALCULATED: { label: 'Ready to lock',             color: 'text-blue-600',    icon: CheckCircle2, next: 'Review & Lock' },
    LOCKED:     { label: 'Locked — ready to disburse',color: 'text-purple-600',  icon: Lock,         next: 'Mark Disbursed' },
    DISBURSED:  { label: 'Salary disbursed',          color: 'text-emerald-600', icon: CheckCircle2, next: 'View Detail' },
  }

  const cfg = statusConfig[cycle.status] || statusConfig.DRAFT
  const Icon = cfg.icon

  return (
    <Card className="p-5">
      <div className="flex items-start justify-between mb-4">
        <div>
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1">Current Cycle</p>
          <p className="text-lg font-display font-bold text-slate-900">{cycle.payrollMonth}</p>
          <p className="text-xs text-slate-400 mt-0.5">
            {format(new Date(cycle.cycleStart), 'dd MMM')} – {format(new Date(cycle.cycleEnd), 'dd MMM yyyy')}
          </p>
        </div>
        <StatusBadge status={cycle.status} />
      </div>

      <div className="grid grid-cols-3 gap-3 mb-4">
        {[
          { label: 'Gross', value: cycle.totalGross },
          { label: 'Net',   value: cycle.totalNet },
          { label: 'Employees', value: cycle.employeeCount, isCount: true },
        ].map(({ label, value, isCount }) => (
          <div key={label} className="bg-slate-50 rounded-xl p-3">
            <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">{label}</p>
            {value != null
              ? <p className="text-sm font-bold text-slate-800 mt-0.5 rupee">
                  {isCount ? value : `₹${Number(value).toLocaleString('en-IN')}`}
                </p>
              : <p className="text-sm text-slate-300 mt-0.5">—</p>
            }
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <div className={`flex items-center gap-1.5 text-xs font-medium ${cfg.color}`}>
          <Icon size={13} />
          {cfg.label}
        </div>
        <div className="flex-1" />
        <Button size="sm" onClick={() => navigate(`/hr/payroll/${cycle.id}/run`)} icon={<ArrowRight size={13} />}>
          {cfg.next}
        </Button>
      </div>
    </Card>
  )
}

// ─── QUICK ACTIONS — SUPER ADMIN ─────────────────────────────────────────────

function SuperAdminQuickActions() {
  const navigate = useNavigate()
  const actions = [
    { label: 'Add Employee', icon: Plus,     color: 'bg-brand-50 text-brand-700 hover:bg-brand-100',     to: '/hr/employees/add' },
    { label: 'Run Payroll',  icon: Play,     color: 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100', to: '/hr/payroll' },
    { label: 'Payslips',     icon: FileText, color: 'bg-blue-50 text-blue-700 hover:bg-blue-100',         to: '/hr/payslips' },
    { label: 'Loans',        icon: Banknote, color: 'bg-amber-50 text-amber-700 hover:bg-amber-100',      to: '/hr/loans' },
  ]
  return (
    <Card title="Quick Actions" className="p-5">
      <div className="grid grid-cols-2 gap-2 p-5 pt-0">
        {actions.map(({ label, icon: Icon, color, to }) => (
          <button key={label} onClick={() => navigate(to)}
            className={`flex items-center gap-3 p-3 rounded-xl transition-all duration-150 text-left ${color}`}>
            <Icon size={16} />
            <span className="text-sm font-medium">{label}</span>
          </button>
        ))}
      </div>
    </Card>
  )
}

// ─── QUICK ACTIONS — HR ──────────────────────────────────────────────────────

function HRQuickActions() {
  const navigate = useNavigate()
  const actions = [
    { label: 'Add Employee',   icon: Plus,          color: 'bg-brand-50 text-brand-700 hover:bg-brand-100',     to: '/hr/employees/add' },
    { label: 'Leave Requests', icon: CalendarCheck, color: 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100', to: '/hr/leaves' },
    { label: 'My Payslips',    icon: FileText,      color: 'bg-blue-50 text-blue-700 hover:bg-blue-100',         to: '/my/payslips' },
    { label: 'My Leaves',      icon: Palmtree,      color: 'bg-amber-50 text-amber-700 hover:bg-amber-100',      to: '/my/leaves' },
  ]
  return (
    <Card title="Quick Actions" className="p-5">
      <div className="grid grid-cols-2 gap-2 p-5 pt-0">
        {actions.map(({ label, icon: Icon, color, to }) => (
          <button key={label} onClick={() => navigate(to)}
            className={`flex items-center gap-3 p-3 rounded-xl transition-all duration-150 text-left ${color}`}>
            <Icon size={16} />
            <span className="text-sm font-medium">{label}</span>
          </button>
        ))}
      </div>
    </Card>
  )
}

// ─── ALERTS CARD ─────────────────────────────────────────────────────────────

function AlertsCard() {
  const alerts = [
    { id: 1, type: 'warning', message: '3 employees have pending LOP entries for this cycle' },
    { id: 2, type: 'info',    message: 'Payslip generation scheduled for 5th' },
    { id: 3, type: 'warning', message: '1 employee bank detail change pending approval' },
  ]
  const iconMap: Record<string, string> = { warning: 'text-amber-500', info: 'text-blue-500', error: 'text-red-500' }
  return (
    <Card title="Alerts">
      <div className="divide-y divide-slate-50">
        {alerts.map(a => (
          <div key={a.id} className="flex items-start gap-3 px-5 py-3">
            <AlertCircle size={14} className={`flex-shrink-0 mt-0.5 ${iconMap[a.type]}`} />
            <p className="text-xs text-slate-600">{a.message}</p>
          </div>
        ))}
      </div>
    </Card>
  )
}

// ─── RECENT CYCLES TABLE (SUPER ADMIN ONLY) ───────────────────────────────────

function RecentCycles({ cycles }: { cycles: any[] }) {
  const navigate = useNavigate()
  return (
    <Card title="Recent Payroll Cycles" action={
      <Button variant="ghost" size="sm" onClick={() => navigate('/hr/payroll')}>
        View all <ArrowRight size={13} />
      </Button>
    }>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-slate-100">
              {['Month', 'Employees', 'Gross', 'Net', 'Status', ''].map(h => (
                <th key={h} className="table-header">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {cycles.slice(0, 5).map((c) => (
              <tr key={c.id} className="table-row cursor-pointer" onClick={() => navigate(`/hr/payroll/${c.id}/detail`)}>
                <td className="table-cell font-medium text-slate-800">{c.payrollMonth}</td>
                <td className="table-cell">{c.employeeCount ?? '—'}</td>
                <td className="table-cell rupee">{c.totalGross ? `₹${Number(c.totalGross).toLocaleString('en-IN')}` : '—'}</td>
                <td className="table-cell rupee font-semibold">{c.totalNet ? `₹${Number(c.totalNet).toLocaleString('en-IN')}` : '—'}</td>
                <td className="table-cell"><StatusBadge status={c.status} /></td>
                <td className="table-cell"><ArrowRight size={14} className="text-slate-300" /></td>
              </tr>
            ))}
            {cycles.length === 0 && (
              <tr><td colSpan={6} className="table-cell text-center text-slate-400 py-8">No payroll cycles yet</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

// ─── HR DASHBOARD (employee management focused) ───────────────────────────────

function HROnlyDashboard({ summary, loadingSummary }: { summary: any; loadingSummary: boolean }) {
  const navigate = useNavigate()
  return (
    <div className="space-y-6">
      {/* Stat row — HR sees headcount only, no financials */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        <StatCard
          label="Active Employees"
          value={loadingSummary ? '—' : summary?.totalEmployees ?? '—'}
          icon={<Users size={18} />}
          color="blue"
          loading={loadingSummary}
        />
        <StatCard
          label="Pending Leave Requests"
          value="—"
          icon={<CalendarCheck size={18} />}
          color="amber"
        />
        <StatCard
          label="New This Month"
          value="—"
          icon={<UserCheck size={18} />}
          color="green"
        />
      </div>

      <MonthCalendar />

      {/* Main grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 space-y-5">
          {/* Employee list shortcut */}
          <Card title="Manage Employees" action={
            <Button variant="ghost" size="sm" onClick={() => navigate('/hr/employees')}>
              View all <ArrowRight size={13} />
            </Button>
          }>
            <div className="px-5 pb-5 text-sm text-slate-500">
              Use the Employees section to add, edit, manage employee profiles and salary details.
            </div>
          </Card>
          <AlertsCard />
        </div>
        <div className="space-y-5">
          <HRQuickActions />
        </div>
      </div>
    </div>
  )
}

// ─── SUPER ADMIN DASHBOARD (full financial view) ──────────────────────────────

function SuperAdminDashboard({
  summary, loadingSummary, cycles, loadingCycles, trendData, salarySummary, loadingSalarySummary
}: {
  summary: any; loadingSummary: boolean
  cycles: any[]; loadingCycles: boolean
  trendData: any[]
  salarySummary: any; loadingSalarySummary: boolean
}) {
  const latestCycle = cycles?.[0]
  return (
    <div className="space-y-6">
      {/* Row 1 — headcount + gross + net */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        <StatCard
          label="Active Employees"
          value={loadingSummary ? '—' : summary?.totalEmployees ?? '—'}
          icon={<Users size={18} />}
          color="blue"
          loading={loadingSummary}
        />
        <StatCard
          label="Tentative Gross / Month"
          value={loadingSalarySummary ? '—' : salarySummary?.totalGross != null ? `₹${Number(salarySummary.totalGross).toLocaleString('en-IN')}` : '—'}
          sub={salarySummary ? `${salarySummary.employeeCount} employees on payroll` : undefined}
          icon={<CreditCard size={18} />}
          color="green"
          loading={loadingSalarySummary}
        />
        <StatCard
          label="Tentative Net / Month"
          value={loadingSalarySummary ? '—' : salarySummary?.totalNet != null ? `₹${Number(salarySummary.totalNet).toLocaleString('en-IN')}` : '—'}
          sub="After employee PF & ESI"
          icon={<CheckCircle2 size={18} />}
          color="amber"
          loading={loadingSalarySummary}
        />
      </div>

      {/* Row 2 — PF & ESI breakdown */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Employee PF / Month"
          value={loadingSalarySummary ? '—' : salarySummary?.totalEmployeePf != null ? `₹${Number(salarySummary.totalEmployeePf).toLocaleString('en-IN')}` : '—'}
          sub="Deducted from salary"
          icon={<TrendingUp size={18} />}
          color="purple"
          loading={loadingSalarySummary}
        />
        <StatCard
          label="Employer PF / Month"
          value={loadingSalarySummary ? '—' : salarySummary?.totalEmployerPf != null ? `₹${Number(salarySummary.totalEmployerPf).toLocaleString('en-IN')}` : '—'}
          sub="Company contribution"
          icon={<TrendingUp size={18} />}
          color="blue"
          loading={loadingSalarySummary}
        />
        <StatCard
          label="Employee ESI / Month"
          value={loadingSalarySummary ? '—' : salarySummary?.totalEmployeeEsi != null ? `₹${Number(salarySummary.totalEmployeeEsi).toLocaleString('en-IN')}` : '—'}
          sub="Deducted from salary"
          icon={<TrendingUp size={18} />}
          color="purple"
          loading={loadingSalarySummary}
        />
        <StatCard
          label="Employer ESI / Month"
          value={loadingSalarySummary ? '—' : salarySummary?.totalEmployerEsi != null ? `₹${Number(salarySummary.totalEmployerEsi).toLocaleString('en-IN')}` : '—'}
          sub="Company contribution"
          icon={<TrendingUp size={18} />}
          color="blue"
          loading={loadingSalarySummary}
        />
      </div>

      <MonthCalendar />

      {/* Main grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 space-y-5">
          {trendData.length > 0 && (
            <Card title="Payroll Trend — Last 12 Months">
              <div className="px-5 pb-5">
                <ResponsiveContainer width="100%" height={220}>
                  <AreaChart data={trendData} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="gradGross" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%"  stopColor="#2e6dba" stopOpacity={0.12} />
                        <stop offset="95%" stopColor="#2e6dba" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="gradNet" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%"  stopColor="#10b981" stopOpacity={0.12} />
                        <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                    <XAxis dataKey="month" tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false}
                      tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}k`} />
                    <Tooltip content={<ChartTooltip />} />
                    <Area type="monotone" dataKey="Gross" stroke="#2e6dba" strokeWidth={2} fill="url(#gradGross)" dot={false} />
                    <Area type="monotone" dataKey="Net"   stroke="#10b981" strokeWidth={2} fill="url(#gradNet)"   dot={false} />
                  </AreaChart>
                </ResponsiveContainer>
                <div className="flex items-center gap-5 mt-2 justify-center">
                  {[{ color: '#2e6dba', label: 'Gross' }, { color: '#10b981', label: 'Net' }].map(({ color, label }) => (
                    <div key={label} className="flex items-center gap-1.5 text-xs text-slate-500">
                      <span className="w-3 h-0.5 rounded" style={{ background: color }} />
                      {label}
                    </div>
                  ))}
                </div>
              </div>
            </Card>
          )}
          {loadingCycles
            ? <Card><Skeleton className="h-40 m-4" /></Card>
            : <RecentCycles cycles={cycles || []} />
          }
        </div>
        <div className="space-y-5">
          {loadingCycles
            ? <Card><Skeleton className="h-52 m-4" /></Card>
            : <CycleStatusCard cycle={latestCycle} />
          }
          <SuperAdminQuickActions />
          <AlertsCard />
        </div>
      </div>
    </div>
  )
}

// ─── MAIN EXPORT ─────────────────────────────────────────────────────────────

export default function HRDashboard() {
  const { user } = useAuthStore()
  const isSuperAdmin = user?.role === 'SUPER_ADMIN'

  const { data: summary, isLoading: loadingSummary } = useQuery({
    queryKey: ['hr-summary'],
    queryFn: () => reportApi.summary().then(r => r.data.data),
  })

  // Only fetch payroll data if super admin
  const { data: cycles, isLoading: loadingCycles } = useQuery({
    queryKey: ['payroll-cycles'],
    queryFn: () => payrollApi.cycles().then(r => r.data.data),
    enabled: isSuperAdmin,
  })

  const { data: trend } = useQuery({
    queryKey: ['payroll-trend'],
    queryFn: () => reportApi.trend().then(r => r.data.data),
    enabled: isSuperAdmin,
  })

  const { data: salarySummary, isLoading: loadingSalarySummary } = useQuery({
    queryKey: ['salary-summary'],
    queryFn: () => reportApi.salarySummary().then(r => r.data.data),
    enabled: isSuperAdmin,
  })

  const trendData = (trend || []).map((t: any) => ({
    month: t.payrollMonth,
    Gross: Number(t.totalGross || 0),
    Net:   Number(t.totalNet   || 0),
  }))

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="page-title">Dashboard</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {format(new Date(), 'EEEE, dd MMMM yyyy')}
          </p>
        </div>
      </div>

      {isSuperAdmin
        ? <SuperAdminDashboard
            summary={summary}
            loadingSummary={loadingSummary}
            cycles={cycles || []}
            loadingCycles={loadingCycles}
            trendData={trendData}
            salarySummary={salarySummary}
            loadingSalarySummary={loadingSalarySummary}
          />
        : <HROnlyDashboard
            summary={summary}
            loadingSummary={loadingSummary}
          />
      }
    </div>
  )
}
