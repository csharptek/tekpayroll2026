import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Play, AlertCircle, ChevronDown, ChevronUp, Download, RefreshCw, Info } from 'lucide-react'
import { payrollApi } from '../../services/api'
import { PageHeader, Button, Card, Table, Th, Td, Tr, Alert, StatCard } from '../../components/ui'
import clsx from 'clsx'

function ru(n: number) {
  return `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`
}

function defaultMonth() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

function monthToCycleDates(month: string) {
  const [y, m] = month.split('-').map(Number)
  const prevMonth = m === 1 ? 12 : m - 1
  const prevYear  = m === 1 ? y - 1 : y
  return {
    cycleStart: `${prevYear}-${String(prevMonth).padStart(2, '0')}-26`,
    cycleEnd:   `${y}-${String(m).padStart(2, '0')}-25`,
  }
}

function RowDetail({ row }: { row: any }) {
  const earnings = [
    { label: 'Basic',          value: row.basic },
    { label: 'HRA',            value: row.hra },
    { label: 'Transport',      value: row.transport },
    { label: 'FBP',            value: row.fbp },
    { label: 'HYI',            value: row.hyi },
    { label: 'Reimbursements', value: row.reimbursements },
    ...(row.isBonusMonth ? [{ label: 'Annual Bonus', value: row.annualBonus }] : []),
  ]
  const deductions = [
    { label: 'PF',       value: row.pfAmount },
    { label: 'ESI',      value: row.esiAmount },
    { label: 'PT',       value: row.ptAmount },
    { label: 'TDS',      value: row.tdsAmount },
    { label: 'LOP',      value: row.lopAmount },
    { label: 'Loan EMI', value: row.loanDeduction },
  ].filter(d => d.value > 0)

  return (
    <tr>
      <td colSpan={10} className="bg-slate-50 px-6 pb-4 pt-2">
        <div className="grid grid-cols-2 gap-6 max-w-2xl">
          <div>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Earnings</p>
            <div className="space-y-1.5">
              {earnings.map(e => e.value > 0 && (
                <div key={e.label} className="flex justify-between text-xs">
                  <span className="text-slate-500">{e.label}</span>
                  <span className="font-medium text-slate-700">{ru(e.value)}</span>
                </div>
              ))}
              {row.isProrated && (
                <div className="flex justify-between text-xs text-amber-600 border-t border-slate-200 pt-1 mt-1">
                  <span>Prorated ({row.payableDays}/{row.totalDays} days)</span>
                  <span className="font-medium">{ru(row.proratedGross)}</span>
                </div>
              )}
            </div>
          </div>
          <div>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Deductions</p>
            <div className="space-y-1.5">
              {deductions.length === 0
                ? <p className="text-xs text-slate-400">No deductions</p>
                : deductions.map(d => (
                  <div key={d.label} className="flex justify-between text-xs">
                    <span className="text-slate-500">{d.label}</span>
                    <span className="font-medium text-red-600">{ru(d.value)}</span>
                  </div>
                ))
              }
            </div>
          </div>
        </div>
        {row.isProrated   && <p className="text-[11px] text-amber-600 mt-2 flex items-center gap-1"><Info size={11} /> Prorated employee</p>}
        {row.isBonusMonth && <p className="text-[11px] text-purple-600 mt-1 flex items-center gap-1"><Info size={11} /> Bonus month — annual incentive included</p>}
      </td>
    </tr>
  )
}

function exportCsv(results: any[], month: string) {
  const headers = [
    'Employee Code','Name','Department','Designation',
    'Annual CTC','Gross Monthly','Basic','HRA','Transport','FBP','HYI',
    'Reimbursements','Annual Bonus','Total Days','Payable Days','Is Prorated','Prorated Gross',
    'LOP Days','LOP Amount','PF','ESI','PT','TDS','Loan EMI','Net Salary','Status',
  ]
  const rows = results.map(r => [
    r.employeeCode, r.name, r.department||'', r.designation||'',
    r.annualCtc||0, r.grossMonthly||0, r.basic||0, r.hra||0, r.transport||0, r.fbp||0, r.hyi||0,
    r.reimbursements||0, r.annualBonus||0, r.totalDays||0, r.payableDays||0,
    r.isProrated?'Yes':'No', r.proratedGross||0,
    r.lopDays||0, r.lopAmount||0,
    r.pfAmount||0, r.esiAmount||0, r.ptAmount||0, r.tdsAmount||0, r.loanDeduction||0,
    r.netSalary||0, r.status,
  ])
  const csv = [headers, ...rows].map(row => row.map(v => `"${v}"`).join(',')).join('\n')
  const a   = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(new Blob([csv], { type: 'text/csv' })),
    download: `payroll-dryrun-${month}.csv`,
  })
  a.click()
}

export default function PayrollDryRunPage() {
  const [month,      setMonth]      = useState(defaultMonth())
  const [cycleStart, setCycleStart] = useState(monthToCycleDates(defaultMonth()).cycleStart)
  const [cycleEnd,   setCycleEnd]   = useState(monthToCycleDates(defaultMonth()).cycleEnd)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [filterDept, setFilterDept] = useState('All')

  const dryRunMut = useMutation({
    mutationFn: () => payrollApi.dryRun({ cycleStart, cycleEnd, payrollMonth: month, overrides: {} }),
  })

  const result = (dryRunMut.data as any)?.data

  function handleMonthChange(val: string) {
    setMonth(val)
    const { cycleStart: cs, cycleEnd: ce } = monthToCycleDates(val)
    setCycleStart(cs)
    setCycleEnd(ce)
  }

  const departments: string[] = result
    ? ['All', ...Array.from(new Set<string>(result.results.map((r: any) => r.department as string).filter(Boolean)))]
    : ['All']

  const filtered = result?.results?.filter((r: any) => filterDept === 'All' || r.department === filterDept) || []
  const errors   = filtered.filter((r: any) => r.status === 'error')
  const ok       = filtered.filter((r: any) => r.status === 'ok')

  return (
    <div className="space-y-5 max-w-7xl">
      <PageHeader title="Payroll Dry Run" subtitle="Simulate payroll without saving — test before the real run" />

      <Card className="p-5">
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <label className="label">Payroll Month</label>
            <input type="month" className="input mt-1 w-44" value={month} onChange={e => handleMonthChange(e.target.value)} />
          </div>
          <div>
            <label className="label">Cycle Start</label>
            <input type="date" className="input mt-1 w-40" value={cycleStart} onChange={e => setCycleStart(e.target.value)} />
          </div>
          <div>
            <label className="label">Cycle End</label>
            <input type="date" className="input mt-1 w-40" value={cycleEnd} onChange={e => setCycleEnd(e.target.value)} />
          </div>
          <Button
            icon={dryRunMut.isPending ? <RefreshCw size={14} className="animate-spin" /> : <Play size={14} />}
            loading={dryRunMut.isPending}
            onClick={() => { setExpandedId(null); dryRunMut.mutate() }}
          >
            {dryRunMut.isPending ? 'Running Payroll…' : result ? 'Recalculate' : 'Run Simulation'}
          </Button>
          {result && (
            <Button variant="secondary" icon={<Download size={14} />} onClick={() => exportCsv(result.results, month)}>
              Export CSV
            </Button>
          )}
        </div>
        <p className="mt-3 flex items-center gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          <Info size={13} className="flex-shrink-0" />
          Simulation only — no data will be saved to the database.
        </p>
      </Card>

      {dryRunMut.isError && (
        <Alert type="error" message={(dryRunMut.error as any)?.response?.data?.message || 'Dry run failed'} />
      )}

      {/* Loading state */}
      {dryRunMut.isPending && (
        <Card className="p-10 flex flex-col items-center justify-center gap-3">
          <RefreshCw size={32} className="animate-spin text-brand-600" />
          <p className="text-base font-semibold text-slate-700">Calculating payroll for all employees…</p>
          <p className="text-sm text-slate-400">This may take a few seconds. Please wait.</p>
        </Card>
      )}

      {result && !dryRunMut.isPending && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
            <StatCard label="Employees"   value={String(result.employeeCount)}  icon={null} color="blue"   />
            <StatCard label="Total Gross" value={ru(result.summary.totalGross)} icon={null} color="green"  />
            <StatCard label="Total Net"   value={ru(result.summary.totalNet)}   icon={null} color="purple" />
            <StatCard label="Total PF"    value={ru(result.summary.totalPf)}    icon={null} color="amber"  />
            <StatCard label="Total TDS"   value={ru(result.summary.totalTds)}   icon={null} color="red"    />
            <StatCard label="Total ESI"   value={ru(result.summary.totalEsi)}   icon={null} color="blue"   />
          </div>

          {result.isBonusMonth && (
            <div className="flex items-center gap-2 px-4 py-2.5 bg-purple-50 border border-purple-200 rounded-xl text-sm text-purple-700 font-medium">
              🎉 Bonus month — annual incentives included
            </div>
          )}

          {errors.length > 0 && (
            <Alert type="error" message={`${errors.length} employee(s) failed: ${errors.map((e: any) => e.name).join(', ')}`} />
          )}

          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-xs font-medium text-slate-500">Department:</span>
            {departments.map(d => (
              <button key={d} onClick={() => setFilterDept(d)}
                className={clsx('px-2.5 py-1 rounded-full text-xs font-medium transition-colors',
                  filterDept === d ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                )}>
                {d}
              </button>
            ))}
          </div>

          <Card>
            <div className="overflow-x-auto">
              <Table>
                <thead>
                  <tr className="border-b border-slate-100">
                    <Th>Employee</Th>
                    <Th>Dept</Th>
                    <Th className="text-right">Gross</Th>
                    <Th className="text-right">LOP</Th>
                    <Th className="text-right">PF</Th>
                    <Th className="text-right">TDS</Th>
                    <Th className="text-right">Reimb</Th>
                    <Th className="text-right">Net</Th>
                    <Th />
                  </tr>
                </thead>
                <tbody>
                  {ok.map((row: any) => (
                    <>
                      <Tr key={row.employeeId}
                        onClick={() => setExpandedId(expandedId === row.employeeId ? null : row.employeeId)}
                        className="cursor-pointer">
                        <Td>
                          <p className="text-sm font-semibold text-slate-800">{row.name}</p>
                          <p className="text-xs text-slate-400 font-mono">{row.employeeCode}</p>
                        </Td>
                        <Td>{row.department || '—'}</Td>
                        <Td className="text-right rupee">{ru(row.proratedGross)}</Td>
                        <Td className="text-right rupee text-red-500">
                          {row.lopDays > 0 ? `${row.lopDays}d / ${ru(row.lopAmount)}` : '—'}
                        </Td>
                        <Td className="text-right rupee text-slate-500">{ru(row.pfAmount)}</Td>
                        <Td className="text-right rupee text-slate-500">{row.tdsAmount > 0 ? ru(row.tdsAmount) : '—'}</Td>
                        <Td className="text-right rupee text-emerald-600">{row.reimbursements > 0 ? ru(row.reimbursements) : '—'}</Td>
                        <Td className="text-right">
                          <span className="font-bold text-slate-800 rupee">{ru(row.netSalary)}</span>
                        </Td>
                        <Td>
                          <div className="flex items-center gap-1 flex-shrink-0">
                            {row.isProrated   && <span className="text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded font-medium">PRO</span>}
                            {row.isBonusMonth && <span className="text-[10px] bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded font-medium">BONUS</span>}
                            {row.lopDays > 0  && <span className="text-[10px] bg-red-100 text-red-600 px-1.5 py-0.5 rounded font-medium">LOP</span>}
                            {expandedId === row.employeeId ? <ChevronUp size={13} className="text-slate-400" /> : <ChevronDown size={13} className="text-slate-400" />}
                          </div>
                        </Td>
                      </Tr>
                      {expandedId === row.employeeId && <RowDetail key={`d-${row.employeeId}`} row={row} />}
                    </>
                  ))}

                  {errors.map((row: any) => (
                    <Tr key={row.employeeId} className="bg-red-50">
                      <Td>
                        <p className="text-sm font-semibold text-slate-800">{row.name}</p>
                        <p className="text-xs text-slate-400 font-mono">{row.employeeCode}</p>
                      </Td>
                      <Td>{row.department || '—'}</Td>
                      <td colSpan={6} className="table-cell">
                        <div className="flex items-center gap-1.5 text-xs text-red-600">
                          <AlertCircle size={12} /> {row.error}
                        </div>
                      </td>
                      <Td />
                    </Tr>
                  ))}

                  {ok.length === 0 && errors.length === 0 && (
                    <tr><td colSpan={9} className="text-center py-8 text-sm text-slate-400">No employees found</td></tr>
                  )}
                </tbody>
              </Table>
            </div>

            {ok.length > 0 && (
              <div className="border-t border-slate-100 px-4 py-3 flex flex-wrap gap-6 text-xs text-slate-500">
                <span>Showing <strong className="text-slate-700">{filtered.length}</strong> employees</span>
                <span>Total Gross: <strong className="text-slate-700 rupee">{ru(ok.reduce((s: number, r: any) => s + (r.proratedGross || 0), 0))}</strong></span>
                <span>Total Net: <strong className="text-slate-800 rupee">{ru(ok.reduce((s: number, r: any) => s + (r.netSalary || 0), 0))}</strong></span>
                {ok.some((r: any) => r.lopDays > 0) && (
                  <span>Total LOP: <strong className="text-red-600 rupee">{ru(ok.reduce((s: number, r: any) => s + (r.lopAmount || 0), 0))}</strong></span>
                )}
                {ok.some((r: any) => r.reimbursements > 0) && (
                  <span>Total Reimb: <strong className="text-emerald-600 rupee">{ru(ok.reduce((s: number, r: any) => s + (r.reimbursements || 0), 0))}</strong></span>
                )}
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  )
}
