import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Save, AlertTriangle } from 'lucide-react'
import { employeeApi } from '../../services/api'
import { Field, inp, sel } from './shared'
import { Button, Alert } from '../ui'

const EXIT_TYPES = ['RESIGNED', 'TERMINATED', 'ABSCONDED']

export default function ExitTab({ emp, isHR, onSaved }: { emp: any; isHR: boolean; onSaved: () => void }) {
  const [form, setForm] = useState({
    resignationDate:    emp.resignationDate?.slice(0, 10) || '',
    lastWorkingDay:     emp.lastWorkingDay?.slice(0, 10)  || '',
    exitType:           emp.exitType           || 'RESIGNED',
    reasonForExit:      emp.reasonForExit      || '',
    noticePeriodServed: emp.noticePeriodServed || false,
    buyoutAmount:       emp.buyoutAmount       || '',
  })

  const [error,   setError]   = useState('')
  const [success, setSuccess] = useState('')

  const mut = useMutation({
    mutationFn: () => employeeApi.update(emp.id, {
      resignationDate: form.resignationDate ? new Date(form.resignationDate).toISOString() : undefined,
      lastWorkingDay:  form.lastWorkingDay  ? new Date(form.lastWorkingDay).toISOString()  : undefined,
    }),
    onSuccess: () => { setSuccess('Exit details saved'); onSaved() },
    onError:   (e: any) => setError(e?.response?.data?.error || 'Save failed'),
  })

  const s = (k: string, v: any) => setForm(prev => ({ ...prev, [k]: v }))

  return (
    <div className="space-y-5">
      {error   && <Alert type="error"   message={error}/>}
      {success && <Alert type="success" message={success}/>}

      <div className="flex items-start gap-3 p-3 bg-amber-50 rounded-xl border border-amber-100">
        <AlertTriangle size={16} className="text-amber-500 flex-shrink-0 mt-0.5"/>
        <p className="text-sm text-amber-700">
          Setting a resignation date will change the employee's status to <strong>ON NOTICE</strong>.
          This enables F&F settlement calculation.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="Resignation Date">
          <input className={inp} type="date" value={form.resignationDate} disabled={!isHR}
            onChange={e => s('resignationDate', e.target.value)}/>
        </Field>
        <Field label="Last Working Day">
          <input className={inp} type="date" value={form.lastWorkingDay} disabled={!isHR}
            onChange={e => s('lastWorkingDay', e.target.value)}/>
        </Field>
      </div>

      {(form.resignationDate || emp.resignationDate) && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Exit Type">
              <select className={sel} value={form.exitType} disabled={!isHR}
                onChange={e => s('exitType', e.target.value)}>
                {EXIT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </Field>
            <Field label="Notice Period Served">
              <div className="flex items-center gap-3 pt-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={form.noticePeriodServed}
                    disabled={!isHR} onChange={e => s('noticePeriodServed', e.target.checked)}
                    className="w-4 h-4 rounded"/>
                  <span className="text-sm text-slate-600">Yes, notice period served</span>
                </label>
              </div>
            </Field>
            <Field label="Reason for Exit">
              <input className={inp} value={form.reasonForExit} disabled={!isHR}
                placeholder="Brief reason" onChange={e => s('reasonForExit', e.target.value)}/>
            </Field>
            <Field label="Notice Period Buyout Amount (₹)">
              <input className={inp} type="number" value={form.buyoutAmount} disabled={!isHR}
                placeholder="0" onChange={e => s('buyoutAmount', e.target.value)}/>
            </Field>
          </div>
        </>
      )}

      {isHR && (
        <div className="flex justify-end">
          <Button icon={<Save size={14}/>} loading={mut.isPending}
            onClick={() => { setError(''); setSuccess(''); mut.mutate() }}>
            Save Exit Details
          </Button>
        </div>
      )}
    </div>
  )
}
