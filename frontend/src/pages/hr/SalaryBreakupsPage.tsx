import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Search, Download, AlertTriangle, Users } from 'lucide-react'
import api from '../../services/api'
import { PageHeader, Button, Skeleton, Rupee } from '../../components/ui'
import clsx from 'clsx'

interface BreakupRow {
  employeeId:   string
  employeeCode: string
  name:         string
  jobTitle:     string
  department:   string
  state:        string
  status:       string
  annualCtc:    number
  basic:        number
  hra:          number
  transport:    number
  fbp:          number
  hyi:          number
  grossMonthly: number
  employeePf:   number
  employeeEsi:  number
  employerPf:   number
  employerEsi:  number
  pt:           number
  netMonthly:   number
  esiApplies:   boolean
  mediclaim:    number
  annualBonus:  number
  hasIncentive: boolean
}

interface BreakupsResponse {
  month: number
  year:  number
  asOf:  string
  employeeCount: number
  rows: BreakupRow[]
  departments: string[]
}

const MONTH_NAMES = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
]

const CURR_YEAR  = new Date().getFullYear()
const CURR_MONTH = new Date().getMonth() + 1

export default function SalaryBreakupsPage() {
  const [month,     setMonth]     = useState(CURR_MONTH)
  const [year,      setYear]      = useState(CURR_YEAR)
  const [q,         setQ]         = useState('')
  const [dept,      setDept]      = useState('')
  const [selected,  setSelected]  = useState<Set<string>>(new Set())
  const [downloading, setDownloading] = useState(false)
  const [format,    setFormat]    = useState<'slip' | 'long' | 'wide'>('slip')

  const { data, isLoading, isFetching } = useQuery<BreakupsResponse>({
    queryKey: ['salary-breakups', month, year, dept],
    queryFn: () =>
      api.get('/api/hr/salary-breakups', { params: { month, year, department: dept } })
         .then(r => r.data.data),
    staleTime: 30_000,
  })

  // Local search filter for already-fetched rows
  const filteredRows = useMemo(() => {
    if (!data?.rows) return []
    const needle = q.trim().toLowerCase()
    if (!needle) return data.rows
    return data.rows.filter(r =>
      r.name.toLowerCase().includes(needle) ||
      r.employeeCode.toLowerCase().includes(needle) ||
      (r.jobTitle || '').toLowerCase().includes(needle) ||
      (r.department || '').toLowerCase().includes(needle)
    )
  }, [data?.rows, q])

  const allSelectedOnPage = filteredRows.length > 0 && filteredRows.every(r => selected.has(r.employeeId))

  function toggleOne(id: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  function toggleAllVisible() {
    setSelected(prev => {
      const next = new Set(prev)
      if (allSelectedOnPage) {
        filteredRows.forEach(r => next.delete(r.employeeId))
      } else {
        filteredRows.forEach(r => next.add(r.employeeId))
      }
      return next
    })
  }

  function clearSelection() { setSelected(new Set()) }

  async function handleDownload(scope: 'selected' | 'all') {
    setDownloading(true)
    try {
      const body: any = { month, year, format }
      if (scope === 'selected') {
        body.employeeIds = Array.from(selected)
        if (body.employeeIds.length === 0) return
      } else {
        // Export all visible (filtered) rows
        body.employeeIds = filteredRows.map(r => r.employeeId)
      }
      const res = await api.post('/api/hr/salary-breakups/export', body, { responseType: 'blob' })
      const blob = new Blob([res.data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `salary-breakups-${year}-${String(month).padStart(2, '0')}.xlsx`
      document.body.appendChild(a); a.click(); a.remove()
      URL.revokeObjectURL(url)
    } finally {
      setDownloading(false)
    }
  }

  const selectedCount = selected.size
  const yearOpts = [CURR_YEAR - 2, CURR_YEAR - 1, CURR_YEAR, CURR_YEAR + 1]

  return (
    <div className="space-y-4">
      <PageHeader
        title="Salary Breakups"
        subtitle={data ? `${data.employeeCount} employees — ${MONTH_NAMES[month-1]} ${year}` : 'Loading…'}
        actions={
          <div className="flex items-center gap-2">
            {selectedCount > 0 && (
              <button onClick={clearSelection}
                className="text-xs text-slate-500 hover:text-slate-700 px-2">
                Clear ({selectedCount})
              </button>
            )}
            <Button
              icon={<Download size={14}/>}
              variant="secondary"
              loading={downloading}
              disabled={filteredRows.length === 0}
              onClick={() => handleDownload(selectedCount > 0 ? 'selected' : 'all')}>
              {selectedCount > 0 ? `Download ${selectedCount}` : `Download All (${filteredRows.length})`}
            </Button>
          </div>
        }
      />

      {/* Filters */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4">
        <div className="grid grid-cols-1 sm:grid-cols-5 gap-3">
          <div>
            <label className="label text-xs">Month</label>
            <select className="input text-sm" value={month} onChange={e => setMonth(Number(e.target.value))}>
              {MONTH_NAMES.map((m, i) => <option key={i} value={i+1}>{m}</option>)}
            </select>
          </div>
          <div>
            <label className="label text-xs">Year</label>
            <select className="input text-sm" value={year} onChange={e => setYear(Number(e.target.value))}>
              {yearOpts.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
          <div>
            <label className="label text-xs">Department</label>
            <select className="input text-sm" value={dept} onChange={e => setDept(e.target.value)}>
              <option value="">All departments</option>
              {data?.departments?.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className="label text-xs">Search</label>
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"/>
              <input
                className="input text-sm pl-9"
                value={q}
                onChange={e => setQ(e.target.value)}
                placeholder="Name, code, job title…"
              />
            </div>
          </div>
        </div>

        <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
          <div className="flex items-center gap-2">
            <Users size={13}/>
            <span>Showing {filteredRows.length} of {data?.employeeCount ?? 0}</span>
            {isFetching && <span className="text-slate-400">Refreshing…</span>}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-slate-400">Export format:</span>
            <button
              onClick={() => setFormat('slip')}
              className={clsx('px-2 py-1 rounded-md border text-xs transition',
                format === 'slip' ? 'bg-brand-50 border-brand-200 text-brand-700 font-semibold' : 'border-slate-200 text-slate-500')}>
              PF Format (4-per-row)
            </button>
            <button
              onClick={() => setFormat('long')}
              className={clsx('px-2 py-1 rounded-md border text-xs transition',
                format === 'long' ? 'bg-brand-50 border-brand-200 text-brand-700 font-semibold' : 'border-slate-200 text-slate-500')}>
              Long
            </button>
            <button
              onClick={() => setFormat('wide')}
              className={clsx('px-2 py-1 rounded-md border text-xs transition',
                format === 'wide' ? 'bg-brand-50 border-brand-200 text-brand-700 font-semibold' : 'border-slate-200 text-slate-500')}>
              Wide
            </button>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
        {isLoading ? (
          <Skeleton className="h-80 m-4"/>
        ) : filteredRows.length === 0 ? (
          <div className="p-10 text-center text-sm text-slate-400 flex flex-col items-center gap-2">
            <AlertTriangle size={18}/>
            No employees match the current filters.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-slate-50 border-b-2 border-slate-200 text-left">
                  <th className="px-3 py-2.5 w-10">
                    <input type="checkbox"
                      checked={allSelectedOnPage}
                      onChange={toggleAllVisible}
                      className="w-4 h-4 accent-brand-600 cursor-pointer"/>
                  </th>
                  <th className="px-3 py-2.5 font-semibold text-slate-700 min-w-40">Employee</th>
                  <th className="px-3 py-2.5 font-semibold text-slate-500 min-w-28">Dept</th>
                  <th className="px-3 py-2.5 font-semibold text-slate-500 text-right">CTC/yr</th>
                  <th className="px-3 py-2.5 font-semibold text-slate-500 text-right">Basic</th>
                  <th className="px-3 py-2.5 font-semibold text-slate-500 text-right">HRA</th>
                  <th className="px-3 py-2.5 font-semibold text-slate-500 text-right">Transport</th>
                  <th className="px-3 py-2.5 font-semibold text-slate-500 text-right">FBP</th>
                  <th className="px-3 py-2.5 font-semibold text-slate-500 text-right">HYI</th>
                  <th className="px-3 py-2.5 font-semibold text-brand-700 text-right bg-brand-50 border-l border-brand-100">Gross/mo</th>
                  <th className="px-3 py-2.5 font-semibold text-red-600 text-right bg-red-50 border-l border-red-100">Emp PF</th>
                  <th className="px-3 py-2.5 font-semibold text-red-600 text-right bg-red-50">Emp ESI</th>
                  <th className="px-3 py-2.5 font-semibold text-green-700 text-right bg-green-50 border-l border-green-100">Emplr PF</th>
                  <th className="px-3 py-2.5 font-semibold text-green-700 text-right bg-green-50">Emplr ESI</th>
                  <th className="px-3 py-2.5 font-semibold text-orange-600 text-right bg-orange-50 border-l border-orange-100">PT</th>
                  <th className="px-3 py-2.5 font-semibold text-emerald-700 text-right bg-emerald-50 border-l border-emerald-100">Net/mo</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((r, idx) => {
                  const isSel = selected.has(r.employeeId)
                  return (
                    <tr key={r.employeeId} className={clsx(
                      'border-b border-slate-100 transition-colors',
                      isSel ? 'bg-brand-50/40' : idx % 2 === 0 ? 'bg-white' : 'bg-slate-50/30',
                      'hover:bg-slate-100/50'
                    )}>
                      <td className="px-3 py-2">
                        <input type="checkbox"
                          checked={isSel}
                          onChange={() => toggleOne(r.employeeId)}
                          className="w-4 h-4 accent-brand-600 cursor-pointer"/>
                      </td>
                      <td className="px-3 py-2">
                        <div className="font-medium text-slate-800">{r.name}</div>
                        <div className="text-[10px] text-slate-400 font-mono flex items-center gap-1.5">
                          {r.employeeCode}
                          {r.status === 'ON_NOTICE' && (
                            <span className="px-1 py-0.5 rounded bg-amber-100 text-amber-700 text-[9px] font-semibold">NOTICE</span>
                          )}
                          {r.esiApplies && (
                            <span className="px-1 py-0.5 rounded bg-blue-100 text-blue-700 text-[9px] font-semibold">ESI</span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-slate-600">{r.department || '—'}</td>
                      <td className="px-3 py-2 text-right font-mono text-slate-700"><Rupee amount={r.annualCtc}/></td>
                      <td className="px-3 py-2 text-right font-mono text-slate-600"><Rupee amount={r.basic}/></td>
                      <td className="px-3 py-2 text-right font-mono text-slate-600"><Rupee amount={r.hra}/></td>
                      <td className="px-3 py-2 text-right font-mono text-slate-600"><Rupee amount={r.transport}/></td>
                      <td className="px-3 py-2 text-right font-mono text-slate-600"><Rupee amount={r.fbp}/></td>
                      <td className="px-3 py-2 text-right font-mono text-slate-600"><Rupee amount={r.hyi}/></td>
                      <td className="px-3 py-2 text-right font-mono font-semibold text-brand-700 bg-brand-50/40 border-l border-brand-100"><Rupee amount={r.grossMonthly}/></td>
                      <td className="px-3 py-2 text-right font-mono text-red-600 bg-red-50/40 border-l border-red-100"><Rupee amount={r.employeePf}/></td>
                      <td className="px-3 py-2 text-right font-mono text-red-600 bg-red-50/40"><Rupee amount={r.employeeEsi}/></td>
                      <td className="px-3 py-2 text-right font-mono text-green-700 bg-green-50/40 border-l border-green-100"><Rupee amount={r.employerPf}/></td>
                      <td className="px-3 py-2 text-right font-mono text-green-700 bg-green-50/40"><Rupee amount={r.employerEsi}/></td>
                      <td className="px-3 py-2 text-right font-mono text-orange-600 bg-orange-50/40 border-l border-orange-100"><Rupee amount={r.pt}/></td>
                      <td className="px-3 py-2 text-right font-mono font-semibold text-emerald-700 bg-emerald-50/40 border-l border-emerald-100"><Rupee amount={r.netMonthly}/></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className="text-xs text-slate-400 px-1">
        Salary shown is as-of last day of selected month (respects effective-dated salary revisions). Employer PF &amp; ESI are inside CTC. Net/mo = Gross − Employee PF − Employee ESI − Professional Tax. TDS excluded (computed at payroll time).
      </p>
    </div>
  )
}
