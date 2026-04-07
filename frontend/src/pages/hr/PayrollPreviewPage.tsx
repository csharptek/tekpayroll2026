import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { format, addMonths, subMonths } from 'date-fns'
import { Eye, Loader2, ChevronDown, ChevronUp, AlertCircle } from 'lucide-react'
import { payrollApi } from '../../services/api'
import { PageHeader, Card, Table, Th, Td, Tr, Rupee, Alert } from '../../components/ui'
import clsx from 'clsx'

function getDefaultMonth() {
  const now = new Date()
  return format(now, 'yyyy-MM')
}

function getCycleRange(payrollMonth: string) {
  const [y, m] = payrollMonth.split('-').map(Number)
  const cycleStart = new Date(y, m - 2, 26) // 26th of previous month
  const cycleEnd   = new Date(y, m - 1, 25) // 25th of current month
  return { cycleStart: format(cycleStart, 'yyyy-MM-dd'), cycleEnd: format(cycleEnd, 'yyyy-MM-dd') }
}

export default function PayrollPreviewPage() {
  const [payrollMonth, setPayrollMonth] = useState(getDefaultMonth())
  const [expandedId, setExpandedId]     = useState<string | null>(null)

  const preview = useMutation({
    mutationFn: (month: string) => {
      const { cycleStart, cycleEnd } = getCycleRange(month)
      return payrollApi.preview({ payrollMonth: month, cycleStart, cycleEnd })
    },
  })

  const data    = preview.data?.data?.data
  const results = data?.results || []
  const summary = data?.summary
  const okCount = results.filter((r: any) => r.status === 'ok').length
  const errCount = results.filter((r: any) => r.status === 'error').length

  return (
    <div className="space-y-5">
      <PageHeader
        title="Payroll Preview"
        subtitle="View calculated payroll without saving to database"
      />

      {/* Controls */}
      <Card>
        <div className="p-4 flex flex-wrap items-end gap-4">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Payroll Month</label>
            <input
              type="month"
              value={payrollMonth}
              onChange={e => setPayrollMonth(e.target.value)}
              className="input-field w-44"
            />
          </div>
          <div className="text-sm text-gray-500">
            Cycle: 26 {format(subMonths(new Date(payrollMonth + '-01'), 0), 'MMM')} — 25 {format(new Date(payrollMonth + '-01'), 'MMM yyyy')}
          </div>
          <button
            onClick={() => preview.mutate(payrollMonth)}
            disabled={preview.isPending}
            className="ml-auto flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50"
          >
            {preview.isPending
              ? <><Loader2 size={14} className="animate-spin" /> Calculating...</>
              : <><Eye size={14} /> Preview</>
            }
          </button>
        </div>
      </Card>

      {preview.isError && (
        <Alert type="error" message="Failed to calculate preview. Check console for details." />
      )}

      {/* Summary */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: 'Employees',   value: okCount,           isMoney: false },
            { label: 'Total Gross', value: summary.totalGross, isMoney: true  },
            { label: 'Total Net',   value: summary.totalNet,   isMoney: true  },
            { label: 'Total PF',    value: summary.totalPf,    isMoney: true  },
          ].map(s => (
            <Card key={s.label}>
              <div className="p-4">
                <p className="text-xs text-gray-500">{s.label}</p>
                <p className="text-xl font-bold text-gray-800 mt-1">
                  {s.isMoney ? <Rupee amount={s.value} /> : s.value}
                </p>
              </div>
            </Card>
          ))}
        </div>
      )}

      {errCount > 0 && (
        <Alert type="error" title={`${errCount} employee(s) failed to calculate`} message="See error rows below." />
      )}

      {/* Results Table */}
      {results.length > 0 && (
        <Card>
          <Table>
            <thead>
              <tr>
                <Th>Employee</Th>
                <Th>Gross</Th>
                <Th>Basic</Th>
                <Th>HYI</Th>
                <Th>Days</Th>
                <Th>PF</Th>
                <Th>ESI</Th>
                <Th>PT</Th>
                <Th>TDS</Th>
                <Th>LOP</Th>
                <Th>Net</Th>
                <Th></Th>
              </tr>
            </thead>
            <tbody>
              {results.map((r: any) => (
                <>
                  <Tr
                    key={r.employeeId}
                    className={r.status === 'error' ? 'bg-red-50' : undefined}
                  >
                    <Td>
                      <p className="font-medium text-gray-800 text-sm">{r.name}</p>
                      <p className="text-xs text-gray-400">{r.employeeCode}</p>
                    </Td>
                    {r.status === 'error' ? (
                      <Td colSpan={10}>
                        <span className="flex items-center gap-1 text-red-600 text-sm">
                          <AlertCircle size={13} /> {r.error}
                        </span>
                      </Td>
                    ) : (
                      <>
                        <Td><Rupee amount={r.proratedGross} /></Td>
                        <Td><Rupee amount={r.basic} /></Td>
                        <Td>
                          <span className={clsx('text-sm', r.hyi === 0 ? 'text-amber-600 font-medium' : '')}>
                            <Rupee amount={r.hyi} />
                            {r.hyi === 0 && r.grossMonthly > 0 && (
                              <span className="ml-1 text-xs">(suppressed)</span>
                            )}
                          </span>
                        </Td>
                        <Td className="text-sm text-gray-600">
                          {r.payableDays}/{r.totalDays}
                          {r.isProrated && <span className="ml-1 text-xs text-amber-600">pro</span>}
                        </Td>
                        <Td><Rupee amount={r.pfAmount} /></Td>
                        <Td><Rupee amount={r.esiAmount} /></Td>
                        <Td><Rupee amount={r.ptAmount} /></Td>
                        <Td><Rupee amount={r.tdsAmount} /></Td>
                        <Td>
                          {r.lopDays > 0
                            ? <span className="text-red-600"><Rupee amount={r.lopAmount} /> <span className="text-xs">({r.lopDays}d)</span></span>
                            : <span className="text-gray-400">—</span>
                          }
                        </Td>
                        <Td className="font-semibold text-gray-800"><Rupee amount={r.netSalary} /></Td>
                        <Td>
                          <button
                            onClick={() => setExpandedId(expandedId === r.employeeId ? null : r.employeeId)}
                            className="text-gray-400 hover:text-gray-600"
                          >
                            {expandedId === r.employeeId ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                          </button>
                        </Td>
                      </>
                    )}
                  </Tr>
                  {expandedId === r.employeeId && r.status === 'ok' && (
                    <tr key={`${r.employeeId}-detail`} className="bg-gray-50">
                      <td colSpan={12} className="px-4 py-3">
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-1 text-sm">
                          <div><span className="text-gray-500">Annual CTC:</span> <Rupee amount={r.annualCtc} /></div>
                          <div><span className="text-gray-500">Monthly Gross:</span> <Rupee amount={r.grossMonthly} /></div>
                          <div><span className="text-gray-500">HRA:</span> <Rupee amount={r.hra} /></div>
                          <div><span className="text-gray-500">Transport:</span> <Rupee amount={r.transport} /></div>
                          <div><span className="text-gray-500">FBP:</span> <Rupee amount={r.fbp} /></div>
                          <div><span className="text-gray-500">Reimbursements:</span> <Rupee amount={r.reimbursements} /></div>
                          <div><span className="text-gray-500">Loan Deduction:</span> <Rupee amount={r.loanDeduction} /></div>
                          {r.isBonusMonth && (
                            <div><span className="text-gray-500">Annual Bonus:</span> <Rupee amount={r.annualBonus} /></div>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
    </div>
  )
}
