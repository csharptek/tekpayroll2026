import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Save, RefreshCw, CheckCircle2, AlertTriangle, ChevronDown, ChevronUp } from 'lucide-react'
import { employeeApi } from '../../services/api'
import { PageHeader, Button, Alert, Skeleton, Rupee } from '../../components/ui'
import clsx from 'clsx'

const STATES = [
  'Andhra Pradesh','Assam','Bihar','Chandigarh','Chhattisgarh','Delhi',
  'Goa','Gujarat','Haryana','Himachal Pradesh','Jharkhand','Karnataka',
  'Kerala','Madhya Pradesh','Maharashtra','Manipur','Meghalaya','Mizoram',
  'Nagaland','Odisha','Punjab','Rajasthan','Sikkim','Tamil Nadu','Telangana',
  'Tripura','Uttar Pradesh','Uttarakhand','West Bengal',
]

interface EmpRow {
  id:               string
  employeeCode:     string
  name:             string
  jobTitle:         string
  department:       string
  state:            string
  joiningDate:      string
  // salary
  annualCtc:        number
  hasIncentive:     boolean
  incentivePercent: number
  transportMonthly: number | null
  fbpMonthly:       number | null
  mediclaim:        number
  tdsMonthly:       number
  // computed (shown but not editable)
  basicMonthly?:    number
  hraMonthly?:      number
  grandTotal?:      number
  annualBonus?:     number
  employeePf?:      number
  netEstimate?:     number
  // state
  dirty:   boolean
  saving:  boolean
  saved:   boolean
  error:   string
}

function r2(n: number) { return Math.round(n * 100) / 100 }

function computeBreakdown(row: EmpRow) {
  if (!row.annualCtc || row.annualCtc <= 0) return null
  const ctc        = row.annualCtc
  const incentive  = row.hasIncentive ? r2(ctc * row.incentivePercent / 100) : 0
  const mediclaim  = row.mediclaim || 0
  const basicA     = r2(ctc * 0.45)
  const basicM     = r2(basicA / 12)
  // Employer PF = min(Basic × 12%, 1800/mo) — not hardcoded
  const emplPfM    = Math.min(r2(basicM * 0.12), 1800)
  const emplPf     = r2(emplPfM * 12)
  const hraA       = r2(ctc * 0.35)
  const hraM       = r2(hraA / 12)
  const transport  = row.transportMonthly ?? r2(basicM * 0.04)
  const fbp        = row.fbpMonthly       ?? r2(basicM * 0.04)
  const grandTotal = r2((ctc - incentive - emplPf - mediclaim) / 12)
  // Employee PF = min(Basic × 12%, 1800/mo) — same rule
  const empPf      = Math.min(r2(basicM * 0.12), 1800)
  const net        = r2(grandTotal - empPf)
  return { basicM, hraM, transport, fbp, grandTotal, incentive, empPf, net }
}

function fmt(n: number) {
  return new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(n)
}

export default function BulkEditEmployeesPage() {
  const qc = useQueryClient()
  const [rows, setRows]               = useState<EmpRow[]>([])
  const [showBreakdown, setShowBreakdown] = useState(false)
  const [savedCount, setSavedCount]   = useState(0)
  const [globalError, setGlobalError] = useState('')

  const { data: employees, isLoading } = useQuery({
    queryKey: ['employees-all'],
    queryFn:  () => employeeApi.list({ limit: 200 }).then(r => r.data.data),
  })

  useEffect(() => {
    if (!employees) return
    setRows(employees.map((e: any) => ({
      id:               e.id,
      employeeCode:     e.employeeCode,
      name:             e.name,
      jobTitle:         e.jobTitle || '',
      department:       e.department || '',
      state:            e.state || '',
      joiningDate:      e.joiningDate?.slice(0, 10) || '',
      annualCtc:        Number(e.annualCtc) || 0,
      hasIncentive:     Boolean(e.hasIncentive),
      incentivePercent: Number(e.incentivePercent) || 12,
      transportMonthly: e.transportMonthly != null ? Number(e.transportMonthly) : null,
      fbpMonthly:       e.fbpMonthly != null ? Number(e.fbpMonthly) : null,
      mediclaim:        Number(e.mediclaim) || 0,
      tdsMonthly:       Number(e.tdsMonthly) || 0,
      dirty: false, saving: false, saved: false, error: '',
    })))
  }, [employees])

  function updateRow(id: string, field: string, value: any) {
    setRows(prev => prev.map(r =>
      r.id === id ? { ...r, [field]: value, dirty: true, saved: false, error: '' } : r
    ))
  }

  async function saveRow(row: EmpRow) {
    setRows(prev => prev.map(r => r.id === row.id ? { ...r, saving: true, error: '' } : r))
    try {
      await employeeApi.update(row.id, {
        employeeCode:     row.employeeCode,
        jobTitle:         row.jobTitle,
        department:       row.department,
        state:            row.state,
        joiningDate:      row.joiningDate ? new Date(row.joiningDate).toISOString() : undefined,
        annualCtc:        row.annualCtc,
        hasIncentive:     row.hasIncentive,
        incentivePercent: row.incentivePercent,
        transportMonthly: row.transportMonthly,
        fbpMonthly:       row.fbpMonthly,
        mediclaim:        row.mediclaim,
        tdsMonthly:       row.tdsMonthly,
        revisionReason:   'Bulk salary setup April 2026',
      })
      setRows(prev => prev.map(r =>
        r.id === row.id ? { ...r, saving: false, saved: true, dirty: false } : r
      ))
      setSavedCount(c => c + 1)
      qc.invalidateQueries({ queryKey: ['employees'] })
    } catch (err: any) {
      const msg = err?.response?.data?.error || err?.response?.data?.message || 'Save failed'
      setRows(prev => prev.map(r =>
        r.id === row.id ? { ...r, saving: false, error: msg } : r
      ))
    }
  }

  async function saveAll() {
    setGlobalError('')
    const dirty = rows.filter(r => r.dirty && !r.saving)
    for (const row of dirty) {
      await saveRow(row)
    }
  }

  const dirtyCount = rows.filter(r => r.dirty).length
  const noCtcCount = rows.filter(r => !r.annualCtc || r.annualCtc <= 0).length

  if (isLoading) return (
    <div className="space-y-4">
      <Skeleton className="h-10 w-64" />
      <Skeleton className="h-96 rounded-xl" />
    </div>
  )

  return (
    <div className="space-y-4">
      <PageHeader
        title="Bulk Edit Employees"
        subtitle={`${rows.length} employees · ${noCtcCount} missing CTC · ${dirtyCount} unsaved changes`}
        actions={
          <div className="flex items-center gap-3">
            <Button
              variant="secondary"
              icon={showBreakdown ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              onClick={() => setShowBreakdown(!showBreakdown)}
            >
              {showBreakdown ? 'Hide' : 'Show'} Breakdown
            </Button>
            <Button
              icon={<Save size={14} />}
              disabled={dirtyCount === 0}
              onClick={saveAll}
            >
              Save All Changes ({dirtyCount})
            </Button>
          </div>
        }
      />

      {globalError && <Alert type="error" message={globalError} />}

      {noCtcCount > 0 && (
        <Alert
          type="warning"
          title={`${noCtcCount} employees have no CTC set`}
          message="Enter Annual CTC for each employee. The salary breakdown will calculate automatically."
        />
      )}

      {savedCount > 0 && (
        <Alert type="success" message={`${savedCount} employees saved successfully.`} />
      )}

      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
        <table className="w-full text-sm min-w-[1400px]">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50">
              <th className="text-left text-xs font-semibold text-slate-500 px-3 py-3 w-32">Emp Code</th>
              <th className="text-left text-xs font-semibold text-slate-500 px-3 py-3 w-44">Name</th>
              <th className="text-left text-xs font-semibold text-slate-500 px-3 py-3 w-36">Job Title</th>
              <th className="text-left text-xs font-semibold text-slate-500 px-3 py-3 w-32">Department</th>
              <th className="text-left text-xs font-semibold text-slate-500 px-3 py-3 w-36">State (PT)</th>
              <th className="text-left text-xs font-semibold text-slate-500 px-3 py-3 w-32">Joining Date</th>
              <th className="text-right text-xs font-semibold text-slate-500 px-3 py-3 w-36">Annual CTC ₹</th>
              <th className="text-center text-xs font-semibold text-slate-500 px-3 py-3 w-24">Incentive</th>
              <th className="text-right text-xs font-semibold text-slate-500 px-3 py-3 w-20">Inc %</th>
              {showBreakdown && <>
                <th className="text-right text-xs font-semibold text-blue-500 px-3 py-3 w-28">Basic/mo</th>
                <th className="text-right text-xs font-semibold text-blue-500 px-3 py-3 w-28">HRA/mo</th>
                <th className="text-right text-xs font-semibold text-blue-500 px-3 py-3 w-28">Grand Total/mo</th>
                <th className="text-right text-xs font-semibold text-amber-500 px-3 py-3 w-28">Annual Bonus</th>
                <th className="text-right text-xs font-semibold text-red-500 px-3 py-3 w-24">Emp PF</th>
                <th className="text-right text-xs font-semibold text-emerald-600 px-3 py-3 w-28">Net/mo</th>
              </>}
              <th className="text-right text-xs font-semibold text-slate-500 px-3 py-3 w-24">TDS/mo</th>
              <th className="px-3 py-3 w-24"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map(row => {
              const bd = computeBreakdown(row)
              return (
                <tr
                  key={row.id}
                  className={clsx(
                    'border-b border-slate-50 transition-colors',
                    row.dirty   && 'bg-amber-50/40',
                    row.saved   && 'bg-emerald-50/40',
                    row.error   && 'bg-red-50/40',
                    !row.annualCtc && 'bg-slate-50/60',
                  )}
                >
                  {/* Emp Code — editable for ID migration */}
                  <td className="px-2 py-1">
                    <input
                      className="input text-xs w-full font-mono"
                      value={row.employeeCode}
                      onChange={e => updateRow(row.id, 'employeeCode', e.target.value)}
                      placeholder="e.g. C#TEK186"
                    />
                  </td>

                  {/* Name — read only */}
                  <td className="px-3 py-2 font-medium text-slate-800 text-xs">{row.name}</td>

                  {/* Job Title */}
                  <td className="px-2 py-1">
                    <input className="input text-xs w-full" value={row.jobTitle}
                      onChange={e => updateRow(row.id, 'jobTitle', e.target.value)}
                      placeholder="e.g. Developer" />
                  </td>

                  {/* Department */}
                  <td className="px-2 py-1">
                    <input className="input text-xs w-full" value={row.department}
                      onChange={e => updateRow(row.id, 'department', e.target.value)}
                      placeholder="e.g. Engineering" />
                  </td>

                  {/* State */}
                  <td className="px-2 py-1">
                    <select className="input text-xs w-full" value={row.state}
                      onChange={e => updateRow(row.id, 'state', e.target.value)}>
                      <option value="">Select…</option>
                      {STATES.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </td>

                  {/* Joining Date */}
                  <td className="px-2 py-1">
                    <input type="date" className="input text-xs w-full" value={row.joiningDate}
                      onChange={e => updateRow(row.id, 'joiningDate', e.target.value)} />
                  </td>

                  {/* Annual CTC */}
                  <td className="px-2 py-1">
                    <input
                      type="number"
                      className={clsx('input text-xs w-full text-right', !row.annualCtc && 'border-amber-300 bg-amber-50')}
                      value={row.annualCtc || ''}
                      onChange={e => updateRow(row.id, 'annualCtc', Number(e.target.value))}
                      placeholder="e.g. 700000"
                    />
                  </td>

                  {/* Incentive toggle */}
                  <td className="px-2 py-1 text-center">
                    <button
                      type="button"
                      onClick={() => updateRow(row.id, 'hasIncentive', !row.hasIncentive)}
                      className={clsx(
                        'w-9 h-5 rounded-full transition-colors relative',
                        row.hasIncentive ? 'bg-brand-600' : 'bg-slate-200'
                      )}
                    >
                      <span className={clsx(
                        'absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform',
                        row.hasIncentive ? 'translate-x-4' : 'translate-x-0.5'
                      )} />
                    </button>
                  </td>

                  {/* Incentive % */}
                  <td className="px-2 py-1">
                    <input
                      type="number"
                      className={clsx('input text-xs w-16 text-right', !row.hasIncentive && 'opacity-30')}
                      value={row.incentivePercent}
                      disabled={!row.hasIncentive}
                      onChange={e => updateRow(row.id, 'incentivePercent', Number(e.target.value))}
                      min={1} max={50}
                    />
                  </td>

                  {/* Breakdown columns (optional) */}
                  {showBreakdown && <>
                    <td className="px-3 py-2 text-right text-xs font-mono text-blue-700">
                      {bd ? fmt(bd.basicM) : '—'}
                    </td>
                    <td className="px-3 py-2 text-right text-xs font-mono text-blue-700">
                      {bd ? fmt(bd.hraM) : '—'}
                    </td>
                    <td className="px-3 py-2 text-right text-xs font-mono text-slate-700 font-semibold">
                      {bd ? fmt(bd.grandTotal) : '—'}
                    </td>
                    <td className="px-3 py-2 text-right text-xs font-mono text-amber-600">
                      {bd && row.hasIncentive ? fmt(bd.incentive) : '—'}
                    </td>
                    <td className="px-3 py-2 text-right text-xs font-mono text-red-500">
                      {bd ? fmt(bd.empPf) : '—'}
                    </td>
                    <td className="px-3 py-2 text-right text-xs font-mono text-emerald-700 font-semibold">
                      {bd ? fmt(bd.net) : '—'}
                    </td>
                  </>}

                  {/* TDS monthly */}
                  <td className="px-2 py-1">
                    <input type="number" className="input text-xs w-20 text-right"
                      value={row.tdsMonthly || ''}
                      onChange={e => updateRow(row.id, 'tdsMonthly', Number(e.target.value))}
                      placeholder="0" />
                  </td>

                  {/* Save button */}
                  <td className="px-2 py-1 text-right">
                    {row.error ? (
                      <span title={row.error}>
                        <AlertTriangle size={14} className="text-red-500 inline" />
                      </span>
                    ) : row.saving ? (
                      <RefreshCw size={13} className="animate-spin text-slate-400 inline" />
                    ) : row.saved && !row.dirty ? (
                      <CheckCircle2 size={14} className="text-emerald-500 inline" />
                    ) : row.dirty ? (
                      <button
                        onClick={() => saveRow(row)}
                        className="text-xs font-medium text-brand-600 hover:text-brand-800 underline underline-offset-2"
                      >
                        Save
                      </button>
                    ) : null}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Footer summary */}
      {showBreakdown && rows.some(r => r.annualCtc > 0) && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            {
              label: 'Total Monthly Gross',
              value: rows.reduce((s, r) => s + (computeBreakdown(r)?.grandTotal || 0), 0),
              color: 'text-slate-800',
            },
            {
              label: 'Total Annual Bonus',
              value: rows.reduce((s, r) => {
                const bd = computeBreakdown(r)
                return s + (r.hasIncentive && bd ? bd.incentive : 0)
              }, 0),
              color: 'text-amber-700',
            },
            {
              label: 'Total Employee PF/mo',
              value: rows.reduce((s, r) => s + (computeBreakdown(r)?.empPf || 0), 0),
              color: 'text-red-600',
            },
            {
              label: 'Total Net Payable/mo',
              value: rows.reduce((s, r) => s + (computeBreakdown(r)?.net || 0), 0),
              color: 'text-emerald-700',
            },
          ].map(({ label, value, color }) => (
            <div key={label} className="bg-white rounded-xl border border-slate-200 p-4">
              <p className="text-xs text-slate-500 mb-1">{label}</p>
              <p className={clsx('text-lg font-bold font-mono', color)}>₹{fmt(value)}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
