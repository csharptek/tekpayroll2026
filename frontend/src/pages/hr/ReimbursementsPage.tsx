import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Receipt, Plus, X, Check, XCircle, Search, Trash2,
  ImageIcon, FileText, Paperclip, Pencil,
} from 'lucide-react'
import { reimbursementApi, employeeApi } from '../../services/api'
import {
  PageHeader, Card, Rupee, EmptyState, Skeleton, StatusBadge,
  Button, Input, Alert, Table, Th, Td, Tr, SearchBar,
} from '../../components/ui'
import { format } from 'date-fns'
import { DatePicker } from '../../components/DatePicker'
import ReimbursementFileUploader from '../../components/ReimbursementFileUploader'

const CATEGORIES = ['Travel', 'Medical', 'Internet/Phone', 'Food', 'Equipment', 'Training', 'Other']

// ─── SHARED: FILE LIST ───────────────────────────────────────────────────────

function FileList({ files, onDelete }: { files: any[]; onDelete?: (id: string) => void }) {
  if (!files?.length) return <div className="text-xs text-slate-400">No attachments</div>
  return (
    <div className="space-y-1.5">
      {files.map(f => (
        <div key={f.id} className="flex items-center gap-2 px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg">
          {f.mimeType?.startsWith('image/')
            ? <ImageIcon size={14} className="text-slate-500" />
            : <FileText  size={14} className="text-slate-500" />}
          <a href={f.blobUrl} target="_blank" rel="noreferrer"
             className="text-xs text-slate-700 flex-1 truncate hover:text-blue-600">
            {f.fileName}
          </a>
          <span className="text-xs text-slate-400">{(f.sizeBytes / 1024).toFixed(0)} KB</span>
          <a href={f.blobUrl} target="_blank" rel="noreferrer" className="text-slate-400 hover:text-slate-700">
            <Paperclip size={12} />
          </a>
          {onDelete && (
            <button onClick={() => onDelete(f.id)} className="text-slate-400 hover:text-rose-600">
              <Trash2 size={12} />
            </button>
          )}
        </div>
      ))}
    </div>
  )
}

// ─── APPROVE MODAL ───────────────────────────────────────────────────────────

function ApproveModal({ reimb, onClose }: { reimb: any; onClose: () => void }) {
  const qc = useQueryClient()
  const [cycleId, setCycleId]       = useState('')
  const [payslipLabel, setLabel]    = useState(`${reimb.category} reimbursement`)
  const [amount, setAmount]         = useState(String(reimb.amount))
  const [error, setError]           = useState('')

  const { data: cycles } = useQuery({
    queryKey: ['open-cycles'],
    queryFn:  () => reimbursementApi.openCycles().then(r => r.data.data),
  })

  const mut = useMutation({
    mutationFn: () => reimbursementApi.approve(reimb.id, {
      cycleId, payslipLabel, amount: Number(amount),
    }),
    onSuccess:  () => { qc.invalidateQueries({ queryKey: ['sa-reimbursements'] }); onClose() },
    onError:    (e: any) => setError(e?.response?.data?.error || 'Failed'),
  })

  function submit() {
    setError('')
    if (!cycleId) return setError('Select a payroll cycle')
    if (!payslipLabel.trim()) return setError('Payslip label is required')
    if (!amount || Number(amount) <= 0) return setError('Invalid amount')
    mut.mutate()
  }

  return (
    <ModalShell title="Approve reimbursement" onClose={onClose}>
      <div className="space-y-3">
        <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
          <div className="text-sm font-medium text-slate-800">{reimb.employee?.name}</div>
          <div className="text-xs text-slate-500">{reimb.employee?.employeeCode} · {reimb.category}</div>
          <div className="text-xs text-slate-500 mt-1">Requested: <Rupee amount={Number(reimb.amount)} /></div>
        </div>

        <div>
          <label className="text-xs font-medium text-slate-500 mb-1 block">Payroll cycle <span className="text-rose-500">*</span></label>
          <select className="input" value={cycleId} onChange={e => setCycleId(e.target.value)}>
            <option value="">Select a cycle…</option>
            {(cycles || []).map((c: any) => (
              <option key={c.id} value={c.id}>
                {c.payrollMonth} — {c.status}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="text-xs font-medium text-slate-500 mb-1 block">Amount to approve (₹) <span className="text-rose-500">*</span></label>
          <Input type="number" inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} />
        </div>

        <div>
          <label className="text-xs font-medium text-slate-500 mb-1 block">Payslip label <span className="text-rose-500">*</span></label>
          <Input value={payslipLabel} onChange={e => setLabel(e.target.value)} placeholder="Travel reimbursement — Aug 2026" />
          <p className="text-xs text-slate-500 mt-1">Shown as a line item on the employee's payslip.</p>
        </div>

        {error && <Alert type="error" message={error} />}
      </div>

      <div className="flex justify-end gap-2 mt-5">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button icon={<Check size={14} />} onClick={submit} disabled={mut.isPending}>
          {mut.isPending ? 'Approving…' : 'Approve'}
        </Button>
      </div>
    </ModalShell>
  )
}

// ─── REJECT MODAL ────────────────────────────────────────────────────────────

function RejectModal({ reimb, onClose }: { reimb: any; onClose: () => void }) {
  const qc = useQueryClient()
  const [reason, setReason] = useState('')
  const [error, setError]   = useState('')

  const mut = useMutation({
    mutationFn: () => reimbursementApi.reject(reimb.id, reason),
    onSuccess:  () => { qc.invalidateQueries({ queryKey: ['sa-reimbursements'] }); onClose() },
    onError:    (e: any) => setError(e?.response?.data?.error || 'Failed'),
  })

  return (
    <ModalShell title="Reject reimbursement" onClose={onClose}>
      <div className="space-y-3">
        <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
          <div className="text-sm font-medium text-slate-800">{reimb.employee?.name}</div>
          <div className="text-xs text-slate-500">{reimb.category} · <Rupee amount={Number(reimb.amount)} /></div>
        </div>
        <div>
          <label className="text-xs font-medium text-slate-500 mb-1 block">Reason <span className="text-rose-500">*</span></label>
          <Input value={reason} onChange={e => setReason(e.target.value)} placeholder="Why is this being rejected?" />
        </div>
        {error && <Alert type="error" message={error} />}
      </div>
      <div className="flex justify-end gap-2 mt-5">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button
          icon={<XCircle size={14} />}
          onClick={() => { if (!reason.trim()) return setError('Reason required'); mut.mutate() }}
          disabled={mut.isPending}
        >
          {mut.isPending ? 'Rejecting…' : 'Reject'}
        </Button>
      </div>
    </ModalShell>
  )
}

// ─── SA DIRECT-ADD MODAL ─────────────────────────────────────────────────────

function DirectAddModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient()
  const [employeeId, setEmployeeId] = useState('')
  const [category, setCategory]     = useState('Travel')
  const [amount, setAmount]         = useState('')
  const [expenseDate, setExpenseDate] = useState('')
  const [description, setDescription] = useState('')
  const [notes, setNotes]           = useState('')
  const [cycleId, setCycleId]       = useState('')
  const [payslipLabel, setLabel]    = useState('')
  const [autoApprove, setAuto]      = useState(true)
  const [files, setFiles]           = useState<File[]>([])
  const [error, setError]           = useState('')

  const { data: employees } = useQuery({
    queryKey: ['employees-active'],
    queryFn:  () => employeeApi.list({ status: 'ACTIVE', limit: 500 }).then(r => r.data.data),
  })

  const { data: cycles } = useQuery({
    queryKey: ['open-cycles'],
    queryFn:  () => reimbursementApi.openCycles().then(r => r.data.data),
  })

  const mut = useMutation({
    mutationFn: (fd: FormData) => reimbursementApi.saAdd(fd),
    onSuccess:  () => { qc.invalidateQueries({ queryKey: ['sa-reimbursements'] }); onClose() },
    onError:    (e: any) => setError(e?.response?.data?.error || 'Failed'),
  })

  function submit() {
    setError('')
    if (!employeeId) return setError('Select employee')
    if (!amount || Number(amount) <= 0) return setError('Enter valid amount')
    if (autoApprove && !cycleId) return setError('Cycle is required when auto-approving')
    if (autoApprove && !payslipLabel.trim()) return setError('Payslip label is required when auto-approving')

    const fd = new FormData()
    fd.append('employeeId', employeeId)
    fd.append('category', category)
    fd.append('amount', String(Number(amount)))
    if (expenseDate)  fd.append('expenseDate', expenseDate)
    if (description)  fd.append('description', description)
    if (notes)        fd.append('notes', notes)
    if (cycleId)      fd.append('cycleId', cycleId)
    if (payslipLabel) fd.append('payslipLabel', payslipLabel)
    fd.append('autoApprove', String(autoApprove))
    files.forEach(f => fd.append('files', f))
    mut.mutate(fd)
  }

  return (
    <ModalShell title="Add reimbursement (SA)" onClose={onClose}>
      <div className="space-y-3">
        <div>
          <label className="text-xs font-medium text-slate-500 mb-1 block">Employee <span className="text-rose-500">*</span></label>
          <select className="input" value={employeeId} onChange={e => setEmployeeId(e.target.value)}>
            <option value="">Select employee…</option>
            {(employees || []).map((e: any) => (
              <option key={e.id} value={e.id}>{e.name} · {e.employeeCode}</option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-medium text-slate-500 mb-1 block">Category</label>
            <select className="input" value={category} onChange={e => setCategory(e.target.value)}>
              {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-slate-500 mb-1 block">Amount (₹) <span className="text-rose-500">*</span></label>
            <Input type="number" inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} />
          </div>
        </div>

        <div>
          <label className="text-xs font-medium text-slate-500 mb-1 block">Expense date</label>
          <DatePicker value={expenseDate} onChange={setExpenseDate} />
        </div>

        <div>
          <label className="text-xs font-medium text-slate-500 mb-1 block">Description</label>
          <Input value={description} onChange={e => setDescription(e.target.value)} />
        </div>

        <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
          <input type="checkbox" checked={autoApprove} onChange={e => setAuto(e.target.checked)} className="rounded border-slate-300" />
          Auto-approve and attach to a payroll cycle now
        </label>

        {autoApprove && (
          <div className="space-y-3 pl-4 border-l-2 border-blue-200">
            <div>
              <label className="text-xs font-medium text-slate-500 mb-1 block">Cycle <span className="text-rose-500">*</span></label>
              <select className="input" value={cycleId} onChange={e => setCycleId(e.target.value)}>
                <option value="">Select cycle…</option>
                {(cycles || []).map((c: any) => (
                  <option key={c.id} value={c.id}>{c.payrollMonth} — {c.status}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-slate-500 mb-1 block">Payslip label <span className="text-rose-500">*</span></label>
              <Input value={payslipLabel} onChange={e => setLabel(e.target.value)} placeholder="Travel reimbursement — Aug 2026" />
            </div>
          </div>
        )}

        <div>
          <label className="text-xs font-medium text-slate-500 mb-1 block">Internal notes</label>
          <Input value={notes} onChange={e => setNotes(e.target.value)} />
        </div>

        <div>
          <label className="text-xs font-medium text-slate-500 mb-1 block">Bills / receipts (up to 5)</label>
          <ReimbursementFileUploader files={files} onChange={setFiles} max={5} />
        </div>

        {error && <Alert type="error" message={error} />}
      </div>

      <div className="flex justify-end gap-2 mt-5">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button onClick={submit} disabled={mut.isPending}>
          {mut.isPending ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </ModalShell>
  )
}

// ─── EDIT MODAL (APPROVED, cycle not disbursed) ──────────────────────────────

function EditModal({ reimb, onClose }: { reimb: any; onClose: () => void }) {
  const qc = useQueryClient()
  const [cycleId, setCycleId]       = useState(reimb.cycleId || '')
  const [payslipLabel, setLabel]    = useState(reimb.payslipLabel || '')
  const [amount, setAmount]         = useState(String(reimb.amount))
  const [notes, setNotes]           = useState(reimb.notes || '')
  const [error, setError]           = useState('')

  const { data: cycles } = useQuery({
    queryKey: ['open-cycles'],
    queryFn:  () => reimbursementApi.openCycles().then(r => r.data.data),
  })

  const mut = useMutation({
    mutationFn: () => reimbursementApi.patch(reimb.id, {
      cycleId: cycleId || null,
      payslipLabel,
      amount: Number(amount),
      notes,
    }),
    onSuccess:  () => { qc.invalidateQueries({ queryKey: ['sa-reimbursements'] }); onClose() },
    onError:    (e: any) => setError(e?.response?.data?.error || 'Failed'),
  })

  return (
    <ModalShell title="Edit reimbursement" onClose={onClose}>
      <div className="space-y-3">
        <div>
          <label className="text-xs font-medium text-slate-500 mb-1 block">Cycle</label>
          <select className="input" value={cycleId} onChange={e => setCycleId(e.target.value)}>
            <option value="">(unassigned)</option>
            {(cycles || []).map((c: any) => (
              <option key={c.id} value={c.id}>{c.payrollMonth} — {c.status}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs font-medium text-slate-500 mb-1 block">Amount (₹)</label>
          <Input type="number" inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} />
        </div>
        <div>
          <label className="text-xs font-medium text-slate-500 mb-1 block">Payslip label</label>
          <Input value={payslipLabel} onChange={e => setLabel(e.target.value)} />
        </div>
        <div>
          <label className="text-xs font-medium text-slate-500 mb-1 block">Internal notes</label>
          <Input value={notes} onChange={e => setNotes(e.target.value)} />
        </div>
        {error && <Alert type="error" message={error} />}
      </div>
      <div className="flex justify-end gap-2 mt-5">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button onClick={() => mut.mutate()} disabled={mut.isPending}>
          {mut.isPending ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </ModalShell>
  )
}

// ─── DETAIL MODAL ────────────────────────────────────────────────────────────

function DetailModal({ id, onClose, onApprove, onReject, onEdit }: {
  id: string
  onClose: () => void
  onApprove: (r: any) => void
  onReject: (r: any) => void
  onEdit: (r: any) => void
}) {
  const qc = useQueryClient()
  const [error, setError] = useState('')

  const { data: reimb, isLoading } = useQuery({
    queryKey: ['reimb-detail', id],
    queryFn:  () => reimbursementApi.get(id).then(r => r.data.data),
  })

  const deleteMut = useMutation({
    mutationFn: () => reimbursementApi.delete(id),
    onSuccess:  () => { qc.invalidateQueries({ queryKey: ['sa-reimbursements'] }); onClose() },
    onError:    (e: any) => setError(e?.response?.data?.error || 'Failed'),
  })

  const deleteFileMut = useMutation({
    mutationFn: (fileId: string) => reimbursementApi.deleteFile(id, fileId),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ['reimb-detail', id] }),
  })

  return (
    <ModalShell title="Reimbursement details" onClose={onClose} wide>
      {isLoading && <Skeleton className="h-40" />}

      {reimb && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium text-slate-800">{reimb.employee?.name}</div>
              <div className="text-xs text-slate-500">{reimb.employee?.employeeCode} · {reimb.employee?.email}</div>
            </div>
            <StatusBadge status={reimb.status} />
          </div>

          <div className="grid grid-cols-2 gap-3 text-xs bg-slate-50 border border-slate-200 rounded-lg p-3">
            <Field label="Category" value={reimb.category} />
            <Field label="Amount" value={<Rupee amount={Number(reimb.amount)} />} />
            <Field label="Source" value={reimb.source} />
            <Field label="Expense date" value={reimb.expenseDate ? format(new Date(reimb.expenseDate), 'dd MMM yyyy') : '—'} />
            <Field label="Requested by" value={reimb.requestedByName} />
            <Field label="Requested at" value={format(new Date(reimb.requestedAt || reimb.createdAt), 'dd MMM yyyy')} />
            <Field label="Cycle" value={reimb.cycle?.payrollMonth || '—'} />
            <Field label="Payslip label" value={reimb.payslipLabel || '—'} />
          </div>

          {reimb.description && <Field label="Description" value={reimb.description} />}
          {reimb.notes && <Field label="Internal notes" value={reimb.notes} />}

          {reimb.status === 'APPROVED' && (
            <div className="text-xs text-emerald-700">
              Approved by {reimb.approvedByName} on {reimb.approvedAt ? format(new Date(reimb.approvedAt), 'dd MMM yyyy HH:mm') : '—'}
            </div>
          )}
          {reimb.status === 'REJECTED' && (
            <Alert type="error" title="Rejected" message={`${reimb.rejectionReason} (by ${reimb.rejectedByName})`} />
          )}

          <div>
            <div className="text-xs font-medium text-slate-500 mb-2">Attachments</div>
            <FileList
              files={reimb.files}
              onDelete={reimb.status !== 'PAID' ? (fid) => deleteFileMut.mutate(fid) : undefined}
            />
          </div>

          {error && <Alert type="error" message={error} />}

          <div className="flex flex-wrap justify-end gap-2 pt-3 border-t border-slate-200">
            {reimb.status === 'PENDING' && (
              <>
                <Button variant="ghost" icon={<XCircle size={14} />} onClick={() => onReject(reimb)}>Reject</Button>
                <Button icon={<Check size={14} />} onClick={() => onApprove(reimb)}>Approve</Button>
              </>
            )}
            {reimb.status === 'APPROVED' && reimb.cycle?.status !== 'DISBURSED' && (
              <Button variant="ghost" icon={<Pencil size={14} />} onClick={() => onEdit(reimb)}>Edit</Button>
            )}
            {reimb.status !== 'PAID' && reimb.cycle?.status !== 'DISBURSED' && (
              <Button
                variant="ghost"
                icon={<Trash2 size={14} />}
                onClick={() => { if (confirm('Delete this reimbursement permanently?')) deleteMut.mutate() }}
                disabled={deleteMut.isPending}
              >
                {deleteMut.isPending ? 'Deleting…' : 'Delete'}
              </Button>
            )}
          </div>
        </div>
      )}
    </ModalShell>
  )
}

function Field({ label, value }: { label: string; value: any }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-slate-400">{label}</div>
      <div className="text-sm text-slate-700">{value}</div>
    </div>
  )
}

// ─── MODAL SHELL ─────────────────────────────────────────────────────────────

function ModalShell({ title, children, onClose, wide }: { title: string; children: React.ReactNode; onClose: () => void; wide?: boolean }) {
  return (
    <div className="fixed inset-0 bg-black/40 z-40 flex items-center justify-center p-4">
      <Card className={`w-full ${wide ? 'max-w-2xl' : 'max-w-md'} max-h-[90vh] overflow-y-auto`}>
        <div className="p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-base font-semibold text-slate-800">{title}</h3>
            <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
          </div>
          {children}
        </div>
      </Card>
    </div>
  )
}

// ─── PAGE ────────────────────────────────────────────────────────────────────

export default function ReimbursementsPage() {
  const [statusFilter, setStatusFilter] = useState<string>('ALL')
  const [cycleFilter, setCycleFilter]   = useState<string>('')
  const [search, setSearch]             = useState('')

  const [detailId, setDetailId]    = useState<string | null>(null)
  const [approveFor, setApprove]   = useState<any>(null)
  const [rejectFor, setReject]     = useState<any>(null)
  const [editFor, setEdit]         = useState<any>(null)
  const [addOpen, setAddOpen]      = useState(false)

  const { data: items, isLoading } = useQuery({
    queryKey: ['sa-reimbursements', statusFilter, cycleFilter],
    queryFn:  () => reimbursementApi.listAll({
      status:  statusFilter === 'ALL' ? undefined : statusFilter,
      cycleId: cycleFilter || undefined,
    }).then(r => r.data.data as any[]),
  })

  const { data: cycles } = useQuery({
    queryKey: ['open-cycles'],
    queryFn:  () => reimbursementApi.openCycles().then(r => r.data.data),
  })

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return items || []
    return (items || []).filter(r =>
      r.employee?.name?.toLowerCase().includes(q) ||
      r.employee?.employeeCode?.toLowerCase().includes(q) ||
      r.category?.toLowerCase().includes(q) ||
      (r.description || '').toLowerCase().includes(q),
    )
  }, [items, search])

  const pendingCount  = (items || []).filter(r => r.status === 'PENDING').length
  const approvedTotal = (items || []).filter(r => r.status === 'APPROVED').reduce((s, r) => s + Number(r.amount), 0)
  const paidTotal     = (items || []).filter(r => r.status === 'PAID').reduce((s, r) => s + Number(r.amount), 0)

  return (
    <div className="space-y-5">
      <PageHeader
        title="Reimbursements"
        subtitle="Review employee requests and add reimbursements"
        actions={<Button icon={<Plus size={14} />} onClick={() => setAddOpen(true)}>Add reimbursement</Button>}
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatBox label="Pending review" value={pendingCount} accent="text-amber-700" />
        <StatBox label="Approved (not paid)" value={<Rupee amount={approvedTotal} />} accent="text-emerald-700" />
        <StatBox label="Paid" value={<Rupee amount={paidTotal} />} accent="text-slate-800" />
        <StatBox label="Total entries" value={items?.length ?? 0} />
      </div>

      <Card>
        <div className="p-3 flex flex-wrap gap-2 items-center border-b border-slate-100">
          <div className="flex-1 min-w-[200px]">
            <SearchBar value={search} onChange={setSearch} placeholder="Search by name, code, category…" />
          </div>
          <select className="input w-auto" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
            <option value="ALL">All statuses</option>
            <option value="PENDING">Pending</option>
            <option value="APPROVED">Approved</option>
            <option value="REJECTED">Rejected</option>
            <option value="PAID">Paid</option>
          </select>
          <select className="input w-auto" value={cycleFilter} onChange={e => setCycleFilter(e.target.value)}>
            <option value="">All cycles</option>
            {(cycles || []).map((c: any) => (
              <option key={c.id} value={c.id}>{c.payrollMonth}</option>
            ))}
          </select>
        </div>

        {isLoading && <Skeleton className="h-40 m-3" />}

        {!isLoading && filtered.length === 0 && (
          <EmptyState
            icon={<Receipt size={28} className="text-slate-400" />}
            title="No reimbursements"
            description="Nothing matches your filters."
          />
        )}

        {filtered.length > 0 && (
          <Table>
            <thead>
              <tr>
                <Th>Employee</Th>
                <Th>Category</Th>
                <Th>Amount</Th>
                <Th>Files</Th>
                <Th>Cycle</Th>
                <Th>Requested</Th>
                <Th>Status</Th>
                <Th>Actions</Th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(r => (
                <Tr key={r.id} onClick={() => setDetailId(r.id)}>
                  <Td>
                    <div className="text-sm font-medium text-slate-800">{r.employee?.name}</div>
                    <div className="text-xs text-slate-500">{r.employee?.employeeCode}</div>
                  </Td>
                  <Td>{r.category}</Td>
                  <Td><Rupee amount={Number(r.amount)} /></Td>
                  <Td>{r.files?.length || 0}</Td>
                  <Td>{r.cycle?.payrollMonth || '—'}</Td>
                  <Td className="text-xs text-slate-600">
                    {format(new Date(r.requestedAt || r.createdAt), 'dd MMM yyyy')}
                  </Td>
                  <Td><StatusBadge status={r.status} /></Td>
                  <Td>
                    <div className="flex gap-1" onClick={e => e.stopPropagation()}>
                      {r.status === 'PENDING' && (
                        <>
                          <Button variant="ghost" onClick={() => setApprove(r)}><Check size={14} /></Button>
                          <Button variant="ghost" onClick={() => setReject(r)}><XCircle size={14} /></Button>
                        </>
                      )}
                      {r.status === 'APPROVED' && r.cycle?.status !== 'DISBURSED' && (
                        <Button variant="ghost" onClick={() => setEdit(r)}><Pencil size={14} /></Button>
                      )}
                    </div>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      {addOpen && <DirectAddModal onClose={() => setAddOpen(false)} />}
      {detailId && (
        <DetailModal
          id={detailId}
          onClose={() => setDetailId(null)}
          onApprove={r => { setDetailId(null); setApprove(r) }}
          onReject={r => { setDetailId(null); setReject(r) }}
          onEdit={r => { setDetailId(null); setEdit(r) }}
        />
      )}
      {approveFor && <ApproveModal reimb={approveFor} onClose={() => setApprove(null)} />}
      {rejectFor  && <RejectModal  reimb={rejectFor}  onClose={() => setReject(null)} />}
      {editFor    && <EditModal    reimb={editFor}    onClose={() => setEdit(null)} />}
    </div>
  )
}

function StatBox({ label, value, accent }: { label: string; value: any; accent?: string }) {
  return (
    <Card className="p-4">
      <div className="text-xs text-slate-500 mb-1">{label}</div>
      <div className={`text-lg font-semibold ${accent || 'text-slate-800'}`}>{value}</div>
    </Card>
  )
}
