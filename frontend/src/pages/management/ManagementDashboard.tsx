import { useQuery } from '@tanstack/react-query'
import { Users, TrendingUp, CreditCard, BarChart3 } from 'lucide-react'
import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from 'recharts'
import { reportApi } from '../../services/api'
import { Card, Rupee, Skeleton, StatCard } from '../../components/ui'
import { format } from 'date-fns'

const DEPT_COLORS = ['#1f4e79','#2e75b6','#10b981','#f59e0b','#ef4444','#8b5cf6','#06b6d4']

function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-white border border-slate-100 rounded-xl shadow-card-md p-3 text-xs">
      <p className="font-semibold text-slate-600 mb-2">{label}</p>
      {payload.map((p: any) => (
        <div key={p.name} className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full" style={{ background: p.color }} />
          <span className="text-slate-500">{p.name}:</span>
          <span className="font-bold">₹{Number(p.value).toLocaleString('en-IN')}</span>
        </div>
      ))}
    </div>
  )
}

export default function ManagementDashboard() {
  const { data: summary, isLoading: loadingSummary } = useQuery({
    queryKey: ['report-summary'],
    queryFn: () => reportApi.summary().then(r => r.data.data),
  })

  const { data: trend, isLoading: loadingTrend } = useQuery({
    queryKey: ['payroll-trend'],
    queryFn: () => reportApi.trend().then(r => r.data.data),
  })

  const trendData = (trend || []).map((t: any) => ({
    month:  t.payrollMonth,
    Gross:  Number(t.totalGross || 0),
    Net:    Number(t.totalNet   || 0),
    Count:  t.employeeCount || 0,
  }))

  const lastCycle = summary?.lastCycle

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">Management Dashboard</h1>
        <p className="text-sm text-slate-500 mt-0.5">{format(new Date(), 'EEEE, dd MMMM yyyy')}</p>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Active Employees" value={loadingSummary ? '—' : summary?.totalEmployees ?? '—'}
          icon={<Users size={18} />} color="blue" loading={loadingSummary} />
        <StatCard label="Last Net Payout"
          value={lastCycle?.totalNet ? `₹${Number(lastCycle.totalNet).toLocaleString('en-IN')}` : '—'}
          sub={lastCycle?.payrollMonth} icon={<CreditCard size={18} />} color="green" loading={loadingSummary} />
        <StatCard label="Last Gross Payout"
          value={lastCycle?.totalGross ? `₹${Number(lastCycle.totalGross).toLocaleString('en-IN')}` : '—'}
          sub={lastCycle?.payrollMonth} icon={<TrendingUp size={18} />} color="purple" loading={loadingSummary} />
        <StatCard label="Cycle Status"
          value={lastCycle?.status ?? '—'} sub={lastCycle?.payrollMonth}
          icon={<BarChart3 size={18} />} color="amber" loading={loadingSummary} />
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Trend area chart */}
        <Card title="Payroll Cost Trend — Last 12 Months">
          <div className="px-5 pb-5">
            {loadingTrend
              ? <Skeleton className="h-48" />
              : (
                <ResponsiveContainer width="100%" height={220}>
                  <AreaChart data={trendData} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="mgGross" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#1f4e79" stopOpacity={0.15} />
                        <stop offset="95%" stopColor="#1f4e79" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="mgNet" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#10b981" stopOpacity={0.15} />
                        <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                    <XAxis dataKey="month" tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false}
                      tickFormatter={v => `₹${(v / 100000).toFixed(0)}L`} />
                    <Tooltip content={<ChartTooltip />} />
                    <Area type="monotone" dataKey="Gross" stroke="#1f4e79" strokeWidth={2} fill="url(#mgGross)" dot={false} />
                    <Area type="monotone" dataKey="Net"   stroke="#10b981" strokeWidth={2} fill="url(#mgNet)"   dot={false} />
                  </AreaChart>
                </ResponsiveContainer>
              )
            }
            <div className="flex justify-center gap-6 mt-1">
              {[{ color: '#1f4e79', label: 'Gross' }, { color: '#10b981', label: 'Net' }].map(({ color, label }) => (
                <div key={label} className="flex items-center gap-1.5 text-xs text-slate-500">
                  <span className="w-3 h-0.5 rounded" style={{ background: color }} />{label}
                </div>
              ))}
            </div>
          </div>
        </Card>

        {/* Bar chart — headcount */}
        <Card title="Headcount vs Net Payout">
          <div className="px-5 pb-5">
            {loadingTrend
              ? <Skeleton className="h-48" />
              : (
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={trendData.slice(-6)} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                    <XAxis dataKey="month" tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false}
                      tickFormatter={v => `₹${(v / 100000).toFixed(0)}L`} />
                    <Tooltip content={<ChartTooltip />} />
                    <Bar dataKey="Net" fill="#2e75b6" radius={[4, 4, 0, 0]} maxBarSize={36} />
                  </BarChart>
                </ResponsiveContainer>
              )
            }
          </div>
        </Card>
      </div>

      {/* Monthly summary table */}
      {trendData.length > 0 && (
        <Card title="Monthly Summary">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-100">
                  {['Month', 'Employees', 'Gross Payout', 'Net Payout', 'Difference'].map(h => (
                    <th key={h} className="table-header">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[...trendData].reverse().map((row: any, i: number) => {
                  const diff = row.Gross - row.Net
                  return (
                    <tr key={row.month} className="table-row">
                      <td className="table-cell font-semibold">{row.month}</td>
                      <td className="table-cell">{row.Count || '—'}</td>
                      <td className="table-cell"><Rupee amount={row.Gross} /></td>
                      <td className="table-cell font-bold"><Rupee amount={row.Net} /></td>
                      <td className="table-cell text-slate-400"><Rupee amount={diff} /></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  )
}
