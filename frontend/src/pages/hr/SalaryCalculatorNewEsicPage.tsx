import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Calculator, RotateCcw, Info, AlertTriangle } from 'lucide-react'
import api from '../../services/api'
import { Rupee } from '../../components/ui'

const ri = (n: number) => Math.round(n)
const r2 = (n: number) => Math.round(n * 100) / 100
const EMPLOYER_PF_CAP = 1800

function computeFromCtc(
  ctc: number,
  basicPct: number,
  hraPct: number,
  incentivePct: number,
  hasIncentive: boolean,
  mediclaim: number,
  esiEmployerRate: number,
  esiThreshold: number
) {
  const annualBonus     = ri(ctc * incentivePct / 100)
  const basicMonthly    = ri(ctc * basicPct / 100 / 12)
  const hraMonthly      = ri(ctc * hraPct / 100 / 12)

  // Both Employer PF and Employer ESI are inside CTC
  const employerPf      = Math.min(ri(basicMonthly * 0.12), EMPLOYER_PF_CAP)
  const esiApplies      = basicMonthly < esiThreshold
  const employerEsi     = esiApplies ? ri(basicMonthly * esiEmployerRate) : 0

  // Grand Monthly = what remains after bonus, mediclaim, employer PF, employer ESI
  const grandTotal      = ri((ctc - (hasIncentive ? annualBonus : 0) - mediclaim) / 12 - employerPf - employerEsi)

  const transport       = ri(grandTotal * 0.02)
  const fbp             = ri(grandTotal * 0.02)
  const hyi             = ri(grandTotal - basicMonthly - hraMonthly - transport - fbp)

  return { basic: basicMonthly, hra: hraMonthly, transport, fbp, hyi, grandTotal, employerPf, employerEsi, annualBonus, esiApplies }
}

interface Components { basic: number; hra: number; transport: number; fbp: number; hyi: number }

export default function SalaryCalculatorNewEsicPage() {
  const [ctc,          setCtc]          = useState(0)
  const [basicPct,     setBasicPct]     = useState(45)
  const [hraPct,       setHraPct]       = useState(35)
  const [hasIncentive, setHasIncentive] = useState(false)
  const [incentivePct, setIncentivePct] = useState(12)
  const [mediclaim,    setMediclaim]    = useState(0)
  const [initialized,  setInitialized]  = useState(false)
  const [grandTotal,   setGrandTotal]   = useState(0)
  const [components,   setComponents]   = useState<Components>({ basic: 0, hra: 0, transport: 0, fbp: 0, hyi: 0 })
  const [computed,     setComputed]     = useState({ employerPf: 0, employerEsi: 0, annualBonus: 0, esiApplies: false })

  const { data: sysConfig } = useQuery({
    queryKey: ['system-config'],
    queryFn: () => api.get('/api/config').then(r => r.data.data),
  })

  const esiEmployeeRate = Number(sysConfig?.ESI_EMPLOYEE_RATE ?? 0.0075)
  const esiEmployerRate = Number(sysConfig?.ESI_EMPLOYER_RATE ?? 0.0325)
  const esiThreshold    = Number(sysConfig?.ESI_THRESHOLD     ?? 21000)

  const esiApplies   = initialized && computed.esiApplies
  const employeeEsi  = esiApplies ? ri(components.basic * esiEmployeeRate) : 0
  const employeePf   = Math.min(ri(components.basic * 0.12), 1800)
  const netEstimate  = r2(grandTotal - employeePf - employeeEsi)

  function applyCtc() {
    if (ctc <= 0) return
    const c = computeFromCtc(ctc, basicPct, hraPct, incentivePct, hasIncentive, mediclaim, esiEmployerRate, esiThreshold)
    setComponents({ basic: c.basic, hra: c.hra, transport: c.transport, fbp: c.fbp, hyi: c.hyi })
    setGrandTotal(c.grandTotal)
    setComputed({ employerPf: c.employerPf, employerEsi: c.employerEsi, annualBonus: c.annualBonus, esiApplies: c.esiApplies })
    setInitialized(true)
  }

  function reset() {
    setComponents({ basic: 0, hra: 0, transport: 0, fbp: 0, hyi: 0 })
    setComputed({ employerPf: 0, employerEsi: 0, annualBonus: 0, esiApplies: false })
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
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center">
          <Calculator size={20} className="text-amber-600"/>
        </div>
        <div>
          <h1 className="text-xl font-bold text-slate-800">Salary Calculator <span className="text-amber-600">(New ESIC)</span></h1>
          <p className="text-sm text-slate-500">PF &amp; ESIC (Employer) both included inside CTC</p>
        </div>
      </div>

      <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4">
        <div className="flex items-center gap-2 mb-2">
          <Info size={14} className="text-amber-600 flex-shrink-0"/>
          <p className="text-xs font-semibold text-amber-700 uppercase tracking-wide">New Rules</p>
        </div>
        <ul className="space-y-1 text-xs text-amber-700 leading-relaxed">
          <li>&#8226; ESI applies when <strong>Basic &lt; &#8377;{esiThreshold.toLocaleString('en-IN')}</strong></li>
          <li>&#8226; Employer PF &amp; Employer ESI are <strong>inside CTC</strong></li>
          <li>&#8226; Grand Monthly = (CTC &#8722; Bonus &#8722; Mediclaim) &#247; 12 &#8722; Employer PF &#8722; Employer ESI</li>
          <li>&#8226; Employee ESI = {(esiEmployeeRate * 100).toFixed(2)}% of Basic | Employee PF = 12% of Basic (max &#8377;1,800)</li>
        </ul>
      </div>

      {/* Inputs */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div>
          <label className="label text-xs">Annual CTC (&#8377;) *</label>
          <input type="number" className="input text-sm" value={ctc || ''} onChange={e => setCtc(Number(e.target.value))} placeholder="e.g. 500000"/>
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
          <label className="label text-xs">Mediclaim (Annual &#8377;)</label>
          <input type="number" className="input text-sm" value={mediclaim || ''} onChange={e => setMediclaim(Number(e.target.value))} placeholder="0"/>
        </div>
        <div className="flex items-end gap-3">
          <div>
            <label className="label text-xs">Annual Incentive</label>
            <div onClick={() => setHasIncentive(p => !p)}
              className={"w-10 h-5 rounded-full transition-colors cursor-pointer relative " + (hasIncentive ? 'bg-brand-600' : 'bg-slate-200')}>
              <span className={"absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform " + (hasIncentive ? 'translate-x-5' : 'translate-x-0.5')}/>
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

      {initialized && (
        <div className="bg-slate-50 border border-slate-200 rounded-2xl overflow-hidden">
          <div className="bg-slate-100 px-4 py-2.5 border-b border-slate-200 flex items-center justify-between">
            <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Salary Breakup</p>
            {esiApplies ? (
              <span className="flex items-center gap-1 text-xs text-amber-600 font-medium">
                <AlertTriangle size={12}/> ESIC applicable
              </span>
            ) : (
              <span className="text-xs text-slate-400">ESIC not applicable</span>
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
                      {key === 'basic' && esiApplies && <span className="ml-2 text-[10px] text-amber-500 font-semibold">ESI base</span>}
                    </td>
                    <td className="py-1.5 text-right font-mono text-slate-700 text-sm">
                      <Rupee amount={components[key]}/>
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

                {/* Employer contributions — inside CTC */}
                <tr className="text-slate-500 text-xs">
                  <td className="py-1.5">
                    Employer PF (12% of Basic, max &#8377;1,800)
                    <span className="ml-1 text-[10px] text-green-600 font-medium">in CTC</span>
                  </td>
                  <td className="py-1.5 text-right font-mono"><Rupee amount={computed.employerPf}/></td>
                  <td className="py-1.5 text-right font-mono"><Rupee amount={r2(computed.employerPf * 12)}/></td>
                </tr>
                {esiApplies && (
                  <tr className="text-slate-500 text-xs">
                    <td className="py-1.5">
                      Employer ESI ({(esiEmployerRate * 100).toFixed(2)}% of Basic)
                      <span className="ml-1 text-[10px] text-green-600 font-medium">in CTC</span>
                    </td>
                    <td className="py-1.5 text-right font-mono"><Rupee amount={computed.employerEsi}/></td>
                    <td className="py-1.5 text-right font-mono"><Rupee amount={r2(computed.employerEsi * 12)}/></td>
                  </tr>
                )}
                {mediclaim > 0 && (
                  <tr className="text-slate-500 text-xs">
                    <td className="py-1.5">Mediclaim</td>
                    <td className="py-1.5 text-right font-mono"><Rupee amount={r2(mediclaim / 12)}/></td>
                    <td className="py-1.5 text-right font-mono"><Rupee amount={mediclaim}/></td>
                  </tr>
                )}
                {hasIncentive && (
                  <tr className="text-amber-600 text-xs">
                    <td className="py-1.5">Annual Bonus ({incentivePct}%) — paid March</td>
                    <td className="py-1.5 text-right font-mono"><Rupee amount={r2(computed.annualBonus / 12)}/></td>
                    <td className="py-1.5 text-right font-mono"><Rupee amount={computed.annualBonus}/></td>
                  </tr>
                )}

                {/* CTC reconciliation row */}
                <tr className="font-semibold border-t border-slate-200">
                  <td className="py-2 text-slate-700 text-xs">Total CTC (reconciled)</td>
                  <td className="py-2 text-right font-mono text-xs text-slate-500"><Rupee amount={ri(ctc / 12)}/></td>
                  <td className="py-2 text-right font-mono text-brand-700"><Rupee amount={ctc}/></td>
                </tr>
              </tbody>
            </table>

            {/* Employee Deductions */}
            <div className="bg-red-50/50 border border-red-100 rounded-xl p-3">
              <p className="text-xs font-semibold text-red-600 uppercase tracking-wide mb-2">Employee Deductions</p>
              <div className="space-y-1 text-xs text-slate-600">
                <div className="flex justify-between">
                  <span>Employee PF (12% of Basic, max &#8377;1,800)</span>
                  <span className="font-mono font-semibold"><Rupee amount={employeePf}/>/mo</span>
                </div>
                {esiApplies ? (
                  <div className="flex justify-between">
                    <span>Employee ESI ({(esiEmployeeRate * 100).toFixed(2)}% of Basic = <Rupee amount={components.basic}/>)</span>
                    <span className="font-mono font-semibold"><Rupee amount={employeeEsi}/>/mo</span>
                  </div>
                ) : (
                  <div className="flex justify-between text-slate-400">
                    <span>Employee ESI — not applicable (Basic &ge; &#8377;{esiThreshold.toLocaleString('en-IN')})</span>
                    <span>&#8377;0</span>
                  </div>
                )}
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3 pt-1">
              <div className="bg-brand-50 rounded-xl p-3 text-center">
                <p className="text-xs text-brand-500 mb-0.5">Total CTC</p>
                <Rupee amount={ctc} className="font-bold text-brand-800 text-sm"/>
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
