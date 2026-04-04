import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Download, FileText, Filter } from 'lucide-react'
import { payrollApi, reportApi } from '../../services/api'
import { PageHeader, Button, Card, Table, Th, Td, Tr, Rupee, StatusBadge, Skeleton, EmptyState } from '../../components/ui'
import { format } from 'date-fns'

const REPORT_TYPES = [
  { id: 'payroll-register', label: 'Payroll Register',     desc: 'Full salary breakdown for all employees' },
  { id: 'bank-transfer',    label: 'Bank Transfer Sheet',  desc: 'Net salary list for salary disbursement' },
  { id: 'pf-statement',     label: 'PF Contribution',      desc: 'Employee + employer PF contributions' },
  { id: 'esi-statement',    label: 'ESI Statement',        desc: 'ESI deductions for eligible employees' },
  { id: 'pt-statement',     label: 'Professional Tax',     desc: 'State-wise PT deductions' },
  { id: 'tds-summary',      label: 'TDS Summary',          desc: 'Tax deducted at source summary' },
]

export default function PayrollReportsPage() {
  const [selectedCycle, setSelectedCycle] = useState('')

  const { data: cycles } = useQuery({
    queryKey: ['payroll-cycles'],
    queryFn: () => payrollApi.cycles().then(r => r.data.data),
  })

  const { data: cycle, isLoading } = useQuery({
    queryKey: ['payroll-cycle', selectedCycle],
    queryFn: () => payrollApi.cycle(selectedCycle).then(r => r.data.data),
    enabled: !!selectedCycle,
  })

  const entries = cycle?.entries || []

  function downloadCSV() {
    if (!entries.length) return
    const headers = ['Employee', 'Code', 'Department', 'Gross', 'Basic', 'HRA', 'PF', 'ESI', 'PT', 'TDS', 'LOP', 'Loan', 'Net']
    const rows = entries.map((e: any) => [
      e.employee?.name, e.employee?.employeeCode, e.employee?.department,
      e.grossSalary, e.basic, e.hra, e.pfAmount, e.esiAmount,
      e.ptAmount, e.tdsAmount, e.lopAmount, e.loanDeduction, e.netSalary,
    ])
    const csv = [headers, ...rows].map(r => r.join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href = url; a.download = `payroll-register-${cycle?.payrollMonth}.csv`; a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-5">
      <PageHeader title="Payroll Reports" subtitle="Download compliance and summary reports" />

      {/* Cycle selector */}
      <Card>
        <div className="p-5 flex items-end gap-4">
          <div className="flex-1 flex flex-col gap-1 max-w-xs">
            <label className="label">Select Cycle</label>
            <select className="input" value={selectedCycle} onChange={e => setSelectedCycle(e.target.value)}>
              <option value="">Choose a payroll cycle…</option>
              {(cycles || []).map((c: any) => (
                <option key={c.id} value={c.id}>{c.payrollMonth} — {c.status}</option>
              ))}
            </select>
          </div>
          {selectedCycle && (
            <Button variant="secondary" icon={<Download size={14} />} onClick={downloadCSV}>
              Export CSV
            </Button>
          )}
        </div>
      </Card>

      {/* Report type cards */}
      {!selectedCycle ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {REPORT_TYPES.map(rt => (
            <div key={rt.id} className="card p-4 opacity-50">
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-xl bg-brand-50 flex items-center justify-center flex-shrink-0">
                  <FileText size={16} className="text-brand-500" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-700">{rt.label}</p>
                  <p className="text-xs text-slate-400 mt-0.5">{rt.desc}</p>
                </div>
              </div>
              <p className="text-xs text-slate-300 mt-3">Select a cycle to download</p>
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {REPORT_TYPES.map(rt => (
            <div key={rt.id} className="card p-4 hover:shadow-card-md transition-shadow cursor-pointer group" onClick={downloadCSV}>
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-xl bg-brand-50 group-hover:bg-brand-100 flex items-center justify-center flex-shrink-0 transition-colors">
                  <FileText size={16} className="text-brand-600" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-800">{rt.label}</p>
                  <p className="text-xs text-slate-400 mt-0.5">{rt.desc}</p>
                </div>
              </div>
              <div className="flex items-center gap-1.5 mt-3 text-xs text-brand-600 font-medium">
                <Download size={11} /> Download CSV
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Full payroll register table */}
      {selectedCycle && (
        <Card title={`Payroll Register — ${cycle?.payrollMonth}`}>
          {isLoading ? <Skeleton className="h-48 m-4" /> : !entries.length ? (
            <EmptyState icon={<FileText size={20} />} title="No payroll entries" description="Run payroll first to see the register." />
          ) : (
            <Table>
              <thead><tr className="border-b border-slate-100">
                <Th>Employee</Th><Th className="text-right">Gross</Th><Th className="text-right">PF</Th>
                <Th className="text-right">ESI</Th><Th className="text-right">PT</Th>
                <Th className="text-right">TDS</Th><Th className="text-right">LOP</Th>
                <Th className="text-right font-bold">Net</Th>
              </tr></thead>
              <tbody>
                {entries.map((e: any) => (
                  <Tr key={e.id}>
                    <Td>
                      <p className="font-medium text-slate-800">{e.employee?.name}</p>
                      <p className="text-xs text-slate-400">{e.employee?.department}</p>
                    </Td>
                    <Td className="text-right"><Rupee amount={e.proratedGross} /></Td>
                    <Td className="text-right"><Rupee amount={e.pfAmount} /></Td>
                    <Td className="text-right">{Number(e.esiAmount) > 0 ? <Rupee amount={e.esiAmount} /> : '—'}</Td>
                    <Td className="text-right">{Number(e.ptAmount) > 0 ? <Rupee amount={e.ptAmount} /> : '—'}</Td>
                    <Td className="text-right">{Number(e.tdsAmount) > 0 ? <Rupee amount={e.tdsAmount} /> : '—'}</Td>
                    <Td className="text-right">{Number(e.lopAmount) > 0 ? <Rupee amount={e.lopAmount} className="text-red-500" /> : '—'}</Td>
                    <Td className="text-right font-bold"><Rupee amount={e.netSalary} /></Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      )}
    </div>
  )
}
