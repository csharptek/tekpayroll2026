import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Plus, Trash2 } from 'lucide-react'
import { reimbursementApi, employeeApi, payrollApi } from '../../services/api'
import { PageHeader, Button, Card, Modal, Alert, Skeleton, Table, Th, Td, Tr, EmptyState, Rupee, Input } from '../../components/ui'

const CATEGORIES = ['Travel', 'Medical', 'Internet/Phone', 'Food', 'Equipment', 'Other']

export default function ReimbursementsPage() {
  const { id: cycleId } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [addOpen, setAddOpen] = useState(false)
  const [form, setForm] = useState({ employeeId: '', category: 'Travel', amount: '', notes: '' })
  const [deleteId, setDeleteId] = useState<string | null>(null)

  const { data: cycle } = useQuery({
    queryKey: ['payroll-cycles'],
    queryFn: () => payrollApi.cycles().then(r => r.data.data.find((c: any) => c.id === cycleId)),
    enabled: !!cycleId,
  })

  const { data: employees } = useQuery({
    queryKey: ['employees-active'],
    queryFn: () => employeeApi.list({ status: 'ACTIVE', limit: 200 }).then(r => r.data.data),
  })

  const { data: items, isLoading } = useQuery({
    queryKey: ['reimbursements', cycleId],
    queryFn: () => reimbursementApi.list(cycleId!).then(r => r.data.data),
    enabled: !!cycleId,
  })

  const addMut = useMutation({
    mutationFn: () => reimbursementApi.create({ cycleId, ...form, amount: parseFloat(form.amount) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['reimbursements', cycleId] }); setAddOpen(false); setForm({ employeeId: '', category: 'Travel', amount: '', notes: '' }) },
  })

  const delMut = useMutation({
    mutationFn: (id: string) => reimbursementApi.delete(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['reimbursements', cycleId] }); setDeleteId(null) },
  })

  const total = (items || []).reduce((s: number, r: any) => s + Number(r.amount), 0)

  return (
    <div className="space-y-5 max-w-5xl">
      <PageHeader title="Reimbursements" subtitle={`Cycle: ${(cycle as any)?.payrollMonth || cycleId}`}
        actions={<div className="flex gap-2">
          <Button variant="ghost" icon={<ArrowLeft size={14} />} onClick={() => navigate('/hr/payroll')}>Back</Button>
          <Button icon={<Plus size={14} />} onClick={() => setAddOpen(true)}>Add</Button>
        </div>}
      />
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: 'Total Entries', value: items?.length ?? 0 },
          { label: 'Total Amount', value: <Rupee amount={total} /> },
          { label: 'Employees', value: new Set((items || []).map((r: any) => r.employeeId)).size },
        ].map(({ label, value }) => (
          <div key={label} className="card p-4">
            <p className="stat-label">{label}</p>
            <p className="text-xl font-display font-bold text-slate-900 mt-1">{value}</p>
          </div>
        ))}
      </div>
      <Card>
        {isLoading ? <Skeleton className="h-48 m-4" /> : !items?.length ? (
          <EmptyState icon={<Plus size={20} />} title="No reimbursements yet"
            action={<Button size="sm" icon={<Plus size={13} />} onClick={() => setAddOpen(true)}>Add Entry</Button>} />
        ) : (
          <Table>
            <thead><tr className="border-b border-slate-100">
              <Th>Employee</Th><Th>Category</Th><Th className="text-right">Amount</Th><Th>Notes</Th><Th></Th>
            </tr></thead>
            <tbody>
              {items.map((r: any) => (
                <Tr key={r.id}>
                  <Td><p className="font-medium text-slate-800">{r.employee?.name}</p><p className="text-xs text-slate-400">{r.employee?.employeeCode}</p></Td>
                  <Td><span className="badge badge-blue">{r.category}</span></Td>
                  <Td className="text-right font-semibold"><Rupee amount={r.amount} /></Td>
                  <Td><span className="text-xs text-slate-500">{r.notes || '—'}</span></Td>
                  <Td><button onClick={() => setDeleteId(r.id)} className="p-1.5 rounded-lg hover:bg-red-50 text-slate-300 hover:text-red-500"><Trash2 size={13} /></button></Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="Add Reimbursement"
        footer={<><Button variant="secondary" onClick={() => setAddOpen(false)}>Cancel</Button><Button loading={addMut.isPending} disabled={!form.employeeId || !form.amount} onClick={() => addMut.mutate()}>Add</Button></>}>
        <div className="space-y-4">
          <div className="flex flex-col gap-1">
            <label className="label">Employee *</label>
            <select className="input" value={form.employeeId} onChange={e => setForm(f => ({ ...f, employeeId: e.target.value }))}>
              <option value="">Select employee…</option>
              {(employees || []).map((e: any) => <option key={e.id} value={e.id}>{e.name} ({e.employeeCode})</option>)}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="label">Category *</label>
            <select className="input" value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}>
              {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <Input label="Amount (₹) *" type="number" placeholder="e.g. 2500" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} />
          <Input label="Notes" placeholder="Optional" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
        </div>
      </Modal>
      <Modal open={!!deleteId} onClose={() => setDeleteId(null)} title="Remove Reimbursement"
        footer={<><Button variant="secondary" onClick={() => setDeleteId(null)}>Cancel</Button><Button variant="danger" loading={delMut.isPending} onClick={() => delMut.mutate(deleteId!)}>Remove</Button></>}>
        <p className="text-sm text-slate-600">Remove this reimbursement? It will be excluded from net salary.</p>
      </Modal>
    </div>
  )
}
