import { useQuery } from '@tanstack/react-query'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line, Legend } from 'recharts'
import { reportApi } from '../../services/api'
import { PageHeader, Card, Rupee, Skeleton } from '../../components/ui'

function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-white border border-slate-100 rounded-xl shadow-card-md p-3 text-xs">
      <p className="font-semibold text-slate-600 mb-2">{label}</p>
      {payload.map((p: any) => (
        <div key={p.name} className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full" style={{ background: p.color }} />
          <span className="text-slate-400">{p.name}:</span>
          <span className="font-bold">₹{Number(p.value).toLocaleString('en-IN')}</span>
        </div>
      ))}
    </div>
  )
}

export default function CostReportPage() {
  const { data: trend, isLoading } = useQuery({
    queryKey: ['payroll-trend'],
    queryFn: () => reportApi.trend().then(r => r.data.data),
  })

  const chartData = (trend || []).map((t: any) => ({
    month:      t.payrollMonth,
    Gross:      Number(t.totalGross || 0),
    Net:        Number(t.totalNet || 0),
    Deductions: Number(t.totalGross || 0) - Number(t.totalNet || 0),
    Headcount:  t.employeeCount || 0,
  }))

  const latest = chartData[chartData.length - 1]
  const prev   = chartData[chartData.length - 2]
  const costPerHead = latest?.Headcount > 0 ? latest.Net / latest.Headcount : 0
  const prevCostPerHead = prev?.Headcount > 0 ? prev.Net / prev.Headcount : 0
  const diff = costPerHead - prevCostPerHead

  return (
    <div className="space-y-5">
      <PageHeader title="Cost Analysis" subtitle="Payroll cost trends and per-employee metrics" />

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Latest Net Payout',    value: latest ? <Rupee amount={latest.Net} /> : '—',         sub: latest?.month },
          { label: 'Total Deductions',     value: latest ? <Rupee amount={latest.Deductions} /> : '—',  sub: 'PF + ESI + PT + TDS + LOP' },
          { label: 'Cost Per Employee',    value: costPerHead > 0 ? <Rupee amount={costPerHead} /> : '—', sub: 'Net / headcount' },
          { label: 'MoM Change',
            value: diff !== 0 ? <span className={diff > 0 ? 'text-red-600' : 'text-emerald-600'}>{diff > 0 ? '+' : ''}<Rupee amount={Math.abs(diff)} /></span> : '—',
            sub: 'per employee vs last month' },
        ].map(({ label, value, sub }) => (
          <div key={label} className="card p-4">
            <p className="stat-label">{label}</p>
            <p className="text-xl font-display font-bold text-slate-900 mt-1">{value}</p>
            <p className="text-xs text-slate-400 mt-0.5">{sub}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Gross vs Net bars */}
        <Card title="Gross vs Net — Last 12 Months">
          <div className="px-5 pb-5">
            {isLoading ? <Skeleton className="h-52" /> : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={chartData} margin={{ top: 8, right: 4, left: 0, bottom: 0 }} barGap={2}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                  <XAxis dataKey="month" tick={{ fontSize: 9, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 9, fill: '#94a3b8' }} axisLine={false} tickLine={false}
                    tickFormatter={v => `₹${(v / 100000).toFixed(0)}L`} />
                  <Tooltip content={<ChartTooltip />} />
                  <Bar dataKey="Gross" fill="#dbeafe" radius={[3, 3, 0, 0]} maxBarSize={20} />
                  <Bar dataKey="Net"   fill="#1f4e79" radius={[3, 3, 0, 0]} maxBarSize={20} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </Card>

        {/* Deductions trend */}
        <Card title="Total Deductions Trend">
          <div className="px-5 pb-5">
            {isLoading ? <Skeleton className="h-52" /> : (
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={chartData} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                  <XAxis dataKey="month" tick={{ fontSize: 9, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 9, fill: '#94a3b8' }} axisLine={false} tickLine={false}
                    tickFormatter={v => `₹${(v / 1000).toFixed(0)}k`} />
                  <Tooltip content={<ChartTooltip />} />
                  <Line type="monotone" dataKey="Deductions" stroke="#ef4444" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </Card>
      </div>

      {/* Monthly table */}
      {chartData.length > 0 && (
        <Card title="Month-by-Month Cost Breakdown">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-100">
                  {['Month', 'Headcount', 'Gross', 'Deductions', 'Net', 'Cost/Head'].map(h => (
                    <th key={h} className="table-header">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[...chartData].reverse().map((row: any) => (
                  <tr key={row.month} className="table-row">
                    <td className="table-cell font-semibold">{row.month}</td>
                    <td className="table-cell">{row.Headcount || '—'}</td>
                    <td className="table-cell"><Rupee amount={row.Gross} /></td>
                    <td className="table-cell text-red-600"><Rupee amount={row.Deductions} /></td>
                    <td className="table-cell font-bold"><Rupee amount={row.Net} /></td>
                    <td className="table-cell"><Rupee amount={row.Headcount > 0 ? row.Net / row.Headcount : 0} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  )
}
