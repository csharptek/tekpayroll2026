import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Plus, Eye } from 'lucide-react'
import { loanApi, employeeApi } from '../../services/api'
import { PageHeader, Button, Card, Modal, Alert, Skeleton, Table, Th, Td, Tr, EmptyState, Rupee, StatusBadge, Input } from '../../components/ui'
import { DatePicker } from '../../components/DatePicker'
import { format } from 'date-fns'

export default function LoansPage() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [addOpen, setAddOpen] = useState(false)
  const [closeTarget, setCloseTarget] = useState<any>(null)
  const [form, setForm] = useState({ employeeId: '', principalAmount: '', tenureMonths: '', emiAmount: '', disbursedOn: '', purpose: '' })

  const { data: loans, isLoading } = useQuery({
    queryKey: ['loans'],
    queryFn: () => loanApi.list().then(r => r.data.data),
  })

  const { data: employees } = useQuery({
    queryKey: ['employees-active'],
    queryFn: () => employeeApi.list({ status: 'ACTIVE', limit: 200 }).then(r => r.data.data),
  })

  const createMut = useMutation({
    mutationFn: () => loanApi.create({ ...form, principalAmount: parseFloat(form.principalAmount), tenureMonths: parseInt(form.tenureMonths), emiAmount: parseFloat(form.emiAmount) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['loans'] }); setAddOpen(false); setForm({ employeeId: '', principalAmount: '', tenureMonths: '', emiAmount: '', disbursedOn: '', purpose: '' }) },
  })

  const closeMut = useMutation({
    mutationFn: (id: string) => loanApi.close(id, 'Manually closed by HR'),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['loans'] }); setCloseTarget(null) },
  })

  const activeLoanTotal = (loans || []).filter((l: any) => l.status === 'ACTIVE').reduce((s: number, l: any) => s + Number(l.outstandingBalance), 0)

  return (
    <div className="space-y-5">
      <PageHeader title="Loans & Advances" subtitle="Manage employee loans and EMI deductions"
        actions={<Button icon={<Plus size={14} />} onClick={() => setAddOpen(true)}>Create Loan</Button>}
      />

      <div className="grid grid-cols-3 gap-4">
        {[
          { label: 'Active Loans', value: (loans || []).filter((l: any) => l.status === 'ACTIVE').length },
          { label: 'Total Outstanding', value: <Rupee amount={activeLoanTotal} /> },
          { label: 'Closed Loans', value: (loans || []).filter((l: any) => l.status === 'CLOSED').length },
        ].map(({ label, value }) => (
          <div key={label} className="card p-4">
            <p className="stat-label">{label}</p>
            <p className="text-xl font-display font-bold text-slate-900 mt-1">{value}</p>
          </div>
        ))}
      </div>

      <Card>
        {isLoading ? <Skeleton className="h-64 m-4" /> : !loans?.length ? (
          <EmptyState icon={<Plus size={20} />} title="No loans yet"
            action={<Button size="sm" icon={<Plus size={13} />} onClick={() => setAddOpen(true)}>Create First Loan</Button>} />
        ) : (
          <Table>
            <thead><tr className="border-b border-slate-100">
              <Th>Employee</Th><Th className="text-right">Principal</Th><Th className="text-right">Outstanding</Th>
              <Th className="text-right">EMI/month</Th><Th>Disbursed</Th><Th>Status</Th><Th>Actions</Th>
            </tr></thead>
            <tbody>
              {loans.map((loan: any) => (
                <Tr key={loan.id}>
                  <Td>
                    <p className="font-medium text-slate-800">{loan.employee?.name}</p>
                    <p className="text-xs text-slate-400">{loan.purpose || 'Personal'}</p>
                  </Td>
                  <Td className="text-right"><Rupee amount={loan.principalAmount} /></Td>
                  <Td className="text-right">
                    <Rupee amount={loan.outstandingBalance}
                      className={Number(loan.outstandingBalance) > 0 ? 'text-red-600 font-bold' : 'text-emerald-600'} />
                  </Td>
                  <Td className="text-right"><Rupee amount={loan.emiAmount} /></Td>
                  <Td><span className="text-xs text-slate-500">{format(new Date(loan.disbursedOn), 'dd MMM yyyy')}</span></Td>
                  <Td><StatusBadge status={loan.status} /></Td>
                  <Td>
                    <div className="flex gap-2">
                      <Button variant="ghost" size="sm" onClick={() => navigate(`/hr/employees/${loan.employeeId}`)}>
                        <Eye size={13} />
                      </Button>
                      {loan.status === 'ACTIVE' && (
                        <Button variant="secondary" size="sm" onClick={() => setCloseTarget(loan)}>Close</Button>
                      )}
                    </div>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      {/* Create loan modal */}
      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="Create Loan / Advance"
        footer={<><Button variant="secondary" onClick={() => setAddOpen(false)}>Cancel</Button>
          <Button loading={createMut.isPending} disabled={!form.employeeId || !form.principalAmount} onClick={() => createMut.mutate()}>Create Loan</Button></>}>
        <div className="space-y-4">
          <div className="flex flex-col gap-1">
            <label className="label">Employee *</label>
            <select className="input" value={form.employeeId} onChange={e => setForm(f => ({ ...f, employeeId: e.target.value }))}>
              <option value="">Select employee…</option>
              {(employees || []).map((e: any) => <option key={e.id} value={e.id}>{e.name} ({e.employeeCode})</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input label="Principal Amount (₹) *" type="number" placeholder="100000" value={form.principalAmount} onChange={e => setForm(f => ({ ...f, principalAmount: e.target.value }))} />
            <Input label="Tenure (months) *" type="number" placeholder="12" value={form.tenureMonths} onChange={e => setForm(f => ({ ...f, tenureMonths: e.target.value }))} />
            <Input label="EMI per month (₹) *" type="number" placeholder="9000" value={form.emiAmount} onChange={e => setForm(f => ({ ...f, emiAmount: e.target.value }))} />
            <div>
              <label className="label">Disbursed On *</label>
              <DatePicker value={form.disbursedOn} onChange={v => setForm(f => ({ ...f, disbursedOn: v }))} />
            </div>
          </div>
          <Input label="Purpose" placeholder="e.g. Medical emergency" value={form.purpose} onChange={e => setForm(f => ({ ...f, purpose: e.target.value }))} />
          {createMut.isError && <Alert type="error" message="Failed to create loan" />}
        </div>
      </Modal>

      {/* Close confirm */}
      <Modal open={!!closeTarget} onClose={() => setCloseTarget(null)} title="Close Loan"
        footer={<><Button variant="secondary" onClick={() => setCloseTarget(null)}>Cancel</Button>
          <Button variant="danger" loading={closeMut.isPending} onClick={() => closeMut.mutate(closeTarget.id)}>Close Loan</Button></>}>
        <p className="text-sm text-slate-600">
          Close loan for <strong>{closeTarget?.employee?.name}</strong>?
          Outstanding balance of <strong><Rupee amount={closeTarget?.outstandingBalance || 0} /></strong> will be waived.
        </p>
      </Modal>
    </div>
  )
}
