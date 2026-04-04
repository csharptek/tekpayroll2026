import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2, Edit2, Save, X, CreditCard, Star } from 'lucide-react'
import { profileApi, Field, inp, sel } from './shared'
import { Button, Alert } from '../ui'

const BLANK = { accountHolderName: '', accountNumber: '', ifscCode: '', bankName: '', branchName: '', accountType: 'SAVINGS', isPrimary: false }

export default function BankTab({ emp, isHR, onSaved }: { emp: any; isHR: boolean; onSaved: () => void }) {
  const qc = useQueryClient()
  const [adding, setAdding]   = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const [form, setForm]       = useState<any>({ ...BLANK })
  const [error, setError]     = useState('')

  const { data: accounts } = useQuery({
    queryKey: ['bank-accounts', emp.id],
    queryFn:  () => profileApi.getBankAccounts(emp.id).then(r => r.data.data),
  })

  const addMut = useMutation({
    mutationFn: () => profileApi.addBankAccount(emp.id, form),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['bank-accounts', emp.id] }); setAdding(false); setForm({ ...BLANK }) },
    onError: (e: any) => setError(e?.response?.data?.error || 'Failed'),
  })
  const updMut = useMutation({
    mutationFn: () => profileApi.updateBankAccount(emp.id, editing!, form),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['bank-accounts', emp.id] }); setEditing(null) },
    onError: (e: any) => setError(e?.response?.data?.error || 'Failed'),
  })
  const delMut = useMutation({
    mutationFn: (id: string) => profileApi.deleteBankAccount(emp.id, id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['bank-accounts', emp.id] }),
  })

  function startEdit(a: any) {
    setEditing(a.id)
    setForm({ accountHolderName: a.accountHolderName, accountNumber: a.accountNumber, ifscCode: a.ifscCode, bankName: a.bankName, branchName: a.branchName || '', accountType: a.accountType, isPrimary: a.isPrimary })
  }
  const s = (k: string, v: any) => setForm((prev: any) => ({ ...prev, [k]: v }))

  // Mask account number
  function maskAcc(n: string) { return n.length > 4 ? '****' + n.slice(-4) : n }

  const FormFields = () => (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
      <Field label="Account Holder Name" required><input className={inp} value={form.accountHolderName} onChange={e => s('accountHolderName', e.target.value)} placeholder="As per bank records"/></Field>
      <Field label="Account Number" required><input className={inp} value={form.accountNumber} onChange={e => s('accountNumber', e.target.value)} placeholder="Account number"/></Field>
      <Field label="IFSC Code" required><input className={inp} value={form.ifscCode} onChange={e => s('ifscCode', e.target.value.toUpperCase())} placeholder="e.g. HDFC0001234"/></Field>
      <Field label="Bank Name" required><input className={inp} value={form.bankName} onChange={e => s('bankName', e.target.value)} placeholder="e.g. HDFC Bank"/></Field>
      <Field label="Branch Name"><input className={inp} value={form.branchName} onChange={e => s('branchName', e.target.value)} placeholder="Branch name"/></Field>
      <Field label="Account Type">
        <select className={sel} value={form.accountType} onChange={e => s('accountType', e.target.value)}>
          <option value="SAVINGS">Savings</option>
          <option value="CURRENT">Current</option>
        </select>
      </Field>
      <div className="flex items-center gap-2 mt-1">
        <input type="checkbox" id="isPrimary" checked={form.isPrimary} onChange={e => s('isPrimary', e.target.checked)} className="w-4 h-4 rounded"/>
        <label htmlFor="isPrimary" className="text-sm text-slate-600 cursor-pointer">Mark as primary account (used for salary transfer)</label>
      </div>
    </div>
  )

  return (
    <div className="space-y-4">
      {error && <Alert type="error" message={error}/>}

      {adding && (
        <div className="border border-brand-200 rounded-2xl p-4 bg-brand-50/30">
          <p className="text-sm font-semibold text-slate-700">Add Bank Account</p>
          <FormFields/>
          <div className="flex gap-2 mt-3 justify-end">
            <Button variant="secondary" icon={<X size={14}/>} onClick={() => setAdding(false)}>Cancel</Button>
            <Button icon={<Save size={14}/>} loading={addMut.isPending} onClick={() => { setError(''); addMut.mutate() }}>Add Account</Button>
          </div>
        </div>
      )}

      {!accounts?.length && !adding ? (
        <div className="text-center py-12 text-slate-400">
          <CreditCard size={32} className="mx-auto mb-3 opacity-30"/>
          <p className="text-sm">No bank accounts added.</p>
          {isHR && <Button className="mt-4" icon={<Plus size={14}/>} onClick={() => setAdding(true)}>Add Bank Account</Button>}
        </div>
      ) : (
        <div className="space-y-3">
          {accounts?.map((a: any) => (
            <div key={a.id} className={`border rounded-2xl overflow-hidden ${a.isPrimary ? 'border-brand-300 bg-brand-50/20' : 'border-slate-200'}`}>
              {editing === a.id ? (
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
                    <div className="flex items-center gap-2 mb-1">
                      <p className="font-semibold text-slate-800 text-sm">{a.bankName}</p>
                      {a.isPrimary && <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-brand-100 text-brand-700 border border-brand-200"><Star size={10} className="fill-current"/>Primary</span>}
                      <span className="text-xs text-slate-400">{a.accountType}</span>
                    </div>
                    <p className="text-sm text-slate-600">{a.accountHolderName}</p>
                    <div className="flex gap-3 mt-1 text-xs text-slate-500">
                      <span>Acc: {maskAcc(a.accountNumber)}</span>
                      <span>IFSC: {a.ifscCode}</span>
                      {a.branchName && <span>{a.branchName}</span>}
                    </div>
                  </div>
                  {isHR && (
                    <div className="flex gap-2 flex-shrink-0">
                      <button onClick={() => startEdit(a)} className="p-2 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-700"><Edit2 size={14}/></button>
                      <button onClick={() => delMut.mutate(a.id)} className="p-2 rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-600"><Trash2 size={14}/></button>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {isHR && !adding && accounts?.length > 0 && (
        <Button variant="secondary" icon={<Plus size={14}/>} onClick={() => setAdding(true)}>Add Another Account</Button>
      )}
    </div>
  )
}
