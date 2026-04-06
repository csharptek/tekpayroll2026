import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Save } from 'lucide-react'
import { profileApi, Field, inp, sel } from './shared'
import { employeeApi } from '../../services/api'
import { Button, Alert } from '../ui'

const EMP_TYPES = ['FULL_TIME', 'CONTRACT', 'INTERN', 'PART_TIME']

const INDIAN_STATES = [
  'Andhra Pradesh','Arunachal Pradesh','Assam','Bihar','Chhattisgarh','Goa','Gujarat',
  'Haryana','Himachal Pradesh','Jharkhand','Karnataka','Kerala','Madhya Pradesh',
  'Maharashtra','Manipur','Meghalaya','Mizoram','Nagaland','Odisha','Punjab','Rajasthan',
  'Sikkim','Tamil Nadu','Telangana','Tripura','Uttar Pradesh','Uttarakhand','West Bengal',
  'Delhi','Jammu & Kashmir','Ladakh','Puducherry','Chandigarh','Other',
]

export default function EmploymentTab({ emp, isHR, onSaved }: { emp: any; isHR: boolean; onSaved: () => void }) {
  const qc = useQueryClient()
  const d  = emp.employmentDetail || {}

  const [form, setForm] = useState({
    employmentType:     d.employmentType     || 'FULL_TIME',
    reportingManagerId: d.reportingManagerId || '',
    workLocation:       d.workLocation       || emp.officeLocation || '',
    probationMonths:    d.probationMonths    ?? 3,
  })

  // Core employee fields (previously in EditEmployeePage)
  const [core, setCore] = useState({
    jobTitle:       emp.jobTitle       || '',
    department:     emp.department     || '',
    joiningDate:    emp.joiningDate    ? emp.joiningDate.slice(0, 10) : '',
    officeLocation: emp.officeLocation || '',
    state:          emp.state          || '',
  })

  const [error, setError]     = useState('')
  const [success, setSuccess] = useState('')

  const { data: managers } = useQuery({
    queryKey: ['managers'],
    queryFn:  () => profileApi.getManagers().then(r => r.data.data),
    enabled:  isHR,
  })

  const empDetailMut = useMutation({
    mutationFn: () => profileApi.updateEmployment(emp.id, form),
    onSuccess: () => { setSuccess('Saved'); onSaved() },
    onError:   (e: any) => setError(e?.response?.data?.error || 'Save failed'),
  })

  const coreMut = useMutation({
    mutationFn: () => employeeApi.update(emp.id, {
      jobTitle:       core.jobTitle       || undefined,
      department:     core.department     || undefined,
      joiningDate:    core.joiningDate    ? new Date(core.joiningDate).toISOString() : undefined,
      officeLocation: core.officeLocation || undefined,
      state:          core.state          || undefined,
    }),
    onSuccess: () => {
      setSuccess('Core fields saved')
      onSaved()
      qc.invalidateQueries({ queryKey: ['employee-full', emp.id] })
    },
    onError: (e: any) => setError(e?.response?.data?.error || 'Save failed'),
  })

  const s  = (k: string, v: any) => setForm(prev => ({ ...prev, [k]: v }))
  const sc = (k: string, v: any) => setCore(prev => ({ ...prev, [k]: v }))
  const ro = !isHR

  return (
    <div className="space-y-6">
      {error   && <Alert type="error"   message={error} />}
      {success && <Alert type="success" message={success} />}

      {/* ── Core Employee Fields ─────────────────────────────────────── */}
      <div>
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">Core Employment Info</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Designation">
            <input className={inp} value={core.jobTitle} disabled={ro}
              placeholder="e.g. Software Engineer"
              onChange={e => sc('jobTitle', e.target.value)} />
          </Field>

          <Field label="Department">
            <input className={inp} value={core.department} disabled={ro}
              placeholder="e.g. Engineering"
              onChange={e => sc('department', e.target.value)} />
          </Field>

          <Field label="Date of Joining">
            <input className={inp} type="date" value={core.joiningDate} disabled={ro}
              onChange={e => sc('joiningDate', e.target.value)} />
          </Field>

          <Field label="Office Location">
            <input className={inp} value={core.officeLocation} disabled={ro}
              placeholder="e.g. Mumbai, Remote"
              onChange={e => sc('officeLocation', e.target.value)} />
          </Field>

          <Field label="State (for Professional Tax)">
            <select className={sel} value={core.state} disabled={ro}
              onChange={e => sc('state', e.target.value)}>
              <option value="">— Select State —</option>
              {INDIAN_STATES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>

          <Field label="Role in System">
            <input className={inp} value={emp.role?.replace('_', ' ') || '—'} disabled />
          </Field>
        </div>

        {isHR && (
          <div className="flex justify-end mt-3">
            <Button variant="secondary" icon={<Save size={14} />} loading={coreMut.isPending}
              onClick={() => { setError(''); setSuccess(''); coreMut.mutate() }}>
              Save Core Fields
            </Button>
          </div>
        )}
      </div>

      {/* ── Employment Detail Fields ─────────────────────────────────── */}
      <div className="pt-4 border-t border-slate-100">
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">Employment Details</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Employment Type">
            <select className={sel} value={form.employmentType} disabled={ro}
              onChange={e => s('employmentType', e.target.value)}>
              {EMP_TYPES.map(t => <option key={t} value={t}>{t.replace('_', ' ')}</option>)}
            </select>
          </Field>

          <Field label="Work Location">
            <input className={inp} value={form.workLocation} disabled={ro}
              placeholder="e.g. Ranchi Office, Remote"
              onChange={e => s('workLocation', e.target.value)} />
          </Field>

          <Field label="Probation Period (months)">
            <input className={inp} type="number" min={0} value={form.probationMonths} disabled={ro}
              onChange={e => s('probationMonths', Number(e.target.value))} />
          </Field>

          <Field label="Reporting Manager">
            {ro ? (
              <input className={inp} disabled
                value={managers?.find((m: any) => m.id === form.reportingManagerId)?.name || '—'} />
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

        {isHR && (
          <div className="flex justify-end mt-3">
            <Button icon={<Save size={14} />} loading={empDetailMut.isPending}
              onClick={() => { setError(''); setSuccess(''); empDetailMut.mutate() }}>
              Save Employment Details
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
