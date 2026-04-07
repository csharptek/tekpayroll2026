import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Pencil, Trash2, Calendar } from 'lucide-react'
import { leaveApi } from '../../services/api'
import { PageHeader, Button, Alert } from '../../components/ui'
import { DatePicker } from '../../components/DatePicker'

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

interface Holiday {
  id: string; date: string; name: string; description?: string; greetingMessage?: string; greetingSent: boolean
}

const BLANK = { date: '', name: '', description: '', greetingMessage: '' }

export default function PublicHolidaysPage() {
  const qc = useQueryClient()
  const [year, setYear]       = useState(new Date().getFullYear())
  const [form, setForm]       = useState(BLANK)
  const [editId, setEditId]   = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [error, setError]     = useState('')
  const [success, setSuccess] = useState('')

  const { data: holidays = [], isLoading } = useQuery({
    queryKey: ['holidays', year],
    queryFn: () => leaveApi.holidays(year).then(r => r.data.data),
  })

  const addMutation = useMutation({
    mutationFn: (data: any) => leaveApi.addHoliday(data),
    onSuccess: () => { setSuccess('Holiday added.'); setShowForm(false); setForm(BLANK); qc.invalidateQueries({ queryKey: ['holidays'] }) },
    onError: (e: any) => setError(e?.response?.data?.error || 'Failed to add holiday'),
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => leaveApi.updateHoliday(id, data),
    onSuccess: () => { setSuccess('Holiday updated.'); setEditId(null); setForm(BLANK); qc.invalidateQueries({ queryKey: ['holidays'] }) },
    onError: (e: any) => setError(e?.response?.data?.error || 'Failed to update'),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => leaveApi.deleteHoliday(id),
    onSuccess: () => { setSuccess('Holiday deleted.'); qc.invalidateQueries({ queryKey: ['holidays'] }) },
    onError: (e: any) => setError(e?.response?.data?.error || 'Failed to delete'),
  })

  function startEdit(h: Holiday) {
    setEditId(h.id)
    setForm({ date: h.date.slice(0, 10), name: h.name, description: h.description || '', greetingMessage: h.greetingMessage || '' })
    setShowForm(true)
    setError('')
  }

  function handleSubmit() {
    setError('')
    if (!form.date || !form.name) { setError('Date and name are required'); return }
    if (editId) {
      updateMutation.mutate({ id: editId, data: form })
    } else {
      addMutation.mutate(form)
    }
  }

  function handleCancel() {
    setShowForm(false); setEditId(null); setForm(BLANK); setError('')
  }

  // Group holidays by month
  const grouped: Record<number, Holiday[]> = {}
  for (const h of holidays as Holiday[]) {
    const m = new Date(h.date).getMonth()
    if (!grouped[m]) grouped[m] = []
    grouped[m].push(h)
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Public Holidays"
        subtitle={`${(holidays as Holiday[]).length} holidays in ${year}`}
        actions={
          <div className="flex items-center gap-3">
            <select className="input text-sm py-1.5 px-3 w-24"
              value={year} onChange={e => setYear(Number(e.target.value))}>
              {[-1, 0, 1].map(i => { const y = new Date().getFullYear() + i; return <option key={y} value={y}>{y}</option> })}
            </select>
            <Button icon={<Plus size={14} />} onClick={() => { setShowForm(true); setEditId(null); setForm(BLANK); setError('') }}>
              Add Holiday
            </Button>
          </div>
        }
      />

      {error   && <Alert type="error"   message={error}   />}
      {success && <Alert type="success" message={success} />}

      {/* Form */}
      {showForm && (
        <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4">
          <h3 className="text-sm font-semibold text-slate-800">{editId ? 'Edit Holiday' : 'Add Public Holiday'}</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-medium text-slate-600 block mb-1">Date <span className="text-red-400">*</span></label>
              <DatePicker value={form.date} onChange={v => setForm(f => ({ ...f, date: v }))} />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-600 block mb-1">Holiday Name <span className="text-red-400">*</span></label>
              <input type="text" className="input w-full" placeholder="e.g. Diwali"
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-600 block mb-1">Description</label>
              <input type="text" className="input w-full" placeholder="Short description…"
                value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-600 block mb-1">Greeting Message</label>
              <input type="text" className="input w-full" placeholder="Wishing you a joyful Diwali!"
                value={form.greetingMessage}
                onChange={e => setForm(f => ({ ...f, greetingMessage: e.target.value }))}
              />
              <p className="text-xs text-slate-400 mt-1">Sent automatically via email to all employees on the holiday date.</p>
            </div>
          </div>
          <div className="flex gap-3 justify-end">
            <Button variant="secondary" onClick={handleCancel}>Cancel</Button>
            <Button loading={addMutation.isPending || updateMutation.isPending} onClick={handleSubmit}>
              {editId ? 'Save Changes' : 'Add Holiday'}
            </Button>
          </div>
        </div>
      )}

      {/* Holiday List */}
      {isLoading ? (
        <div className="text-sm text-slate-400 text-center py-10">Loading…</div>
      ) : (holidays as Holiday[]).length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-2xl p-10 text-center">
          <Calendar size={32} className="text-slate-300 mx-auto mb-3" />
          <p className="text-sm text-slate-400">No holidays added for {year} yet.</p>
          <button onClick={() => setShowForm(true)} className="text-sm text-brand-600 underline mt-2">Add the first one</button>
        </div>
      ) : (
        <div className="space-y-4">
          {Object.keys(grouped).map(Number).sort((a, b) => a - b).map(month => (
            <div key={month} className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
              <div className="bg-slate-50 px-4 py-2 border-b border-slate-100">
                <h3 className="text-xs font-semibold text-slate-600 uppercase tracking-wide">{MONTHS[month]} {year}</h3>
              </div>
              <table className="w-full text-sm">
                <tbody>
                  {grouped[month].map((h, i) => {
                    const date = new Date(h.date)
                    const dow  = date.toLocaleDateString('en-IN', { weekday: 'short' })
                    const day  = date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })
                    return (
                      <tr key={h.id} className={i > 0 ? 'border-t border-slate-50' : ''}>
                        <td className="px-4 py-3 w-28">
                          <div className="text-xs font-semibold text-slate-700">{day}</div>
                          <div className="text-xs text-slate-400">{dow}</div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="text-sm font-medium text-slate-800">{h.name}</div>
                          {h.description && <div className="text-xs text-slate-400 mt-0.5">{h.description}</div>}
                        </td>
                        <td className="px-4 py-3">
                          {h.greetingMessage && (
                            <div className="text-xs text-slate-400 italic max-w-[300px] truncate" title={h.greetingMessage}>
                              "{h.greetingMessage}"
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {h.greetingSent && (
                            <span className="text-xs text-emerald-500 mr-3">✓ Greeting sent</span>
                          )}
                          <button onClick={() => startEdit(h)} className="text-slate-400 hover:text-slate-600 mr-2">
                            <Pencil size={13} />
                          </button>
                          <button onClick={() => { if (confirm(`Delete "${h.name}"?`)) deleteMutation.mutate(h.id) }}
                            className="text-slate-300 hover:text-red-500">
                            <Trash2 size={13} />
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
