import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Save, AlertTriangle } from 'lucide-react'
import { employeeApi } from '../../services/api'
import { Button, Alert, Rupee } from '../ui'
import SalaryBreakdownForm from '../SalaryBreakdownForm'

export default function SalaryTab({ emp, isHR, onSaved }: { emp: any; isHR: boolean; onSaved: () => void }) {
  const [salaryInput, setSalaryInput] = useState({
    annualCtc:        Number(emp.annualCtc) || 0,
    basicPercent:     Number(emp.basicPercent) || 45,
    hraPercent:       Number(emp.hraPercent) || 35,
    transportMonthly: emp.transportMonthly != null ? Number(emp.transportMonthly) : null,
    fbpMonthly:       emp.fbpMonthly != null ? Number(emp.fbpMonthly) : null,
    mediclaim:        Number(emp.mediclaim) || 0,
    hasIncentive:     Boolean(emp.hasIncentive),
    incentivePercent: Number(emp.incentivePercent) || 12,
  })

  const [revisionReason, setRevisionReason] = useState('')
  const [error, setError]     = useState('')
  const [success, setSuccess] = useState('')

  const ctcChanged = salaryInput.annualCtc !== Number(emp.annualCtc)

  const mut = useMutation({
    mutationFn: () => employeeApi.update(emp.id, {
      annualCtc:        salaryInput.annualCtc,
      hasIncentive:     salaryInput.hasIncentive,
      incentivePercent: salaryInput.incentivePercent,
      transportMonthly: salaryInput.transportMonthly,
      fbpMonthly:       salaryInput.fbpMonthly,
      mediclaim:        salaryInput.mediclaim,
      revisionReason,
    }),
    onSuccess: () => { setSuccess('Salary updated successfully'); onSaved() },
    onError:   (e: any) => setError(e?.response?.data?.error || 'Save failed'),
  })

  return (
    <div className="space-y-6">
      {error   && <Alert type="error"   message={error}/>}
      {success && <Alert type="success" message={success}/>}

      {!isHR && Number(emp.annualCtc) > 0 && (
        <div className="bg-slate-50 rounded-2xl p-4 text-sm text-slate-500 text-center">
          Salary information is managed by HR.
        </div>
      )}

      {isHR && (
        <SalaryBreakdownForm
          initialValues={salaryInput}
          onChange={setSalaryInput}
        />
      )}

      {!isHR && Number(emp.annualCtc) > 0 && (
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-slate-50 rounded-xl p-4">
            <p className="text-xs text-slate-400 mb-1">Annual CTC</p>
            <Rupee amount={emp.annualCtc} className="text-lg font-bold text-slate-800"/>
          </div>
          <div className="bg-emerald-50 rounded-xl p-4">
            <p className="text-xs text-slate-400 mb-1">Incentive</p>
            <p className="text-lg font-bold text-emerald-700">
              {emp.hasIncentive ? `${emp.incentivePercent}% of CTC` : 'None'}
            </p>
          </div>
        </div>
      )}

      {isHR && ctcChanged && (
        <div>
          <div className="flex items-start gap-2 p-3 bg-blue-50 rounded-xl border border-blue-100 text-xs text-blue-700 mb-3">
            <AlertTriangle size={13} className="flex-shrink-0 mt-0.5"/>
            <span>CTC changing from <Rupee amount={emp.annualCtc} className="font-semibold"/> to <Rupee amount={salaryInput.annualCtc} className="font-semibold"/>. This will log a salary revision.</span>
          </div>
          <label className="block text-xs font-medium text-slate-500 mb-1.5">Revision Reason</label>
          <input className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl focus:border-brand-400 focus:outline-none"
            placeholder="e.g. Annual appraisal April 2026"
            value={revisionReason} onChange={e => setRevisionReason(e.target.value)}/>
        </div>
      )}

      {/* Salary revision history */}
      {emp.salaryRevisions?.length > 0 && (
        <div>
          <p className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-3">Revision History</p>
          <div className="space-y-2">
            {emp.salaryRevisions.map((r: any) => (
              <div key={r.id} className="flex items-center justify-between px-4 py-2.5 bg-slate-50 rounded-xl text-sm">
                <div>
                  <span className="font-medium text-slate-700">
                    <Rupee amount={r.previousCtc}/> → <Rupee amount={r.newCtc}/>
                  </span>
                  {r.reason && <span className="text-slate-400 ml-2 text-xs">· {r.reason}</span>}
                </div>
                <div className="text-xs text-slate-400">
                  {new Date(r.effectiveFrom).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                  · {r.revisedByName}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {isHR && (
        <div className="flex justify-end">
          <Button icon={<Save size={14}/>} loading={mut.isPending}
            disabled={salaryInput.annualCtc <= 0}
            onClick={() => { setError(''); setSuccess(''); mut.mutate() }}>
            Save Salary
          </Button>
        </div>
      )}
    </div>
  )
}
