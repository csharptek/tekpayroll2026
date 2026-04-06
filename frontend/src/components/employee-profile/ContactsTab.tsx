import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2, Edit2, Save, X, Phone } from 'lucide-react'
import { profileApi, Field, inp, sel } from './shared'
import { Button, Alert } from '../ui'

const CONTACT_TYPES = ['EMERGENCY', 'PARENT', 'SPOUSE', 'GUARDIAN', 'OTHER']
const BLANK = { name: '', relationship: '', contactType: 'EMERGENCY', phone: '', alternatePhone: '', email: '', address: '' }

function ContactForm({ form, onChange }: { form: typeof BLANK; onChange: (k: string, v: string) => void }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
      <Field label="Name" required><input className={inp} value={form.name} onChange={e => onChange('name', e.target.value)} placeholder="Full name"/></Field>
      <Field label="Relationship"><input className={inp} value={form.relationship} onChange={e => onChange('relationship', e.target.value)} placeholder="e.g. Father, Wife"/></Field>
      <Field label="Contact Type">
        <select className={sel} value={form.contactType} onChange={e => onChange('contactType', e.target.value)}>
          {CONTACT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
      </Field>
      <Field label="Phone" required><input className={inp} value={form.phone} onChange={e => onChange('phone', e.target.value)} placeholder="+91 98765 43210"/></Field>
      <Field label="Alternate Phone"><input className={inp} value={form.alternatePhone} onChange={e => onChange('alternatePhone', e.target.value)}/></Field>
      <Field label="Email"><input className={inp} type="email" value={form.email} onChange={e => onChange('email', e.target.value)}/></Field>
      <div className="sm:col-span-2"><Field label="Address"><input className={inp} value={form.address} onChange={e => onChange('address', e.target.value)} placeholder="Optional address"/></Field></div>
    </div>
  )
}

export default function ContactsTab({ emp, isHR, onSaved }: { emp: any; isHR: boolean; onSaved: () => void }) {
  const qc = useQueryClient()
  const [adding,  setAdding]  = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const [form,    setForm]    = useState({ ...BLANK })
  const [error,   setError]   = useState('')

  const { data: contacts, isLoading } = useQuery({
    queryKey: ['contacts', emp.id],
    queryFn:  () => profileApi.getContacts(emp.id).then(r => r.data.data),
  })

  const addMut = useMutation({
    mutationFn: () => profileApi.addContact(emp.id, form),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['contacts', emp.id] }); setAdding(false); setForm({ ...BLANK }) },
    onError:   (e: any) => setError(e?.response?.data?.error || 'Failed to add contact'),
  })

  const updMut = useMutation({
    mutationFn: () => profileApi.updateContact(emp.id, editing!, form),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['contacts', emp.id] }); setEditing(null) },
    onError:   (e: any) => setError(e?.response?.data?.error || 'Failed to update'),
  })

  const delMut = useMutation({
    mutationFn: (id: string) => profileApi.deleteContact(emp.id, id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['contacts', emp.id] }),
  })

  function startEdit(c: any) {
    setEditing(c.id)
    setForm({ name: c.name, relationship: c.relationship || '', contactType: c.contactType, phone: c.phone, alternatePhone: c.alternatePhone || '', email: c.email || '', address: c.address || '' })
  }

  const s = (k: string, v: string) => setForm(prev => ({ ...prev, [k]: v }))

  return (
    <div className="space-y-4">
      {error && <Alert type="error" message={error}/>}

      {adding && (
        <div className="border border-brand-200 rounded-2xl p-4 bg-brand-50/30">
          <p className="text-sm font-semibold text-slate-700 mb-2">Add New Contact</p>
          <ContactForm form={form} onChange={s}/>
          <div className="flex gap-2 mt-3 justify-end">
            <Button variant="secondary" icon={<X size={14}/>} onClick={() => setAdding(false)}>Cancel</Button>
            <Button icon={<Save size={14}/>} loading={addMut.isPending} onClick={() => { setError(''); addMut.mutate() }}>Add Contact</Button>
          </div>
        </div>
      )}

      {isLoading ? (
        <p className="text-sm text-slate-400">Loading...</p>
      ) : !contacts?.length && !adding ? (
        <div className="text-center py-12 text-slate-400">
          <Phone size={32} className="mx-auto mb-3 opacity-30"/>
          <p className="text-sm">No emergency contacts added yet.</p>
          {isHR && <Button className="mt-4" icon={<Plus size={14}/>} onClick={() => setAdding(true)}>Add Contact</Button>}
        </div>
      ) : (
        <div className="space-y-3">
          {contacts?.map((c: any) => (
            <div key={c.id} className="border border-slate-200 rounded-2xl overflow-hidden">
              {editing === c.id ? (
                <div className="p-4">
                  <ContactForm form={form} onChange={s}/>
                  <div className="flex gap-2 mt-3 justify-end">
                    <Button variant="secondary" icon={<X size={14}/>} onClick={() => setEditing(null)}>Cancel</Button>
                    <Button icon={<Save size={14}/>} loading={updMut.isPending} onClick={() => { setError(''); updMut.mutate() }}>Save</Button>
                  </div>
                </div>
              ) : (
                <div className="p-4 flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-semibold text-slate-800 text-sm">{c.name}</span>
                      <span className="px-2 py-0.5 rounded-full text-xs bg-brand-50 text-brand-700 border border-brand-200">{c.contactType}</span>
                    </div>
                    {c.relationship && <p className="text-xs text-slate-500 mb-2">{c.relationship}</p>}
                    <div className="flex flex-wrap gap-3 text-xs text-slate-600">
                      <span>📞 {c.phone}</span>
                      {c.alternatePhone && <span>📞 {c.alternatePhone}</span>}
                      {c.email && <span>✉️ {c.email}</span>}
                      {c.address && <span>📍 {c.address}</span>}
                    </div>
                  </div>
                  {isHR && (
                    <div className="flex gap-2 flex-shrink-0">
                      <button onClick={() => startEdit(c)} className="p-2 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-700 transition-colors"><Edit2 size={14}/></button>
                      <button onClick={() => delMut.mutate(c.id)} className="p-2 rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-600 transition-colors"><Trash2 size={14}/></button>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {isHR && !adding && contacts?.length > 0 && (
        <Button variant="secondary" icon={<Plus size={14}/>} onClick={() => setAdding(true)}>Add Another Contact</Button>
      )}
    </div>
  )
}
