import { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import api from '../services/api'
import { RotateCcw, AlertTriangle, Info } from 'lucide-react'
import { Rupee } from './ui'

const r2 = (n: number) => Math.round(n * 100) / 100
const TRANSPORT_DEFAULT = 0.04
const FBP_DEFAULT       = 0.04

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
interface Overrides   { basic: boolean; hra: boolean; transport: boolean; fbp: boolean; hyi: boolean }

function computeFromCtc(ctc: number, basicPct: number, hraPct: number, incentivePct: number, hasIncentive: boolean, mediclaim: number) {
  const annualBonus  = hasIncentive ? r2(ctc * incentivePct / 100) : 0
  const basicMonthly = r2(ctc * basicPct / 100 / 12)
  const employerPf   = Math.min(r2(basicMonthly * 0.12), EMPLOYEE_PF_CAP)
  const grandTotal   = r2((ctc - annualBonus - employerPf * 12 - mediclaim) / 12)
  const hraMonthly   = r2(ctc * hraPct / 100 / 12)
  const transport    = r2(basicMonthly * TRANSPORT_DEFAULT)
  const fbp          = r2(basicMonthly * FBP_DEFAULT)
  const hyi          = r2(grandTotal - basicMonthly - hraMonthly - transport - fbp)
  return { basic: basicMonthly, hra: hraMonthly, transport, fbp, hyi, grandTotal, employerPf, annualBonus }
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
      const t  = iv.transportMonthly != null ? iv.transportMonthly : c.transport
      const f  = iv.fbpMonthly       != null ? iv.fbpMonthly       : c.fbp
      return { basic: c.basic, hra: c.hra, transport: t, fbp: f, hyi: r2(c.grandTotal - c.basic - c.hra - t - f) }
    }
    return { basic: 0, hra: 0, transport: 0, fbp: 0, hyi: 0 }
  })
  const [overrides,   setOverrides]   = useState<Overrides>(() => ({
    basic: false, hra: false,
    transport: (initialValues?.transportMonthly ?? null) != null,
    fbp:       (initialValues?.fbpMonthly       ?? null) != null,
    hyi: false,
  }))
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

  const employerPf    = r2(components.basic * 0.12)  // uncapped 12%
  const employeePf    = r2(components.basic * 0.12)  // uncapped 12%
  const annualBonus   = hasIncentive ? r2(ctc * incentivePct / 100) : 0
  const allocated     = r2(components.basic + components.hra + components.transport + components.fbp + components.hyi)
  const remainder     = r2(grandTotal - allocated)
  const isOver        = remainder < -1
  const esiBase       = r2(grandTotal - components.hyi)  // Gross - HYI per govt rules
  const esiApplies    = initialized && esiBase > 0 && esiBase <= esiThreshold
  const employeeEsi   = esiApplies ? r2(esiBase * esiEmployeeRate) : 0
  const employerEsi   = esiApplies ? r2(esiBase * esiEmployerRate) : 0
  const totalCtcCheck = r2(grandTotal * 12 + employerPf * 12 + annualBonus + mediclaim)
  const netEstimate   = r2(grandTotal - employerPf - employeeEsi)

  function emitChange(comps: Components, ov: Overrides, gt: number) {
    const basicPctFinal = comps.basic > 0 ? r2((comps.basic * 12 / ctc) * 100) : basicPct
    const hraPctFinal   = comps.hra   > 0 ? r2((comps.hra   * 12 / ctc) * 100) : hraPct
    onChange({
      annualCtc:        ctc,
      basicPercent:     basicPctFinal,
      hraPercent:       hraPctFinal,
      transportMonthly: ov.transport ? comps.transport : null,
      fbpMonthly:       ov.fbp       ? comps.fbp       : null,
      mediclaim,
      hasIncentive,
      incentivePercent: incentivePct,
    })
  }

  function applyCtc() {
    if (ctc <= 0) return
    const c = computeFromCtc(ctc, basicPct, hraPct, incentivePct, hasIncentive, mediclaim)
    const newComps = { basic: c.basic, hra: c.hra, transport: c.transport, fbp: c.fbp, hyi: c.hyi }
    const newOv    = { basic: false, hra: false, transport: false, fbp: false, hyi: false }
    setComponents(newComps)
    setOverrides(newOv)
    setGrandTotal(c.grandTotal)
    setInitialized(true)
    emitChange(newComps, newOv, c.grandTotal)
  }

  function updateComponent(key: keyof Components, val: number) {
    const prev = { ...components }
    const next = { ...components, [key]: val }
    const newOv = { ...overrides, [key]: true }

    if (key === 'basic') {
      if (!overrides.hra)       next.hra       = r2(ctc * hraPct / 100 / 12)
      if (!overrides.transport) next.transport  = r2(val * TRANSPORT_DEFAULT)
      if (!overrides.fbp)       next.fbp        = r2(val * FBP_DEFAULT)
      next.hyi = r2(grandTotal - next.basic - next.hra - next.transport - next.fbp)
    } else if (key === 'hra') {
      next.hyi = r2(grandTotal - next.basic - next.hra - next.transport - next.fbp)
    } else if (key === 'transport') {
      const diff = val - prev.transport
      next.fbp = r2(prev.fbp - diff)
      next.hyi = components.hyi
    } else if (key === 'fbp') {
      const diff = val - prev.fbp
      next.transport = r2(prev.transport - diff)
      next.hyi = components.hyi
    } else if (key === 'hyi') {
      const diff = val - prev.hyi
      const canT = !overrides.transport
      const canF = !overrides.fbp
      if (canT && canF) { const half = r2(diff / 2); next.transport = r2(prev.transport - half); next.fbp = r2(prev.fbp - (diff - half)) }
      else if (canT)    { next.transport = r2(prev.transport - diff) }
      else if (canF)    { next.fbp = r2(prev.fbp - diff) }
    }

    setComponents(next)
    setOverrides(newOv)
    emitChange(next, newOv, grandTotal)
  }

  function resetComponent(key: keyof Components) {
    const c = computeFromCtc(ctc, basicPct, hraPct, incentivePct, hasIncentive, mediclaim)
    const newOv   = { ...overrides, [key]: false }
    const next    = { ...components, [key]: c[key as keyof typeof c] as number }
    next.hyi      = r2(grandTotal - next.basic - next.hra - next.transport - next.fbp)
    setComponents(next)
    setOverrides(newOv)
    emitChange(next, newOv, grandTotal)
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
            <p className="text-xs font-semibold text-blue-700 uppercase tracking-wide">How component editing works</p>
          </div>
          <ul className="space-y-1 text-xs text-blue-700 leading-relaxed">
            <li>• <strong>Change Basic</strong> — HRA recalculates via its %, Transport &amp; FBP recalculate via 4% of new Basic, HYI absorbs the remainder.</li>
            <li>• <strong>Change HRA</strong> — HYI absorbs the difference. Transport &amp; FBP unchanged.</li>
            <li>• <strong>Change Transport</strong> — difference goes to/from FBP. HYI not affected.</li>
            <li>• <strong>Change FBP</strong> — difference goes to/from Transport. HYI not affected.</li>
            <li>• <strong>Change HYI</strong> — difference splits equally between Transport &amp; FBP.</li>
            <li>• Use the <strong>↺ reset icon</strong> on any row to revert to auto-calculated value.</li>
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
                  <th className="w-8"/>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ label, key }) => (
                  <tr key={key} className="border-b border-slate-100">
                    <td className="py-1.5 text-slate-700 font-medium text-sm">
                      {label}
                      {overrides[key] && <span className="ml-2 text-[10px] text-brand-500 font-semibold uppercase">custom</span>}
                      {!overrides[key] && (key === 'transport' || key === 'fbp') && <span className="ml-2 text-[10px] text-slate-400">auto</span>}
                      {key === 'hyi' && !overrides[key] && <span className="ml-2 text-[10px] text-slate-400">balancer</span>}
                    </td>
                    <td className="py-1.5 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <span className="text-slate-400 text-xs">₹</span>
                        <input
                          type="number"
                          value={components[key] || ''}
                          onChange={e => updateComponent(key, Number(e.target.value))}
                          className="w-24 text-right border border-slate-200 rounded-lg px-2 py-1 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent bg-white"
                        />
                      </div>
                    </td>
                    <td className="py-1.5 text-right font-mono text-slate-500 text-sm">
                      <Rupee amount={r2(components[key] * 12)}/>
                    </td>
                    <td className="py-1.5 text-right">
                      {overrides[key] && (
                        <button type="button" onClick={() => resetComponent(key)} className="text-slate-300 hover:text-brand-600 transition-colors" title="Reset to auto">
                          <RotateCcw size={11}/>
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                <tr className="font-semibold">
                  <td className="py-2 text-slate-800">Gross Monthly</td>
                  <td className="py-2 text-right font-mono text-brand-700"><Rupee amount={grandTotal}/></td>
                  <td className="py-2 text-right font-mono text-slate-600"><Rupee amount={r2(grandTotal * 12)}/></td>
                  <td/>
                </tr>
                <tr className="text-slate-500 text-xs">
                  <td className="py-1.5">Employer PF (in CTC)</td>
                  <td className="py-1.5 text-right font-mono"><Rupee amount={employerPf}/></td>
                  <td className="py-1.5 text-right font-mono"><Rupee amount={r2(employerPf * 12)}/></td>
                  <td/>
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
