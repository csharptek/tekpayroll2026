import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Save } from 'lucide-react'
import { profileApi, Field, inp, sel } from './shared'
import { Button, Alert } from '../ui'

const EMP_TYPES = ['FULL_TIME', 'CONTRACT', 'INTERN', 'PART_TIME']

export default function EmploymentTab({ emp, isHR, onSaved }: { emp: any; isHR: boolean; onSaved: () => void }) {
  const d = emp.employmentDetail || {}

  const [form, setForm] = useState({
    employmentType:     d.employmentType     || 'FULL_TIME',
    reportingManagerId: d.reportingManagerId || '',
    workLocation:       d.workLocation       || emp.officeLocation || '',
    probationMonths:    d.probationMonths    ?? 3,
  })

  const [error, setError]     = useState('')
  const [success, setSuccess] = useState('')

  const { data: managers } = useQuery({
    queryKey: ['managers'],
    queryFn:  () => profileApi.getManagers().then(r => r.data.data),
    enabled:  isHR,
  })

  const mut = useMutation({
    mutationFn: () => profileApi.updateEmployment(emp.id, form),
    onSuccess: () => { setSuccess('Employment details saved'); onSaved() },
    onError:   (e: any) => setError(e?.response?.data?.error || 'Save failed'),
  })

  const s  = (k: string, v: any) => setForm(prev => ({ ...prev, [k]: v }))
  const ro = !isHR

  return (
    <div className="space-y-6">
      {error   && <Alert type="error"   message={error}/>}
      {success && <Alert type="success" message={success}/>}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="Employment Type">
          <select className={sel} value={form.employmentType} disabled={ro} onChange={e => s('employmentType', e.target.value)}>
            {EMP_TYPES.map(t => <option key={t} value={t}>{t.replace('_', ' ')}</option>)}
          </select>
        </Field>

        <Field label="Work Location">
          <input className={inp} value={form.workLocation} disabled={ro}
            placeholder="e.g. Ranchi Office, Remote"
            onChange={e => s('workLocation', e.target.value)}/>
        </Field>

        <Field label="Probation Period (months)">
          <input className={inp} type="number" min={0} value={form.probationMonths} disabled={ro}
            onChange={e => s('probationMonths', Number(e.target.value))}/>
        </Field>

        <Field label="Reporting Manager">
          {ro ? (
            <input className={inp} disabled
              value={managers?.find((m: any) => m.id === form.reportingManagerId)?.name || '—'}/>
          ) : (
            <select className={sel} value={form.reportingManagerId}
              onChange={e => s('reportingManagerId', e.target.value)}>
              <option value="">— None —</option>
              {(managers || [])
                .filter((m: any) => m.id !== emp.id)
                .map((m: any) => (
                  <option key={m.id} value={m.id}>
                    {m.name} {m.jobTitle ? `(${m.jobTitle})` : ''} — {m.employeeCode}
                  </option>
                ))}
            </select>
          )}
        </Field>
      </div>

      {/* Read-only core fields */}
      <div className="pt-4 border-t border-slate-100">
        <p className="text-xs font-medium text-slate-400 uppercase tracking-wide mb-3">Core Employment Info</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div><p className="text-xs text-slate-400 mb-1">Date of Joining</p>
            <p className="text-sm font-medium text-slate-700">
              {emp.joiningDate ? new Date(emp.joiningDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}
            </p>
          </div>
          <div><p className="text-xs text-slate-400 mb-1">Department</p><p className="text-sm font-medium text-slate-700">{emp.department || '—'}</p></div>
          <div><p className="text-xs text-slate-400 mb-1">Designation</p><p className="text-sm font-medium text-slate-700">{emp.jobTitle || '—'}</p></div>
          <div><p className="text-xs text-slate-400 mb-1">Role in System</p><p className="text-sm font-medium text-slate-700">{emp.role?.replace('_', ' ') || '—'}</p></div>
        </div>
        {isHR && <p className="text-xs text-slate-400 mt-2">To change Designation or Department, use Edit Basic Info.</p>}
      </div>

      {isHR && (
        <div className="flex justify-end">
          <Button icon={<Save size={14}/>} loading={mut.isPending}
            onClick={() => { setError(''); setSuccess(''); mut.mutate() }}>
            Save Employment Details
          </Button>
        </div>
      )}
    </div>
  )
}
