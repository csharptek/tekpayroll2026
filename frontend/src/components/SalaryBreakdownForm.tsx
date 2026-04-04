import { useState, useEffect } from 'react'
import { useMutation } from '@tanstack/react-query'
import api from '../services/api'
import { Rupee, Alert, Skeleton } from './ui'
import clsx from 'clsx'

interface SalaryInput {
  annualCtc:        number
  basicPercent:     number
  hraPercent:       number
  transportMonthly: number | null
  fbpMonthly:       number | null
  mediclaim:        number
  hasIncentive:     boolean
  incentivePercent: number
}

interface SalaryFormProps {
  initialCtc?:        number
  initialValues?:     Partial<SalaryInput>
  onChange:           (values: SalaryInput) => void
  readOnly?:          boolean
}

export default function SalaryBreakdownForm({ initialCtc = 0, initialValues, onChange, readOnly = false }: SalaryFormProps) {
  const [ctc,             setCtc]             = useState(initialCtc || initialValues?.annualCtc || 0)
  const [basicPercent,    setBasicPercent]    = useState(initialValues?.basicPercent    ?? 45)
  const [hraPercent,      setHraPercent]      = useState(initialValues?.hraPercent      ?? 35)
  const [transportCustom, setTransportCustom] = useState<number | null>(initialValues?.transportMonthly ?? null)
  const [fbpCustom,       setFbpCustom]       = useState<number | null>(initialValues?.fbpMonthly       ?? null)
  const [mediclaim,       setMediclaim]       = useState(initialValues?.mediclaim       ?? 0)
  const [hasIncentive,    setHasIncentive]    = useState(initialValues?.hasIncentive    ?? false)
  const [incentivePct,    setIncentivePct]    = useState(initialValues?.incentivePercent ?? 12)
  const [preview,         setPreview]         = useState<any>(null)

  const previewMut = useMutation({
    mutationFn: (input: SalaryInput) =>
      api.post('/api/employees/salary-preview', input).then(r => r.data.data),
    onSuccess: data => setPreview(data),
  })

  function buildInput(): SalaryInput {
    return {
      annualCtc:        ctc,
      basicPercent,
      hraPercent,
      transportMonthly: transportCustom,
      fbpMonthly:       fbpCustom,
      mediclaim,
      hasIncentive,
      incentivePercent: incentivePct,
    }
  }

  useEffect(() => {
    if (ctc > 0) {
      const input = buildInput()
      previewMut.mutate(input)
      onChange(input)
    }
  }, [ctc, basicPercent, hraPercent, transportCustom, fbpCustom, mediclaim, hasIncentive, incentivePct])

  const inputClass = 'input text-sm'
  const labelClass = 'label text-xs'

  return (
    <div className="space-y-5">
      {/* CTC + Incentive */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className={labelClass}>Annual CTC (₹) *</label>
          <input
            type="number"
            value={ctc || ''}
            onChange={e => setCtc(Number(e.target.value))}
            className={inputClass}
            placeholder="e.g. 700000"
            disabled={readOnly}
          />
        </div>
        <div>
          <label className={labelClass}>Annual Incentive</label>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-2 cursor-pointer">
              <div
                onClick={() => !readOnly && setHasIncentive(!hasIncentive)}
                className={clsx(
                  'w-10 h-5 rounded-full transition-colors cursor-pointer relative',
                  hasIncentive ? 'bg-brand-600' : 'bg-slate-200'
                )}
              >
                <span className={clsx(
                  'absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform',
                  hasIncentive ? 'translate-x-5' : 'translate-x-0.5'
                )} />
              </div>
              <span className="text-sm text-slate-600">{hasIncentive ? 'Yes' : 'No'}</span>
            </label>
            {hasIncentive && (
              <div className="flex items-center gap-1 flex-1">
                <input
                  type="number"
                  value={incentivePct}
                  onChange={e => setIncentivePct(Number(e.target.value))}
                  className={clsx(inputClass, 'w-20')}
                  min={1} max={50}
                  disabled={readOnly}
                />
                <span className="text-sm text-slate-500">% of CTC</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Component percentages */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div>
          <label className={labelClass}>Basic % of CTC</label>
          <div className="flex items-center gap-1">
            <input type="number" value={basicPercent} onChange={e => setBasicPercent(Number(e.target.value))}
              className={clsx(inputClass, 'w-20')} min={1} max={80} disabled={readOnly} />
            <span className="text-sm text-slate-400">%</span>
          </div>
        </div>
        <div>
          <label className={labelClass}>HRA % of CTC</label>
          <div className="flex items-center gap-1">
            <input type="number" value={hraPercent} onChange={e => setHraPercent(Number(e.target.value))}
              className={clsx(inputClass, 'w-20')} min={1} max={50} disabled={readOnly} />
            <span className="text-sm text-slate-400">%</span>
          </div>
        </div>
        <div>
          <label className={labelClass}>Transport/mo (₹)</label>
          <input type="number"
            value={transportCustom ?? ''}
            onChange={e => setTransportCustom(e.target.value ? Number(e.target.value) : null)}
            className={inputClass}
            placeholder="Auto (4% Basic)"
            disabled={readOnly}
          />
        </div>
        <div>
          <label className={labelClass}>FBP/mo (₹)</label>
          <input type="number"
            value={fbpCustom ?? ''}
            onChange={e => setFbpCustom(e.target.value ? Number(e.target.value) : null)}
            className={inputClass}
            placeholder="Auto (4% Basic)"
            disabled={readOnly}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={labelClass}>Mediclaim (Annual ₹)</label>
          <input type="number" value={mediclaim || ''} onChange={e => setMediclaim(Number(e.target.value))}
            className={inputClass} placeholder="0" disabled={readOnly} />
        </div>
      </div>

      {/* Live breakdown */}
      {ctc > 0 && (
        <div className="bg-slate-50 border border-slate-200 rounded-2xl overflow-hidden">
          <div className="bg-slate-100 px-4 py-2.5 border-b border-slate-200">
            <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Salary Breakdown Preview</p>
          </div>

          {previewMut.isPending ? (
            <Skeleton className="h-48 m-4" />
          ) : preview ? (
            <div className="p-4 space-y-3">
              {/* Components table */}
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200">
                    <th className="text-left text-xs text-slate-500 pb-2 font-medium">Component</th>
                    <th className="text-right text-xs text-slate-500 pb-2 font-medium">Monthly</th>
                    <th className="text-right text-xs text-slate-500 pb-2 font-medium">Annual</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.components?.map((c: any) => (
                    <tr key={c.label} className="border-b border-slate-100">
                      <td className="py-1.5 text-slate-700">
                        {c.label}
                        {!c.editable && c.label === 'HYI' && (
                          <span className="ml-1 text-xs text-slate-400">(auto)</span>
                        )}
                      </td>
                      <td className="py-1.5 text-right font-mono text-slate-800">
                        <Rupee amount={c.monthly} />
                      </td>
                      <td className="py-1.5 text-right font-mono text-slate-600">
                        <Rupee amount={c.annual} />
                      </td>
                    </tr>
                  ))}
                  <tr className="border-b border-slate-200 font-semibold bg-slate-50/50">
                    <td className="py-2 text-slate-800">Grand Total (Gross)</td>
                    <td className="py-2 text-right font-mono text-brand-700">
                      <Rupee amount={preview.grossMonthly} />
                    </td>
                    <td className="py-2 text-right font-mono text-slate-600">
                      <Rupee amount={preview.grossMonthly * 12} />
                    </td>
                  </tr>
                  <tr className="border-b border-slate-100 text-slate-500">
                    <td className="py-1.5">Employer PF (in CTC)</td>
                    <td className="py-1.5 text-right font-mono">₹1,800</td>
                    <td className="py-1.5 text-right font-mono"><Rupee amount={preview.employerPf} /></td>
                  </tr>
                  {hasIncentive && (
                    <tr className="border-b border-slate-100 text-slate-500">
                      <td className="py-1.5">Annual/Joining Bonus ({incentivePct}%) — paid March</td>
                      <td className="py-1.5 text-right font-mono text-amber-600">
                        <Rupee amount={preview.annualBonus / 12} />
                      </td>
                      <td className="py-1.5 text-right font-mono text-amber-600">
                        <Rupee amount={preview.annualBonus} />
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>

              {/* Summary row */}
              <div className="grid grid-cols-3 gap-3 pt-1">
                <div className="bg-brand-50 rounded-xl p-3 text-center">
                  <p className="text-xs text-brand-500 mb-0.5">Total CTC</p>
                  <Rupee amount={preview.totalCtc} className="font-bold text-brand-800 text-base" />
                </div>
                <div className="bg-red-50 rounded-xl p-3 text-center">
                  <p className="text-xs text-red-500 mb-0.5">Employee PF (deduction)</p>
                  <Rupee amount={preview.employeePf} className="font-bold text-red-700 text-base" />
                </div>
                <div className="bg-emerald-50 rounded-xl p-3 text-center">
                  <p className="text-xs text-emerald-500 mb-0.5">Est. Net Take Home</p>
                  <Rupee amount={preview.netEstimate} className="font-bold text-emerald-800 text-base" />
                </div>
              </div>

              <p className="text-xs text-slate-400 text-center">
                PT, TDS, LOP deducted at time of payroll run
              </p>
            </div>
          ) : null}
        </div>
      )}
    </div>
  )
}
