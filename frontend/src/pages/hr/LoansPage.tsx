import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Plus, Eye, Check, X } from 'lucide-react'
import { loanApi, employeeApi } from '../../services/api'
import {
  PageHeader, Button, Card, Modal, Alert, Skeleton, Table, Th, Td, Tr,
  EmptyState, Rupee, StatusBadge, Input,
} from '../../components/ui'
import { DatePicker } from '../../components/DatePicker'
import { format } from 'date-fns'

type Tab = 'pending' | 'active' | 'closed'

export default function LoansPage() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [tab, setTab]                 = useState<Tab>('pending')
  const [addOpen, setAddOpen]         = useState(false)
  const [approveTarget, setApprove]   = useState<any>(null)
  const [rejectTarget, setReject]     = useState<any>(null)
  const [closeTarget, setCloseTarget] = useState<any>(null)

  const { data: loans, isLoading } = useQuery({
    queryKey: ['loans'],
    queryFn: () => loanApi.list().then(r => r.data.data),
  })

  const pending = (loans || []).filter((l: any) => l.status === 'PENDING_APPROVAL')
  const active  = (loans || []).filter((l: any) => l.status === 'ACTIVE')
  const closed  = (loans || []).filter((l: any) => ['CLOSED', 'REJECTED', 'WRITTEN_OFF'].includes(l.status))
  const shown   = tab === 'pending' ? pending : tab === 'active' ? active : closed

  const activeLoanTotal = active.reduce((s: number, l: any) => s + Number(l.outstandingBalance), 0)

  const rejectMut = useMutation({
    mutationFn: ({ id, reason }: any) => loanApi.reject(id, reason),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['loans'] }); setReject(null) },
  })

  const closeMut = useMutation({
    mutationFn: ({ id, note }: any) => loanApi.close(id, note),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['loans'] }); setCloseTarget(null) },
  })

  return (
    <div className="space-y-5">
      <PageHeader
        title="Loans & Advances"
        subtitle="Manage employee loans, approvals, and EMI schedules"
        actions={<Button icon={<Plus size={14} />} onClick={() => setAddOpen(true)}>Direct Create</Button>}
      />

      <div className="grid grid-cols-4 gap-4">
        {[
          { label: 'Pending Approval',  value: pending.length,   color: 'text-amber-600'   },
          { label: 'Active Loans',      value: active.length,    color: 'text-brand-600'   },
          { label: 'Total Outstanding', value: <Rupee amount={activeLoanTotal} />, color: 'text-slate-800' },
          { label: 'Closed / Rejected', value: closed.length,    color: 'text-slate-800'   },
        ].map(({ label, value, color }) => (
          <div key={label} className="card p-4">
            <p className="stat-label">{label}</p>
            <p className={`text-xl font-display font-bold mt-1 ${color}`}>{value}</p>
          </div>
        ))}
      </div>

      <div className="flex gap-1 border-b border-slate-200">
        {([
          { id: 'pending' as Tab, label: `Pending (${pending.length})` },
          { id: 'active'  as Tab, label: `Active (${active.length})`   },
          { id: 'closed'  as Tab, label: `Closed (${closed.length})`   },
        ]).map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === t.id ? 'border-brand-600 text-brand-600' : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <Card>
        {isLoading ? <Skeleton className="h-64 m-4" /> : !shown.length ? (
          <EmptyState icon={<Plus size={20} />} title={`No ${tab} loans`} />
        ) : (
          <Table>
            <thead><tr className="border-b border-slate-100">
              <Th>Employee</Th><Th>Type</Th><Th className="text-right">Principal</Th>
              <Th className="text-right">Outstanding</Th><Th className="text-right">EMI</Th>
              <Th>{tab === 'pending' ? 'Requested' : 'Disbursed'}</Th>
              <Th>Status</Th><Th>Actions</Th>
            </tr></thead>
            <tbody>
              {shown.map((loan: any) => (
                <Tr key={loan.id}>
                  <Td>
                    <p className="font-medium text-slate-800">{loan.employee?.name}</p>
                    <p className="text-xs text-slate-400">{loan.purpose || '—'}</p>
                  </Td>
                  <Td><span className="text-xs">{loan.type === 'SALARY_ADVANCE' ? 'Advance' : 'Loan'}</span></Td>
                  <Td className="text-right"><Rupee amount={loan.principalAmount} /></Td>
                  <Td className="text-right">
                    <Rupee amount={loan.outstandingBalance}
                      className={Number(loan.outstandingBalance) > 0 ? 'text-red-600 font-bold' : 'text-emerald-600'} />
                  </Td>
                  <Td className="text-right"><Rupee amount={loan.emiAmount} /></Td>
                  <Td>
                    <span className="text-xs text-slate-500">
                      {loan.status === 'PENDING_APPROVAL'
                        ? (loan.requestedAt ? format(new Date(loan.requestedAt), 'dd MMM yyyy') : '—')
                        : (loan.disbursedOn ? format(new Date(loan.disbursedOn), 'dd MMM yyyy') : '—')}
                    </span>
                  </Td>
                  <Td><StatusBadge status={loan.status} /></Td>
                  <Td>
                    <div className="flex gap-1.5">
                      {loan.status === 'PENDING_APPROVAL' && (
                        <>
                          <Button variant="primary" size="sm" onClick={() => setApprove(loan)} icon={<Check size={13} />}>Approve</Button>
                          <Button variant="secondary" size="sm" onClick={() => setReject(loan)} icon={<X size={13} />}>Reject</Button>
                        </>
                      )}
                      {loan.status === 'ACTIVE' && (
                        <>
                          <Button variant="ghost" size="sm" onClick={() => navigate(`/hr/loans/${loan.id}`)} icon={<Eye size={13} />}>View</Button>
                          <Button variant="secondary" size="sm" onClick={() => setCloseTarget(loan)}>Close</Button>
                        </>
                      )}
                      {closed.includes(loan) && (
                        <Button variant="ghost" size="sm" onClick={() => navigate(`/hr/loans/${loan.id}`)} icon={<Eye size={13} />}>View</Button>
                      )}
                    </div>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      {addOpen && <CreateLoanModal onClose={() => setAddOpen(false)} />}
      {approveTarget && <ApproveModal loan={approveTarget} onClose={() => setApprove(null)} />}

      <Modal open={!!rejectTarget} onClose={() => setReject(null)} title="Reject Loan Request"
        footer={<>
          <Button variant="secondary" onClick={() => setReject(null)}>Cancel</Button>
          <Button variant="danger" loading={rejectMut.isPending}
            onClick={() => rejectMut.mutate({ id: rejectTarget.id, reason: (document.getElementById('reject-reason') as HTMLInputElement)?.value || '' })}>
            Reject
          </Button>
        </>}>
        <p className="text-sm text-slate-600 mb-3">
          Reject {rejectTarget?.type === 'SALARY_ADVANCE' ? 'advance' : 'loan'} request from <strong>{rejectTarget?.employee?.name}</strong>?
        </p>
        <label className="label">Reason (optional)</label>
        <input id="reject-reason" className="input" placeholder="Reason for rejection" />
      </Modal>

      <Modal open={!!closeTarget} onClose={() => setCloseTarget(null)} title="Close Loan"
        footer={<>
          <Button variant="secondary" onClick={() => setCloseTarget(null)}>Cancel</Button>
          <Button variant="danger" loading={closeMut.isPending}
            onClick={() => closeMut.mutate({ id: closeTarget.id, note: (document.getElementById('close-note') as HTMLInputElement)?.value || 'Manually closed' })}>
            Close Loan
          </Button>
        </>}>
        <p className="text-sm text-slate-600 mb-3">
          Close loan for <strong>{closeTarget?.employee?.name}</strong>?
          Outstanding of <strong><Rupee amount={closeTarget?.outstandingBalance || 0} /></strong> will be waived.
        </p>
        <label className="label">Closure note</label>
        <input id="close-note" className="input" defaultValue="Manually closed by admin" />
      </Modal>
    </div>
  )
}

// ─── CREATE LOAN MODAL (direct — historical/imported) ────────────────────────

function CreateLoanModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient()
  const [form, setForm] = useState({
    employeeId: '', type: 'LOAN', principalAmount: '', tenureMonths: '',
    emiAmount: '', disbursedOn: '', purpose: '',
  })

  const { data: employees } = useQuery({
    queryKey: ['employees-active'],
    queryFn: () => employeeApi.list({ status: 'ACTIVE', limit: 200 }).then(r => r.data.data),
  })

  const mut = useMutation({
    mutationFn: () => loanApi.create({
      ...form,
      principalAmount: parseFloat(form.principalAmount),
      tenureMonths:    parseInt(form.tenureMonths),
      emiAmount:       parseFloat(form.emiAmount),
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['loans'] }); onClose() },
  })

  return (
    <Modal open onClose={onClose} title="Create Loan / Advance (Direct)"
      footer={<>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button loading={mut.isPending}
          disabled={!form.employeeId || !form.principalAmount || !form.tenureMonths || !form.emiAmount || !form.disbursedOn}
          onClick={() => mut.mutate()}>
          Create
        </Button>
      </>}>
      <div className="space-y-3">
        <p className="text-xs text-slate-400 bg-slate-50 p-2 rounded">
          For historical/imported loans. Auto-approved and active immediately. Use pending queue for employee requests.
        </p>
        <div className="flex flex-col gap-1">
          <label className="label">Employee *</label>
          <select className="input" value={form.employeeId} onChange={e => setForm(f => ({ ...f, employeeId: e.target.value }))}>
            <option value="">Select employee…</option>
            {(employees || []).map((e: any) => <option key={e.id} value={e.id}>{e.name} ({e.employeeCode})</option>)}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="label">Type</label>
          <select className="input" value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}>
            <option value="LOAN">Loan</option>
            <option value="SALARY_ADVANCE">Salary Advance</option>
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Input label="Principal (₹) *"   type="number" value={form.principalAmount} onChange={e => setForm(f => ({ ...f, principalAmount: e.target.value }))} />
          <Input label="Tenure (months) *" type="number" value={form.tenureMonths}    onChange={e => setForm(f => ({ ...f, tenureMonths:    e.target.value }))} />
          <Input label="EMI/month (₹) *"   type="number" value={form.emiAmount}       onChange={e => setForm(f => ({ ...f, emiAmount:       e.target.value }))} />
          <div>
            <label className="label">Disbursed On *</label>
            <DatePicker value={form.disbursedOn} onChange={v => setForm(f => ({ ...f, disbursedOn: v }))} />
          </div>
        </div>
        <Input label="Purpose" value={form.purpose} onChange={e => setForm(f => ({ ...f, purpose: e.target.value }))} />
        {mut.isError && <Alert type="error" message="Failed to create loan" />}
      </div>
    </Modal>
  )
}

// ─── APPROVE MODAL ───────────────────────────────────────────────────────────

function ApproveModal({ loan, onClose }: { loan: any; onClose: () => void }) {
  const qc = useQueryClient()
  const [emi, setEmi]           = useState(String(loan.emiAmount))
  const [tenure, setTenure]     = useState(String(loan.tenureMonths))
  const [disbursed, setDisburse] = useState(format(new Date(), 'yyyy-MM-dd'))

  const mut = useMutation({
    mutationFn: () => loanApi.approve(loan.id, {
      emiAmount:    parseFloat(emi),
      tenureMonths: parseInt(tenure),
      disbursedOn:  disbursed,
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['loans'] }); onClose() },
  })

  return (
    <Modal open onClose={onClose} title="Approve Loan Request"
      footer={<>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button loading={mut.isPending} onClick={() => mut.mutate()}>Approve & Disburse</Button>
      </>}>
      <div className="space-y-3">
        <div className="bg-slate-50 rounded-lg p-3 text-sm space-y-1">
          <div className="flex justify-between"><span className="text-slate-500">Employee</span><strong>{loan.employee?.name}</strong></div>
          <div className="flex justify-between"><span className="text-slate-500">Type</span><strong>{loan.type === 'SALARY_ADVANCE' ? 'Salary Advance' : 'Loan'}</strong></div>
          <div className="flex justify-between"><span className="text-slate-500">Requested amount</span><strong><Rupee amount={loan.principalAmount} /></strong></div>
          {loan.purpose && <div className="flex justify-between"><span className="text-slate-500">Purpose</span><span>{loan.purpose}</span></div>}
          <div className="flex justify-between"><span className="text-slate-500">Employee suggested EMI</span><span><Rupee amount={loan.emiAmount} /> × {loan.tenureMonths}m</span></div>
        </div>

        <p className="text-xs text-slate-500">Adjust final terms below:</p>

        <div className="grid grid-cols-2 gap-3">
          <Input label="Final EMI (₹) *"   type="number" value={emi}    onChange={e => setEmi(e.target.value)} />
          <Input label="Final tenure (m) *" type="number" value={tenure} onChange={e => setTenure(e.target.value)} />
        </div>
        <div>
          <label className="label">Disbursement date *</label>
          <DatePicker value={disbursed} onChange={setDisburse} />
        </div>
        {mut.isError && <Alert type="error" message="Failed to approve" />}
      </div>
    </Modal>
  )
}
