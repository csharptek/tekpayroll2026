import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2, Edit2, Save, X, GraduationCap } from 'lucide-react'
import { profileApi, Field, inp } from './shared'
import { Button, Alert } from '../ui'

const BLANK_EDU = { degree: '', institution: '', specialization: '', yearOfPassing: '', percentageGrade: '' }

function EduForm({ form, onChange }: { form: typeof BLANK_EDU; onChange: (k: string, v: string) => void }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
      <Field label="Degree" required><input className={inp} value={form.degree} onChange={e => onChange('degree', e.target.value)} placeholder="e.g. B.Tech, MBA, BCA"/></Field>
      <Field label="Institution" required><input className={inp} value={form.institution} onChange={e => onChange('institution', e.target.value)} placeholder="University / College name"/></Field>
      <Field label="Specialization"><input className={inp} value={form.specialization} onChange={e => onChange('specialization', e.target.value)} placeholder="e.g. Computer Science"/></Field>
      <Field label="Year of Passing"><input className={inp} type="number" value={form.yearOfPassing} onChange={e => onChange('yearOfPassing', e.target.value)} placeholder="e.g. 2019"/></Field>
      <Field label="Percentage / Grade"><input className={inp} value={form.percentageGrade} onChange={e => onChange('percentageGrade', e.target.value)} placeholder="e.g. 78% or 7.8 CGPA"/></Field>
    </div>
  )
}

export default function EducationTab({ emp, isHR, onSaved }: { emp: any; isHR: boolean; onSaved: () => void }) {
  const qc = useQueryClient()
  const [adding, setAdding]   = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const [form, setForm]       = useState({ ...BLANK_EDU })
  const [error, setError]     = useState('')

  const { data: records } = useQuery({
    queryKey: ['education', emp.id],
    queryFn:  () => profileApi.getEducation(emp.id).then(r => r.data.data),
  })

  const addMut = useMutation({
    mutationFn: () => profileApi.addEducation(emp.id, form),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['education', emp.id] }); setAdding(false); setForm({ ...BLANK_EDU }) },
    onError: (e: any) => setError(e?.response?.data?.error || 'Failed'),
  })
  const updMut = useMutation({
    mutationFn: () => profileApi.updateEducation(emp.id, editing!, form),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['education', emp.id] }); setEditing(null) },
    onError: (e: any) => setError(e?.response?.data?.error || 'Failed'),
  })
  const delMut = useMutation({
    mutationFn: (id: string) => profileApi.deleteEducation(emp.id, id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['education', emp.id] }),
  })

  function startEdit(r: any) {
    setEditing(r.id)
    setForm({ degree: r.degree, institution: r.institution, specialization: r.specialization || '', yearOfPassing: r.yearOfPassing?.toString() || '', percentageGrade: r.percentageGrade || '' })
  }
  const s = (k: string, v: string) => setForm(prev => ({ ...prev, [k]: v }))

  return (
    <div className="space-y-4">
      {error && <Alert type="error" message={error}/>}
      {adding && (
        <div className="border border-brand-200 rounded-2xl p-4 bg-brand-50/30">
          <p className="text-sm font-semibold text-slate-700">Add Education</p>
          <EduForm form={form} onChange={s}/>
          <div className="flex gap-2 mt-3 justify-end">
            <Button variant="secondary" icon={<X size={14}/>} onClick={() => setAdding(false)}>Cancel</Button>
            <Button icon={<Save size={14}/>} loading={addMut.isPending} onClick={() => { setError(''); addMut.mutate() }}>Add</Button>
          </div>
        </div>
      )}
      {!records?.length && !adding ? (
        <div className="text-center py-12 text-slate-400">
          <GraduationCap size={32} className="mx-auto mb-3 opacity-30"/>
          <p className="text-sm">No education records added.</p>
          {isHR && <Button className="mt-4" icon={<Plus size={14}/>} onClick={() => setAdding(true)}>Add Education</Button>}
        </div>
      ) : (
        <div className="space-y-3">
          {records?.map((r: any) => (
            <div key={r.id} className="border border-slate-200 rounded-2xl overflow-hidden">
              {editing === r.id ? (
                <div className="p-4">
                  <EduForm form={form} onChange={s}/>
                  <div className="flex gap-2 mt-3 justify-end">
                    <Button variant="secondary" icon={<X size={14}/>} onClick={() => setEditing(null)}>Cancel</Button>
                    <Button icon={<Save size={14}/>} loading={updMut.isPending} onClick={() => { setError(''); updMut.mutate() }}>Save</Button>
                  </div>
                </div>
              ) : (
                <div className="p-4 flex items-start justify-between gap-4">
                  <div>
                    <p className="font-semibold text-slate-800 text-sm">{r.degree} {r.specialization ? `— ${r.specialization}` : ''}</p>
                    <p className="text-sm text-slate-600 mt-0.5">{r.institution}</p>
                    <div className="flex gap-3 mt-1 text-xs text-slate-400">
                      {r.yearOfPassing && <span>Passed: {r.yearOfPassing}</span>}
                      {r.percentageGrade && <span>Score: {r.percentageGrade}</span>}
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
