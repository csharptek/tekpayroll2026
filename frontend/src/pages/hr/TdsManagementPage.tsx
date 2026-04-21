import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import { Calculator, History, User } from 'lucide-react'
import api from '../../services/api'
import { PageHeader, Button, Card, Rupee, Skeleton, Alert } from '../../components/ui'

const MONTH_NAMES = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
]
const CURR_YEAR  = new Date().getFullYear()
const CURR_MONTH = new Date().getMonth() + 1

function currentPayrollMonth() {
  return `${CURR_YEAR}-${String(CURR_MONTH).padStart(2, '0')}`
}

export default function TdsManagementPage() {
  const qc = useQueryClient()

  const [selectedEmpId, setSelectedEmpId] = useState('')
  const [payrollMonth,  setPayrollMonth]  = useState(currentPayrollMonth())
  const [annualTax,     setAnnualTax]     = useState('')
  const [note,          setNote]          = useState('')
  const [saved,         setSaved]         = useState(false)

  // Employee list
  const { data: empList } = useQuery<any[]>({
    queryKey: ['tds-emp-list'],
    queryFn: () => api.get('/api/tds').then(r => r.data.data),
  })

  // Employee TDS summary
  const { data: summary, isLoading: summaryLoading } = useQuery<any>({
    queryKey: ['tds-summary', selectedEmpId, payrollMonth],
    queryFn: () => api.get(`/api/tds/${selectedEmpId}`, { params: { payrollMonth } }).then(r => r.data.data),
    enabled: !!selectedEmpId,
  })

  // Auto-populate annualTax when employee selected
  useEffect(() => {
    if (summary) {
      // Find current FY config if exists
      const latest = summary.history?.[0]
      if (latest) setAnnualTax(String(Number(latest.annualTax)))
      else setAnnualTax('')
    }
  }, [summary])

  // Computed preview
  const annualNum  = parseFloat(annualTax) || 0
  const ytdPaid    = summary?.ytdPaid || 0
  const remaining  = Math.max(0, annualNum - ytdPaid)
  const remMonths  = summary?.remainingMonths || 12
  const previewMTD = remMonths > 0 ? Math.round((remaining / remMonths) * 100) / 100 : 0

  const saveMut = useMutation({
    mutationFn: () => api.post(`/api/tds/${selectedEmpId}`, { annualTax: annualNum, payrollMonth, note }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tds-summary', selectedEmpId] })
      qc.invalidateQueries({ queryKey: ['tds-emp-list'] })
      setSaved(true)
      setNote('')
      setTimeout(() => setSaved(false), 3000)
    },
  })

  const yearOpts = [CURR_YEAR - 1, CURR_YEAR, CURR_YEAR + 1]

  function getFY(pm: string) {
    const [y, m] = pm.split('-').map(Number)
    const s = m >= 4 ? y : y - 1
    return `${s}-${String(s + 1).slice(2)}`
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="TDS Management"
        subtitle="Set annual tax liability per employee — monthly TDS auto-calculated"
      />

      {/* Filters */}
      <Card>
        <div className="p-5 grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="flex flex-col gap-1">
            <label className="label">Employee *</label>
            <select className="input" value={selectedEmpId} onChange={e => { setSelectedEmpId(e.target.value); setSaved(false) }}>
              <option value="">Select employee…</option>
              {(empList || []).map((e: any) => (
                <option key={e.id} value={e.id}>{e.name} ({e.employeeCode})</option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="label">Effective Month</label>
            <select className="input" value={payrollMonth} onChange={e => setPayrollMonth(e.target.value)}>
              {yearOpts.flatMap(y =>
                Array.from({ length: 12 }, (_, i) => {
                  const m = i + 1
                  const val = `${y}-${String(m).padStart(2, '0')}`
                  return <option key={val} value={val}>{MONTH_NAMES[i]} {y}</option>
                })
              )}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="label">Financial Year</label>
            <div className="input bg-slate-50 text-slate-500 flex items-center">{getFY(payrollMonth)}</div>
          </div>
        </div>
      </Card>

      {!selectedEmpId && (
        <div className="text-center py-12 text-slate-400 text-sm flex flex-col items-center gap-2">
          <User size={24} />
          Select an employee to manage TDS
        </div>
      )}

      {selectedEmpId && summaryLoading && <Skeleton className="h-48 rounded-xl" />}

      {selectedEmpId && summary && (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {[
              { label: 'Current Monthly TDS', value: <Rupee amount={summary.currentMonthlyTds} />, sub: 'being deducted now' },
              { label: 'YTD Paid', value: <Rupee amount={summary.ytdPaid} />, sub: `FY ${summary.financialYear}` },
              { label: 'Remaining Months', value: summary.remainingMonths, sub: 'in this FY' },
              { label: 'Annual TDS (current)', value: summary.history?.[0] ? <Rupee amount={summary.history[0].annualTax} /> : '—', sub: 'last set' },
            ].map(({ label, value, sub }) => (
              <div key={label} className="card p-4">
                <p className="stat-label">{label}</p>
                <p className="text-lg font-display font-bold text-slate-900 mt-1">{value}</p>
                <p className="text-xs text-slate-400 mt-0.5">{sub}</p>
              </div>
            ))}
          </div>

          {/* Set TDS form */}
          <Card title="Set / Revise Annual Tax Liability">
            <div className="p-5 space-y-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="flex flex-col gap-1">
                  <label className="label">Annual Tax Liability (₹) *</label>
                  <input
                    type="number"
                    className="input"
                    placeholder="e.g. 120000"
                    value={annualTax}
                    onChange={e => { setAnnualTax(e.target.value); setSaved(false) }}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="label">Note (optional)</label>
                  <input
                    type="text"
                    className="input"
                    placeholder="e.g. Q3 revision after investment declaration"
                    value={note}
                    onChange={e => setNote(e.target.value)}
                  />
                </div>
              </div>

              {/* Live preview */}
              {annualNum > 0 && (
                <div className="bg-brand-50 border border-brand-100 rounded-xl p-4">
                  <div className="flex items-center gap-2 text-brand-700 font-semibold text-sm mb-3">
                    <Calculator size={15} /> Calculation Preview
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
                    {[
                      { label: 'Annual Tax',       value: <Rupee amount={annualNum} /> },
                      { label: 'YTD Already Paid', value: <Rupee amount={ytdPaid} /> },
                      { label: 'Balance Remaining', value: <Rupee amount={remaining} /> },
                      { label: 'Monthly TDS (new)', value: <Rupee amount={previewMTD} />, highlight: true },
                    ].map(({ label, value, highlight }) => (
                      <div key={label} className={highlight ? 'bg-white rounded-lg p-2 border border-brand-200' : ''}>
                        <p className="text-slate-500">{label}</p>
                        <p className={`font-bold mt-0.5 ${highlight ? 'text-brand-700 text-base' : 'text-slate-800'}`}>{value}</p>
                      </div>
                    ))}
                  </div>
                  <p className="text-xs text-slate-400 mt-3">
                    ({annualNum > 0 ? `₹${annualNum.toLocaleString('en-IN')}` : '0'} − ₹{ytdPaid.toLocaleString('en-IN')} already paid) ÷ {remMonths} remaining months = ₹{previewMTD.toLocaleString('en-IN')}/month
                  </p>
                </div>
              )}

              {saved && <Alert type="success" message="TDS updated successfully. Payroll will use new monthly TDS from next run." />}
              {saveMut.isError && <Alert type="error" message={(saveMut.error as any)?.message || 'Failed to save'} />}

              <div className="flex justify-end">
                <Button
                  onClick={() => saveMut.mutate()}
                  loading={saveMut.isPending}
                  disabled={!annualTax || annualNum <= 0}
                >
                  Save TDS Configuration
                </Button>
              </div>
            </div>
          </Card>

          {/* History */}
          {summary.history?.length > 0 && (
            <Card title="Change History">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-slate-100 bg-slate-50">
                      {['FY','Effective From','Annual Tax','Monthly TDS','YTD Paid at Change','Remaining Months','Note','Set On'].map(h => (
                        <th key={h} className="px-4 py-3 text-left font-semibold text-slate-500">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {summary.history.map((h: any, i: number) => (
                      <tr key={h.id} className={i % 2 === 0 ? 'bg-white' : 'bg-slate-50/40'}>
                        <td className="px-4 py-2.5 font-mono text-slate-600">{h.financialYear}</td>
                        <td className="px-4 py-2.5 font-mono text-slate-600">{h.effectiveFrom}</td>
                        <td className="px-4 py-2.5 font-semibold"><Rupee amount={h.annualTax} /></td>
                        <td className="px-4 py-2.5 font-semibold text-brand-700"><Rupee amount={h.monthlyTds} /></td>
                        <td className="px-4 py-2.5"><Rupee amount={h.ytdPaidAtChange} /></td>
                        <td className="px-4 py-2.5 text-center">{h.remainingMonths}</td>
                        <td className="px-4 py-2.5 text-slate-500">{h.note || '—'}</td>
                        <td className="px-4 py-2.5 text-slate-400">{format(new Date(h.createdAt), 'dd MMM yyyy, HH:mm')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {(!summary.history || summary.history.length === 0) && (
            <Card>
              <div className="p-8 text-center text-slate-400 text-sm flex flex-col items-center gap-2">
                <History size={20} />
                No TDS history for this employee in FY {summary.financialYear}
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  )
}
