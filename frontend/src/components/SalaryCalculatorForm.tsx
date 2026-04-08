import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import api from '../services/api'
import { RotateCcw, AlertTriangle, Info } from 'lucide-react'
import { Rupee } from './ui'

const r2 = (n: number) => Math.round(n * 100) / 100
const ri = (n: number) => Math.round(n)  // round to whole rupee
const TRANSPORT_DEFAULT = 0.02
const FBP_DEFAULT       = 0.02

export interface SalaryOutput {
  annualCtc:        number
  basicPercent:     number
  hraPercent:       number
  transportMonthly: number | null
  fbpMonthly:       number | null
  mediclaim:        number
  hasIncentive:     boolean
  incentivePercent: number
}

interface Components { basic: number; hra: number; transport: number; fbp: number; hyi: number }

const EMPLOYER_PF_CTC_CAP = 1800  // Cap on Employer PF deducted FROM CTC (govt limit)

function computeFromCtc(ctc: number, basicPct: number, hraPct: number, incentivePct: number, hasIncentive: boolean, mediclaim: number) {
  const annualBonus       = ri(ctc * incentivePct / 100)
  const basicMonthly      = ri(ctc * basicPct / 100 / 12)
  const employerPfInCtc   = Math.min(ri(basicMonthly * 0.12), EMPLOYER_PF_CTC_CAP)
  // Annual bonus IS deducted from CTC when computing monthly gross
  const grandTotal        = ri((ctc - (hasIncentive ? annualBonus : 0) - employerPfInCtc * 12 - mediclaim) / 12)
  const hraMonthly        = ri(ctc * hraPct / 100 / 12)
  const transport         = ri(grandTotal * TRANSPORT_DEFAULT)
  const fbp               = ri(grandTotal * FBP_DEFAULT)
  const hyi               = ri(grandTotal - basicMonthly - hraMonthly - transport - fbp)
  const employerPfActual  = ri(basicMonthly * 0.12)
  return { basic: basicMonthly, hra: hraMonthly, transport, fbp, hyi, grandTotal, employerPfInCtc, employerPfActual, annualBonus }
}

interface Props {
  onChange: (val: SalaryOutput) => void
  initialValues?: Partial<SalaryOutput>
  showInstructions?: boolean
}

export default function SalaryCalculatorForm({ onChange, initialValues, showInstructions = true }: Props) {
  const [ctc,          setCtc]          = useState(initialValues?.annualCtc        ?? 0)
  const [basicPct,     setBasicPct]     = useState(initialValues?.basicPercent      ?? 45)
  const [hraPct,       setHraPct]       = useState(initialValues?.hraPercent        ?? 35)
  const [hasIncentive, setHasIncentive] = useState(initialValues?.hasIncentive      ?? false)
  const [incentivePct, setIncentivePct] = useState(initialValues?.incentivePercent  ?? 12)
  const [mediclaim,    setMediclaim]    = useState(initialValues?.mediclaim          ?? 0)

  const [components,  setComponents]  = useState<Components>(() => {
    if ((initialValues?.annualCtc ?? 0) > 0) {
      const iv = initialValues!
      const c  = computeFromCtc(iv.annualCtc!, iv.basicPercent ?? 45, iv.hraPercent ?? 35, iv.incentivePercent ?? 12, iv.hasIncentive ?? false, iv.mediclaim ?? 0)
      const t  = iv.transportMonthly != null ? Math.round(iv.transportMonthly) : c.transport
      const f  = iv.fbpMonthly       != null ? Math.round(iv.fbpMonthly)       : c.fbp
      return { basic: c.basic, hra: c.hra, transport: t, fbp: f, hyi: ri(c.grandTotal - c.basic - c.hra - t - f) }
    }
    return { basic: 0, hra: 0, transport: 0, fbp: 0, hyi: 0 }
  })
  const [overrides,   setOverrides]   = useState({ basic: false, hra: false, transport: false, fbp: false, hyi: false })
  const [grandTotal,  setGrandTotal]  = useState(() => {
    if ((initialValues?.annualCtc ?? 0) > 0) {
      const iv = initialValues!
      return computeFromCtc(iv.annualCtc!, iv.basicPercent ?? 45, iv.hraPercent ?? 35, iv.incentivePercent ?? 12, iv.hasIncentive ?? false, iv.mediclaim ?? 0).grandTotal
    }
    return 0
  })
  const [initialized, setInitialized] = useState((initialValues?.annualCtc ?? 0) > 0)

  // Fetch ESI config from backend
  const { data: sysConfig } = useQuery({
    queryKey: ['system-config'],
    queryFn: () => api.get('/api/config').then(r => r.data.data),
  })
  const esiEmployeeRate = Number(sysConfig?.ESI_EMPLOYEE_RATE ?? 0.0075)
  const esiEmployerRate = Number(sysConfig?.ESI_EMPLOYER_RATE ?? 0.0325)
  const esiThreshold    = Number(sysConfig?.ESI_THRESHOLD     ?? 21000)

  const employerPfInCtc  = Math.min(ri(components.basic * 0.12), 1800)
  const employerPf       = employerPfInCtc
  const employeePf       = Math.min(ri(components.basic * 0.12), 1800)
  const annualBonus   = hasIncentive ? r2(ctc * incentivePct / 100) : 0
  const allocated     = r2(components.basic + components.hra + components.transport + components.fbp + components.hyi)
  const remainder     = r2(grandTotal - allocated)
  const isOver        = remainder < -1
  const esiBase       = ri(grandTotal - components.hyi)
  const esiApplies    = initialized && esiBase > 0 && esiBase <= esiThreshold
  const employeeEsi   = esiApplies ? ri(esiBase * esiEmployeeRate) : 0
  const employerEsi   = esiApplies ? ri(esiBase * esiEmployerRate) : 0
  const totalCtcCheck = ctc
  const netEstimate   = r2(grandTotal - employeePf - employeeEsi)

  function emitChange(comps: Components, gt: number) {
    onChange({
      annualCtc:        ctc,
      basicPercent:     basicPct,
      hraPercent:       hraPct,
      transportMonthly: null,
      fbpMonthly:       null,
      mediclaim,
      hasIncentive,
      incentivePercent: incentivePct,
    })
  }

  function applyCtc() {
    if (ctc <= 0) return
    const c = computeFromCtc(ctc, basicPct, hraPct, incentivePct, hasIncentive, mediclaim)
    const newComps = { basic: c.basic, hra: c.hra, transport: c.transport, fbp: c.fbp, hyi: c.hyi }
    setComponents(newComps)
    setOverrides({ basic: false, hra: false, transport: false, fbp: false, hyi: false })
    setGrandTotal(c.grandTotal)
    setInitialized(true)
    emitChange(newComps, c.grandTotal)
  }

  function reset() {
    setComponents({ basic: 0, hra: 0, transport: 0, fbp: 0, hyi: 0 })
    setOverrides({ basic: false, hra: false, transport: false, fbp: false, hyi: false })
    setGrandTotal(0); setCtc(0); setInitialized(false)
  }

  const rows: { label: string; key: keyof Components }[] = [
    { label: 'Basic',          key: 'basic' },
    { label: 'HRA',            key: 'hra' },
    { label: 'Transportation', key: 'transport' },
    { label: 'FBP',            key: 'fbp' },
    { label: 'HYI',            key: 'hyi' },
  ]

  return (
    <div className="space-y-5">

      {showInstructions && (
        <div className="bg-blue-50 border border-blue-100 rounded-2xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <Info size={14} className="text-blue-500 flex-shrink-0"/>
            <p className="text-xs font-semibold text-blue-700 uppercase tracking-wide">How salary is calculated</p>
          </div>
          <ul className="space-y-1 text-xs text-blue-700 leading-relaxed">
            <li>• Basic = CTC × Basic%, HRA = CTC × HRA%</li>
            <li>• Grand Monthly = (CTC − Bonus − Employer PF − Mediclaim) ÷ 12</li>
            <li>• Transport &amp; FBP = 2% of Grand Monthly each</li>
            <li>• HYI = Grand Monthly − Basic − HRA − Transport − FBP</li>
            <li>• Employee PF = min(Basic × 12%, ₹1,800/mo)</li>
          </ul>
        </div>
      )}

      {/* Config inputs */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div>
          <label className="label text-xs">Annual CTC (₹) *</label>
          <input type="number" className="input text-sm" value={ctc || ''} onChange={e => setCtc(Number(e.target.value))} placeholder="e.g. 700000"/>
        </div>
        <div>
          <label className="label text-xs">Basic % of CTC</label>
          <div className="flex items-center gap-1">
            <input type="number" className="input text-sm w-20" value={basicPct} onChange={e => setBasicPct(Number(e.target.value))} min={1} max={80}/>
            <span className="text-sm text-slate-400">%</span>
          </div>
        </div>
        <div>
          <label className="label text-xs">HRA % of CTC</label>
          <div className="flex items-center gap-1">
            <input type="number" className="input text-sm w-20" value={hraPct} onChange={e => setHraPct(Number(e.target.value))} min={1} max={50}/>
            <span className="text-sm text-slate-400">%</span>
          </div>
        </div>
        <div>
          <label className="label text-xs">Mediclaim (Annual ₹)</label>
          <input type="number" className="input text-sm" value={mediclaim || ''} onChange={e => setMediclaim(Number(e.target.value))} placeholder="0"/>
        </div>
        <div className="flex items-end gap-3">
          <div>
            <label className="label text-xs">Annual Incentive</label>
            <div onClick={() => setHasIncentive(p => !p)}
              className={`w-10 h-5 rounded-full transition-colors cursor-pointer relative ${hasIncentive ? 'bg-brand-600' : 'bg-slate-200'}`}>
              <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${hasIncentive ? 'translate-x-5' : 'translate-x-0.5'}`}/>
            </div>
          </div>
          {hasIncentive && (
            <div>
              <label className="label text-xs">Incentive %</label>
              <div className="flex items-center gap-1">
                <input type="number" className="input text-sm w-20" value={incentivePct} onChange={e => setIncentivePct(Number(e.target.value))} min={1} max={50}/>
                <span className="text-sm text-slate-400">%</span>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="flex gap-3">
        <button type="button" onClick={applyCtc} disabled={ctc <= 0}
          className="btn btn-primary text-sm px-5 py-2 disabled:opacity-50 disabled:cursor-not-allowed">
          Generate Breakup
        </button>
        {initialized && (
          <button type="button" onClick={reset} className="flex items-center gap-2 text-sm text-slate-500 hover:text-slate-700 px-3 py-2 rounded-lg hover:bg-slate-100 transition-colors">
            <RotateCcw size={14}/> Reset
          </button>
        )}
      </div>

      {/* Breakdown table */}
      {initialized && (
        <div className="bg-slate-50 border border-slate-200 rounded-2xl overflow-hidden">
          <div className="bg-slate-100 px-4 py-2.5 border-b border-slate-200 flex items-center justify-between">
            <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Salary Breakup — Edit any component</p>
            {isOver && (
              <span className="flex items-center gap-1 text-xs text-red-600 font-medium">
                <AlertTriangle size={12}/> Over-allocated
              </span>
            )}
          </div>
          <div className="p-4 space-y-3">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200">
                  <th className="text-left text-xs text-slate-500 pb-2 font-medium w-1/3">Component</th>
                  <th className="text-right text-xs text-slate-500 pb-2 font-medium">Monthly</th>
                  <th className="text-right text-xs text-slate-500 pb-2 font-medium">Annual</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ label, key }) => (
                  <tr key={key} className="border-b border-slate-100">
                    <td className="py-1.5 text-slate-700 font-medium text-sm">
                      {label}
                      {key === 'hyi' && <span className="ml-2 text-[10px] text-slate-400">balancer</span>}
                      {(key === 'transport' || key === 'fbp') && <span className="ml-2 text-[10px] text-slate-400">auto</span>}
                    </td>
                    <td className="py-1.5 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <span className="text-slate-400 text-xs">₹</span>
                        <span className="w-24 text-right px-2 py-1 text-sm font-mono text-slate-700">
                          {components[key].toLocaleString('en-IN')}
                        </span>
                      </div>
                    </td>
                    <td className="py-1.5 text-right font-mono text-slate-500 text-sm">
                      <Rupee amount={ri(components[key] * 12)}/>
                    </td>
                  </tr>
                ))}
                <tr className="font-semibold">
                  <td className="py-2 text-slate-800">Gross Monthly</td>
                  <td className="py-2 text-right font-mono text-brand-700"><Rupee amount={grandTotal}/></td>
                  <td className="py-2 text-right font-mono text-slate-600"><Rupee amount={r2(grandTotal * 12)}/></td>

                </tr>
                <tr className="text-slate-500 text-xs">
                  <td className="py-1.5">Employer PF (in CTC)</td>
                  <td className="py-1.5 text-right font-mono"><Rupee amount={employerPf}/></td>
                  <td className="py-1.5 text-right font-mono"><Rupee amount={r2(employerPf * 12)}/></td>

                </tr>
                {mediclaim > 0 && (
                  <tr className="text-slate-500 text-xs">
                    <td className="py-1.5">Mediclaim</td>
                    <td className="py-1.5 text-right font-mono"><Rupee amount={r2(mediclaim / 12)}/></td>
                    <td className="py-1.5 text-right font-mono"><Rupee amount={mediclaim}/></td>
                    <td/>
                  </tr>
                )}
                {/* Employer ESI — outside CTC, informational */}
                {esiApplies && (
                  <tr className="text-slate-500 text-xs">
                    <td className="py-1.5">
                      Employer ESI ({(esiEmployerRate * 100).toFixed(2)}%)
                      <span className="ml-1 text-[10px] text-amber-500 font-medium">outside CTC</span>
                    </td>
                    <td className="py-1.5 text-right font-mono"><Rupee amount={employerEsi}/></td>
                    <td className="py-1.5 text-right font-mono"><Rupee amount={r2(employerEsi * 12)}/></td>
                    <td/>
                  </tr>
                )}
                {hasIncentive && (
                  <tr className="text-amber-600 text-xs">
                    <td className="py-1.5">Annual Bonus ({incentivePct}%) — paid March</td>
                    <td className="py-1.5 text-right font-mono"><Rupee amount={r2(annualBonus / 12)}/></td>
                    <td className="py-1.5 text-right font-mono"><Rupee amount={annualBonus}/></td>
                    <td/>
                  </tr>
                )}
              </tbody>
            </table>

            {isOver && (
              <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-3 py-2 text-xs text-red-700">
                <AlertTriangle size={13}/>
                Components exceed gross by ₹{Math.abs(remainder).toLocaleString('en-IN')}. Reduce one or more components.
              </div>
            )}

            {/* Deductions */}
            <div className="bg-red-50/50 border border-red-100 rounded-xl p-3">
              <p className="text-xs font-semibold text-red-600 uppercase tracking-wide mb-2">Employee Deductions</p>
              <div className="space-y-1 text-xs text-slate-600">
                <div className="flex justify-between">
                  <span>Employee PF (12% of Basic)</span>
                  <span className="font-mono font-semibold"><Rupee amount={employeePf}/>/mo</span>
                </div>
                {esiApplies ? (
                  <div className="flex justify-between">
                    <span>Employee ESI ({(esiEmployeeRate * 100).toFixed(2)}% of Gross - HYI = <Rupee amount={esiBase}/>)</span>
                    <span className="font-mono font-semibold"><Rupee amount={employeeEsi}/>/mo</span>
                  </div>
                ) : initialized && (
                  <div className="flex justify-between text-slate-400">
                    <span>Employee ESI — not applicable (ESI base &gt; ₹{esiThreshold.toLocaleString('en-IN')})</span>
                    <span>₹0</span>
                  </div>
                )}
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3 pt-1">
              <div className="bg-brand-50 rounded-xl p-3 text-center">
                <p className="text-xs text-brand-500 mb-0.5">Total CTC</p>
                <Rupee amount={totalCtcCheck} className="font-bold text-brand-800 text-sm"/>
              </div>
              <div className="bg-red-50 rounded-xl p-3 text-center">
                <p className="text-xs text-red-500 mb-0.5">Total Deductions</p>
                <Rupee amount={r2(employeePf + employeeEsi)} className="font-bold text-red-700 text-sm"/>
              </div>
              <div className="bg-emerald-50 rounded-xl p-3 text-center">
                <p className="text-xs text-emerald-500 mb-0.5">Est. Net Take Home</p>
                <Rupee amount={netEstimate} className="font-bold text-emerald-800 text-sm"/>
              </div>
            </div>
            <p className="text-xs text-slate-400 text-center">PT, TDS, LOP deducted at payroll run</p>
          </div>
        </div>
      )}
    </div>
  )
}
