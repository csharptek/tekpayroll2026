import { useState, useEffect, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Save, CheckCircle2, AlertTriangle, Eye, EyeOff } from 'lucide-react'
import { employeeApi } from '../../services/api'
import { PageHeader, Button, Alert } from '../../components/ui'
import clsx from 'clsx'

// ─── SALARY CALCULATOR ───────────────────────────────────────────────────────

function calcSalary(ctc: number, hasIncentive: boolean, incentivePct: number,
  transport: number | null, fbp: number | null, mediclaim: number) {
  if (!ctc || ctc <= 0) return null
  const EMPLOYER_PF  = 21600
  const basicMonthly = (ctc * 0.45) / 12
  const hraMonthly   = (ctc * 0.35) / 12
  const annualBonus  = hasIncentive ? ctc * incentivePct / 100 : 0
  const grandTotalM  = (ctc - annualBonus - EMPLOYER_PF - mediclaim) / 12
  const transportM   = transport != null ? transport : basicMonthly * 0.04
  const fbpM         = fbp       != null ? fbp       : basicMonthly * 0.04
  const hyiMonthly   = grandTotalM - basicMonthly - hraMonthly - transportM - fbpM
  const empPf        = Math.min(basicMonthly * 0.12, 1800)
  return {
    basicMonthly:  Math.round(basicMonthly),
    hraMonthly:    Math.round(hraMonthly),
    transportM:    Math.round(transportM),
    fbpM:          Math.round(fbpM),
    hyiMonthly:    Math.round(hyiMonthly),
    grandTotalM:   Math.round(grandTotalM),
    annualBonus:   Math.round(annualBonus),
    empPf:         Math.round(empPf),
    netMonthly:    Math.round(grandTotalM - empPf),
  }
}

function ri(n: number) {
  return '₹' + new Intl.NumberFormat('en-IN').format(n)
}

// ─── TYPES ────────────────────────────────────────────────────────────────────

interface Row {
  id: string; name: string; employeeCode: string
  jobTitle: string; department: string; state: string; joiningDate: string
  annualCtc: number; hasIncentive: boolean; incentivePercent: number
  transportMonthly: number | null; fbpMonthly: number | null
  mediclaim: number; tdsMonthly: number
  dirty: boolean; saved: boolean; error: string
}

// ─── INPUT COMPONENTS ─────────────────────────────────────────────────────────

const cls = 'w-full px-2 py-1.5 text-sm border border-slate-200 rounded-lg focus:border-brand-400 focus:outline-none bg-white'

function NInput({ value, onChange, highlight, placeholder }: {
  value: number | null; onChange: (v: number | null) => void
  highlight?: boolean; placeholder?: string
}) {
  return (
    <input type="number" placeholder={placeholder ?? ''}
      value={value ?? ''}
      onChange={e => onChange(e.target.value === '' ? null : Number(e.target.value))}
      className={clsx(cls, 'text-right', highlight && 'border-amber-300 bg-amber-50/50')}
    />
  )
}

const STATES = [
  'Andhra Pradesh','Assam','Bihar','Chandigarh','Chhattisgarh','Delhi',
  'Goa','Gujarat','Haryana','Himachal Pradesh','Jharkhand','Karnataka',
  'Kerala','Madhya Pradesh','Maharashtra','Manipur','Meghalaya','Mizoram',
  'Nagaland','Odisha','Punjab','Rajasthan','Sikkim','Tamil Nadu','Telangana',
  'Tripura','Uttar Pradesh','Uttarakhand','West Bengal',
]

// ─── MAIN PAGE ────────────────────────────────────────────────────────────────

export default function BulkEditEmployeePage() {
  const qc = useQueryClient()
  const [rows, setRows]             = useState<Row[]>([])
  const [showBreakdown, setShowBreakdown] = useState(false)
  const [saving, setSaving]         = useState(false)
  const [saveResult, setSaveResult] = useState<{ saved: number; errors: number } | null>(null)
  const initialised = useRef(false)  // KEY: only populate rows once, never overwrite edits

  const { data: employees, isLoading } = useQuery({
    queryKey: ['employees-bulk'],
    queryFn: () => employeeApi.list({ limit: '500' }).then(r => r.data.data),
    staleTime: Infinity,          // never auto-refetch
    refetchOnWindowFocus: false,  // don't refetch on tab focus
    refetchOnMount: true,         // only fetch once on mount
  })

  // Populate rows ONCE — never overwrite after edits begin
  useEffect(() => {
    if (!employees || initialised.current) return
    initialised.current = true
    setRows(employees.map((e: any): Row => ({
      id:               e.id,
      name:             e.name,
      employeeCode:     e.employeeCode,
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
      dirty: false, saved: false, error: '',
    })))
  }, [employees])

  function upd(id: string, field: string, value: any) {
    setRows(prev => prev.map(r =>
      r.id === id ? { ...r, [field]: value, dirty: true, saved: false, error: '' } : r
    ))
  }

  async function saveAll() {
    const dirty = rows.filter(r => r.dirty)
    if (!dirty.length) return
    setSaving(true); setSaveResult(null)
    let saved = 0, errors = 0

    for (const row of dirty) {
      try {
        await employeeApi.update(row.id, {
          annualCtc:        row.annualCtc,
          hasIncentive:     row.hasIncentive,
          incentivePercent: row.incentivePercent,
          transportMonthly: row.transportMonthly,
          fbpMonthly:       row.fbpMonthly,
          mediclaim:        row.mediclaim,
          tdsMonthly:       row.tdsMonthly,
          jobTitle:         row.jobTitle,
          department:       row.department,
          state:            row.state,
          joiningDate:      row.joiningDate ? new Date(row.joiningDate).toISOString() : undefined,
          revisionReason:   'Bulk salary onboarding — April 2026',
        })
        setRows(prev => prev.map(r => r.id === row.id ? { ...r, dirty: false, saved: true } : r))
        saved++
      } catch (err: any) {
        const msg = err?.response?.data?.error || err?.response?.data?.message || 'Error'
        setRows(prev => prev.map(r => r.id === row.id ? { ...r, error: msg } : r))
        errors++
      }
    }

    setSaving(false)
    setSaveResult({ saved, errors })
    qc.invalidateQueries({ queryKey: ['employees'] })
  }

  const dirtyCount = rows.filter(r => r.dirty).length
  const noCtcCount = rows.filter(r => !r.annualCtc || r.annualCtc === 0).length

  if (isLoading) return (
    <div className="flex items-center justify-center h-64 text-sm text-slate-400">
      Loading employees...
    </div>
  )

  return (
    <div className="space-y-4">
      <PageHeader
        title="Bulk Edit Salaries"
        subtitle={`${rows.length} employees · ${noCtcCount > 0 ? `${noCtcCount} missing CTC · ` : ''}${dirtyCount} unsaved changes`}
        actions={
          <div className="flex items-center gap-3">
            <Button variant="secondary"
              icon={showBreakdown ? <EyeOff size={14}/> : <Eye size={14}/>}
              onClick={() => setShowBreakdown(s => !s)}>
              {showBreakdown ? 'Hide' : 'Show'} Breakdown
            </Button>
            <Button icon={<Save size={14}/>} loading={saving}
              disabled={dirtyCount === 0} onClick={saveAll}>
              Save {dirtyCount > 0 ? `${dirtyCount} Changes` : 'Changes'}
            </Button>
          </div>
        }
      />

      {saveResult && (
        <Alert type={saveResult.errors > 0 ? 'warning' : 'success'}
          message={`${saveResult.saved} saved${saveResult.errors > 0 ? `, ${saveResult.errors} failed` : ' successfully'}`}
        />
      )}

      {noCtcCount > 0 && (
        <Alert type="warning" title={`${noCtcCount} employees have no CTC set`}
          message="Enter Annual CTC — breakdown calculates instantly. Leave Transport/FBP blank for auto (4% of Basic)." />
      )}

      <div className="flex gap-4 text-xs text-slate-400 px-1">
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-amber-400 inline-block"/>Unsaved</span>
        <span className="flex items-center gap-1.5"><CheckCircle2 size={11} className="text-emerald-500"/>Saved</span>
        <span className="flex items-center gap-1.5"><AlertTriangle size={11} className="text-red-400"/>Error</span>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b-2 border-slate-200 text-left">
                <th className="px-3 py-2.5 text-xs font-semibold text-slate-500 w-8">#</th>
                <th className="px-3 py-2.5 text-xs font-semibold text-slate-700 min-w-44">Employee</th>
                <th className="px-3 py-2.5 text-xs font-semibold text-slate-500 min-w-36">Job Title</th>
                <th className="px-3 py-2.5 text-xs font-semibold text-slate-500 min-w-36">Department</th>
                <th className="px-3 py-2.5 text-xs font-semibold text-slate-500 min-w-36">State (PT)</th>
                <th className="px-3 py-2.5 text-xs font-semibold text-slate-500 min-w-32">Joining Date</th>
                <th className="px-3 py-2.5 text-xs font-semibold text-slate-900 min-w-36 border-l-2 border-slate-300 bg-slate-100">Annual CTC ₹ *</th>
                <th className="px-3 py-2.5 text-xs font-semibold text-slate-500 w-24 text-center">Incentive</th>
                <th className="px-3 py-2.5 text-xs font-semibold text-slate-500 w-20 text-center">%</th>
                <th className="px-3 py-2.5 text-xs font-semibold text-slate-500 w-28">Transport/mo</th>
                <th className="px-3 py-2.5 text-xs font-semibold text-slate-500 w-24">FBP/mo</th>
                <th className="px-3 py-2.5 text-xs font-semibold text-slate-500 w-24">TDS/mo</th>
                {showBreakdown && <>
                  <th className="px-3 py-2.5 text-xs font-semibold text-blue-600 bg-blue-50 min-w-24 border-l-2 border-blue-200">Basic/mo</th>
                  <th className="px-3 py-2.5 text-xs font-semibold text-blue-600 bg-blue-50 min-w-24">HRA/mo</th>
                  <th className="px-3 py-2.5 text-xs font-semibold text-blue-600 bg-blue-50 min-w-20">HYI/mo</th>
                  <th className="px-3 py-2.5 text-xs font-semibold text-blue-600 bg-blue-50 min-w-28">Gross/mo</th>
                  <th className="px-3 py-2.5 text-xs font-semibold text-amber-600 bg-amber-50 min-w-24">Bonus/yr</th>
                  <th className="px-3 py-2.5 text-xs font-semibold text-emerald-600 bg-emerald-50 min-w-28">Net/mo</th>
                </>}
                <th className="px-3 py-2.5 text-xs font-semibold text-slate-400 w-10 text-center">✓</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, idx) => {
                const calc = calcSalary(row.annualCtc, row.hasIncentive,
                  row.incentivePercent, row.transportMonthly, row.fbpMonthly, row.mediclaim)

                return (
                  <tr key={row.id} className={clsx(
                    'border-b border-slate-100 transition-colors',
                    row.error ? 'bg-red-50/60' :
                    row.saved ? 'bg-emerald-50/40' :
                    row.dirty ? 'bg-amber-50/30' :
                    'hover:bg-slate-50/40'
                  )}>
                    <td className="px-3 py-2 text-xs text-slate-400">{idx + 1}</td>

                    {/* Employee */}
                    <td className="px-3 py-2">
                      <div className="font-medium text-slate-800 text-xs leading-snug">{row.name}</div>
                      <div className="text-xs text-slate-400 font-mono">{row.employeeCode}</div>
                    </td>

                    {/* Job Title */}
                    <td className="px-2 py-1.5">
                      <input type="text" value={row.jobTitle} placeholder="e.g. Developer"
                        onChange={e => upd(row.id, 'jobTitle', e.target.value)}
                        className={cls}/>
                    </td>

                    {/* Department */}
                    <td className="px-2 py-1.5">
                      <input type="text" value={row.department} placeholder="e.g. Engineering"
                        onChange={e => upd(row.id, 'department', e.target.value)}
                        className={cls}/>
                    </td>

                    {/* State */}
                    <td className="px-2 py-1.5">
                      <select value={row.state}
                        onChange={e => upd(row.id, 'state', e.target.value)}
                        className={cls}>
                        <option value="">Select…</option>
                        {STATES.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </td>

                    {/* Joining Date — text input dd-mm-yyyy, no native calendar */}
                    <td className="px-2 py-1.5">
                      <input
                        type="text"
                        placeholder="DD-MM-YYYY"
                        defaultValue={row.joiningDate
                          ? row.joiningDate.split('-').reverse().join('-')
                          : ''}
                        onBlur={e => {
                          const val = e.target.value.trim()
                          const parts = val.split('-')
                          if (parts.length === 3 && parts[2].length === 4) {
                            upd(row.id, 'joiningDate', `${parts[2]}-${parts[1].padStart(2,'0')}-${parts[0].padStart(2,'0')}`)
                          }
                        }}
                        className={cls}
                      />
                    </td>

                    {/* Annual CTC — most important column */}
                    <td className="px-2 py-1.5 border-l-2 border-slate-300 bg-slate-50/50">
                      <NInput
                        value={row.annualCtc || null}
                        onChange={v => upd(row.id, 'annualCtc', v ?? 0)}
                        highlight={!row.annualCtc}
                        placeholder="700000"
                      />
                    </td>

                    {/* Incentive toggle */}
                    <td className="px-3 py-2 text-center">
                      <button type="button"
                        onClick={() => upd(row.id, 'hasIncentive', !row.hasIncentive)}
                        className={clsx(
                          'w-10 h-5 rounded-full transition-colors relative inline-flex flex-shrink-0',
                          row.hasIncentive ? 'bg-brand-600' : 'bg-slate-200'
                        )}>
                        <span className={clsx(
                          'absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform',
                          row.hasIncentive ? 'translate-x-5' : 'translate-x-0.5'
                        )}/>
                      </button>
                    </td>

                    {/* Incentive % */}
                    <td className="px-2 py-1.5">
                      {row.hasIncentive
                        ? <NInput value={row.incentivePercent}
                            onChange={v => upd(row.id, 'incentivePercent', v ?? 12)}/>
                        : <span className="block text-center text-slate-300 text-xs py-1">—</span>
                      }
                    </td>

                    {/* Transport */}
                    <td className="px-2 py-1.5">
                      <NInput value={row.transportMonthly}
                        onChange={v => upd(row.id, 'transportMonthly', v)}
                        placeholder="auto"/>
                    </td>

                    {/* FBP */}
                    <td className="px-2 py-1.5">
                      <NInput value={row.fbpMonthly}
                        onChange={v => upd(row.id, 'fbpMonthly', v)}
                        placeholder="auto"/>
                    </td>

                    {/* TDS */}
                    <td className="px-2 py-1.5">
                      <NInput value={row.tdsMonthly || null}
                        onChange={v => upd(row.id, 'tdsMonthly', v ?? 0)}
                        placeholder="0"/>
                    </td>

                    {/* Breakdown columns */}
                    {showBreakdown && <>
                      <td className="px-3 py-2 text-right text-xs font-mono bg-blue-50/40 text-slate-600 border-l-2 border-blue-200">
                        {calc ? ri(calc.basicMonthly) : '—'}
                      </td>
                      <td className="px-3 py-2 text-right text-xs font-mono bg-blue-50/40 text-slate-600">
                        {calc ? ri(calc.hraMonthly) : '—'}
                      </td>
                      <td className="px-3 py-2 text-right text-xs font-mono bg-blue-50/40 text-slate-600">
                        {calc ? ri(calc.hyiMonthly) : '—'}
                      </td>
                      <td className="px-3 py-2 text-right text-xs font-mono bg-blue-50/40 font-semibold text-slate-800">
                        {calc ? ri(calc.grandTotalM) : '—'}
                      </td>
                      <td className="px-3 py-2 text-right text-xs font-mono bg-amber-50/40 text-amber-600">
                        {calc && calc.annualBonus > 0 ? ri(calc.annualBonus) : '—'}
                      </td>
                      <td className="px-3 py-2 text-right text-xs font-mono bg-emerald-50/40 font-semibold text-emerald-700">
                        {calc ? ri(calc.netMonthly) : '—'}
                      </td>
                    </>}

                    {/* Status */}
                    <td className="px-3 py-2 text-center">
                      {row.error
                        ? <span title={row.error}><AlertTriangle size={13} className="text-red-500 mx-auto"/></span>
                        : row.saved
                        ? <CheckCircle2 size={13} className="text-emerald-500 mx-auto"/>
                        : row.dirty
                        ? <span className="w-2 h-2 rounded-full bg-amber-400 block mx-auto"/>
                        : <span className="w-2 h-2 rounded-full bg-slate-200 block mx-auto"/>
                      }
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        <div className="px-4 py-3 border-t border-slate-200 bg-slate-50 flex justify-between items-center">
          <p className="text-xs text-slate-400">
            Changes are saved row-by-row. Each update logs a salary revision dated April 2026.
          </p>
          <Button icon={<Save size={14}/>} loading={saving}
            disabled={dirtyCount === 0} onClick={saveAll}>
            Save {dirtyCount > 0 ? `${dirtyCount} Changes` : 'Changes'}
          </Button>
        </div>
      </div>
    </div>
  )
}
