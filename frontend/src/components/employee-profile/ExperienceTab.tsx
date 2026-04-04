import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2, Edit2, Save, X, Building2 } from 'lucide-react'
import { profileApi, Field, inp } from './shared'
import { Button, Alert, Rupee } from '../ui'

const BLANK = { companyName: '', designation: '', startDate: '', endDate: '', lastDrawnSalary: '', reasonForLeaving: '' }

export default function ExperienceTab({ emp, isHR, onSaved }: { emp: any; isHR: boolean; onSaved: () => void }) {
  const qc = useQueryClient()
  const [adding, setAdding]   = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const [form, setForm]       = useState({ ...BLANK })
  const [error, setError]     = useState('')

  const { data: records } = useQuery({
    queryKey: ['experience', emp.id],
    queryFn:  () => profileApi.getExperience(emp.id).then(r => r.data.data),
  })

  const addMut = useMutation({
    mutationFn: () => profileApi.addExperience(emp.id, form),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['experience', emp.id] }); setAdding(false); setForm({ ...BLANK }) },
    onError: (e: any) => setError(e?.response?.data?.error || 'Failed'),
  })
  const updMut = useMutation({
    mutationFn: () => profileApi.updateExperience(emp.id, editing!, form),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['experience', emp.id] }); setEditing(null) },
    onError: (e: any) => setError(e?.response?.data?.error || 'Failed'),
  })
  const delMut = useMutation({
    mutationFn: (id: string) => profileApi.deleteExperience(emp.id, id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['experience', emp.id] }),
  })

  function startEdit(r: any) {
    setEditing(r.id)
    setForm({ companyName: r.companyName, designation: r.designation, startDate: r.startDate?.slice(0, 10) || '', endDate: r.endDate?.slice(0, 10) || '', lastDrawnSalary: r.lastDrawnSalary?.toString() || '', reasonForLeaving: r.reasonForLeaving || '' })
  }
  const s = (k: string, v: string) => setForm(prev => ({ ...prev, [k]: v }))

  function duration(start: string, end: string | null) {
    const s = new Date(start), e = end ? new Date(end) : new Date()
    const months = (e.getFullYear() - s.getFullYear()) * 12 + e.getMonth() - s.getMonth()
    const y = Math.floor(months / 12), m = months % 12
    return [y > 0 ? `${y}y` : '', m > 0 ? `${m}m` : ''].filter(Boolean).join(' ') || '< 1m'
  }

  const FormFields = () => (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
      <Field label="Company Name" required><input className={inp} value={form.companyName} onChange={e => s('companyName', e.target.value)} placeholder="Company name"/></Field>
      <Field label="Designation" required><input className={inp} value={form.designation} onChange={e => s('designation', e.target.value)} placeholder="Your role"/></Field>
      <Field label="Start Date" required><input className={inp} type="date" value={form.startDate} onChange={e => s('startDate', e.target.value)}/></Field>
      <Field label="End Date"><input className={inp} type="date" value={form.endDate} onChange={e => s('endDate', e.target.value)}/></Field>
      <Field label="Last Drawn Salary (₹)"><input className={inp} type="number" value={form.lastDrawnSalary} onChange={e => s('lastDrawnSalary', e.target.value)} placeholder="Annual"/></Field>
      <Field label="Reason for Leaving"><input className={inp} value={form.reasonForLeaving} onChange={e => s('reasonForLeaving', e.target.value)} placeholder="Optional"/></Field>
    </div>
  )

  return (
    <div className="space-y-4">
      {error && <Alert type="error" message={error}/>}
      {adding && (
        <div className="border border-brand-200 rounded-2xl p-4 bg-brand-50/30">
          <p className="text-sm font-semibold text-slate-700">Add Work Experience</p>
          <FormFields/>
          <div className="flex gap-2 mt-3 justify-end">
            <Button variant="secondary" icon={<X size={14}/>} onClick={() => setAdding(false)}>Cancel</Button>
            <Button icon={<Save size={14}/>} loading={addMut.isPending} onClick={() => { setError(''); addMut.mutate() }}>Add</Button>
          </div>
        </div>
      )}
      {!records?.length && !adding ? (
        <div className="text-center py-12 text-slate-400">
          <Building2 size={32} className="mx-auto mb-3 opacity-30"/>
          <p className="text-sm">No work experience added.</p>
          {isHR && <Button className="mt-4" icon={<Plus size={14}/>} onClick={() => setAdding(true)}>Add Experience</Button>}
        </div>
      ) : (
        <div className="space-y-3">
          {records?.map((r: any) => (
            <div key={r.id} className="border border-slate-200 rounded-2xl overflow-hidden">
              {editing === r.id ? (
                <div className="p-4">
                  <FormFields/>
                  <div className="flex gap-2 mt-3 justify-end">
                    <Button variant="secondary" icon={<X size={14}/>} onClick={() => setEditing(null)}>Cancel</Button>
                    <Button icon={<Save size={14}/>} loading={updMut.isPending} onClick={() => { setError(''); updMut.mutate() }}>Save</Button>
                  </div>
                </div>
              ) : (
                <div className="p-4 flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <p className="font-semibold text-slate-800 text-sm">{r.designation}</p>
                      <span className="text-slate-400 text-xs">at {r.companyName}</span>
                    </div>
                    <div className="flex flex-wrap gap-3 mt-1 text-xs text-slate-500">
                      <span>{new Date(r.startDate).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })} — {r.endDate ? new Date(r.endDate).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' }) : 'Present'}</span>
                      <span>({duration(r.startDate, r.endDate)})</span>
                      {r.lastDrawnSalary && <span>Last Salary: <Rupee amount={r.lastDrawnSalary}/>/yr</span>}
                      {r.reasonForLeaving && <span>· {r.reasonForLeaving}</span>}
                    </div>
                  </div>
                  {isHR && (
                    <div className="flex gap-2 flex-shrink-0">
                      <button onClick={() => startEdit(r)} className="p-2 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-700"><Edit2 size={14}/></button>
                      <button onClick={() => delMut.mutate(r.id)} className="p-2 rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-600"><Trash2 size={14}/></button>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {isHR && !adding && records?.length > 0 && (
        <Button variant="secondary" icon={<Plus size={14}/>} onClick={() => setAdding(true)}>Add Another</Button>
      )}
    </div>
  )
}
