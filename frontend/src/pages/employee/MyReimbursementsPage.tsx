import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Receipt, Plus, X, Paperclip, Trash2, ImageIcon, FileText } from 'lucide-react'
import { reimbursementApi } from '../../services/api'
import {
  PageHeader, Card, Rupee, EmptyState, Skeleton, StatusBadge,
  Button, Input, Alert,
} from '../../components/ui'
import { format } from 'date-fns'
import { DatePicker } from '../../components/DatePicker'
import ReimbursementFileUploader from '../../components/ReimbursementFileUploader'

const CATEGORIES = ['Travel', 'Medical', 'Internet/Phone', 'Food', 'Equipment', 'Training', 'Other']

// ─── REQUEST MODAL ───────────────────────────────────────────────────────────

function RequestModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient()
  const [category, setCategory]       = useState('Travel')
  const [amount, setAmount]           = useState('')
  const [expenseDate, setExpenseDate] = useState('')
  const [description, setDescription] = useState('')
  const [files, setFiles]             = useState<File[]>([])
  const [error, setError]             = useState('')

  const mut = useMutation({
    mutationFn: (fd: FormData) => reimbursementApi.request(fd),
    onSuccess:  () => { qc.invalidateQueries({ queryKey: ['my-reimbursements'] }); onClose() },
    onError:    (e: any) => setError(e?.response?.data?.error || 'Failed to submit request'),
  })

  function submit() {
    setError('')
    if (!category) return setError('Select category')
    if (!amount || Number(amount) <= 0) return setError('Enter valid amount')

    const fd = new FormData()
    fd.append('category', category)
    fd.append('amount', String(Number(amount)))
    if (expenseDate) fd.append('expenseDate', expenseDate)
    if (description) fd.append('description', description)
    files.forEach(f => fd.append('files', f))
    mut.mutate(fd)
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-40 flex items-center justify-center p-4">
      <Card className="w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-base font-semibold text-slate-800">New Reimbursement Request</h3>
            <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
          </div>

          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium text-slate-500 mb-1 block">Category</label>
              <select className="input" value={category} onChange={e => setCategory(e.target.value)}>
                {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-slate-500 mb-1 block">Amount (₹)</label>
                <Input type="number" inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00" />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-500 mb-1 block">Expense date</label>
                <DatePicker value={expenseDate} onChange={setExpenseDate} />
              </div>
            </div>

            <div>
              <label className="text-xs font-medium text-slate-500 mb-1 block">Description</label>
              <Input value={description} onChange={e => setDescription(e.target.value)} placeholder="What was this for?" />
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
              {mut.isPending ? 'Submitting…' : 'Submit request'}
            </Button>
          </div>
        </div>
      </Card>
    </div>
  )
}

// ─── DETAIL DRAWER ───────────────────────────────────────────────────────────

function DetailModal({ id, onClose }: { id: string; onClose: () => void }) {
  const qc = useQueryClient()
  const [error, setError] = useState('')

  const { data: reimb, isLoading } = useQuery({
    queryKey: ['reimb-detail', id],
    queryFn:  () => reimbursementApi.get(id).then(r => r.data.data),
  })

  const withdrawMut = useMutation({
    mutationFn: () => reimbursementApi.withdraw(id),
    onSuccess:  () => { qc.invalidateQueries({ queryKey: ['my-reimbursements'] }); onClose() },
    onError:    (e: any) => setError(e?.response?.data?.error || 'Failed'),
  })

  return (
    <div className="fixed inset-0 bg-black/40 z-40 flex items-center justify-center p-4">
      <Card className="w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-base font-semibold text-slate-800">Reimbursement details</h3>
            <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
          </div>

          {isLoading && <Skeleton className="h-40" />}

          {reimb && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="text-lg font-semibold text-slate-800">
                  <Rupee amount={Number(reimb.amount)} />
                </div>
                <StatusBadge status={reimb.status} />
              </div>

              <div className="grid grid-cols-2 gap-3 text-xs">
                <Field label="Category" value={reimb.category} />
                <Field label="Expense date" value={reimb.expenseDate ? format(new Date(reimb.expenseDate), 'dd MMM yyyy') : '—'} />
                <Field label="Requested on" value={format(new Date(reimb.requestedAt || reimb.createdAt), 'dd MMM yyyy')} />
                <Field label="Payroll cycle" value={reimb.cycle?.payrollMonth || '—'} />
              </div>

              {reimb.description && <Field label="Description" value={reimb.description} />}
              {reimb.payslipLabel && <Field label="Payslip label" value={reimb.payslipLabel} />}
              {reimb.rejectionReason && <Alert type="error" title="Rejection reason" message={reimb.rejectionReason} />}

              <div>
                <div className="text-xs font-medium text-slate-500 mb-2">Attachments</div>
                {reimb.files?.length
                  ? <FileList files={reimb.files} />
                  : <div className="text-xs text-slate-400">No attachments</div>}
              </div>

              {error && <Alert type="error" message={error} />}

              {reimb.status === 'PENDING' && (
                <div className="pt-2 border-t border-slate-200">
                  <Button
                    variant="ghost"
                    onClick={() => withdrawMut.mutate()}
                    disabled={withdrawMut.isPending}
                    icon={<Trash2 size={14} />}
                  >
                    {withdrawMut.isPending ? 'Withdrawing…' : 'Withdraw request'}
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      </Card>
    </div>
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

export function FileList({ files }: { files: any[] }) {
  return (
    <div className="space-y-1.5">
      {files.map(f => (
        <a
          key={f.id}
          href={f.blobUrl}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-2 px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg hover:bg-slate-100"
        >
          {f.mimeType?.startsWith('image/')
            ? <ImageIcon size={14} className="text-slate-500" />
            : <FileText  size={14} className="text-slate-500" />}
          <span className="text-xs text-slate-700 flex-1 truncate">{f.fileName}</span>
          <span className="text-xs text-slate-400">{(f.sizeBytes / 1024).toFixed(0)} KB</span>
          <Paperclip size={12} className="text-slate-400" />
        </a>
      ))}
    </div>
  )
}

// ─── PAGE ────────────────────────────────────────────────────────────────────

export default function MyReimbursementsPage() {
  const [addOpen, setAddOpen]   = useState(false)
  const [detailId, setDetailId] = useState<string | null>(null)

  const { data: items, isLoading } = useQuery({
    queryKey: ['my-reimbursements'],
    queryFn:  () => reimbursementApi.my().then(r => r.data.data as any[]),
  })

  const pending  = (items || []).filter(r => r.status === 'PENDING')
  const approved = (items || []).filter(r => r.status === 'APPROVED' || r.status === 'PAID')
  const totalPending  = pending.reduce((s, r) => s + Number(r.amount), 0)
  const totalApproved = approved.reduce((s, r) => s + Number(r.amount), 0)

  return (
    <div className="space-y-5 max-w-5xl">
      <PageHeader
        title="My Reimbursements"
        subtitle="Submit and track reimbursement requests"
        actions={<Button icon={<Plus size={14} />} onClick={() => setAddOpen(true)}>New request</Button>}
      />

      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <Card className="p-4">
          <div className="text-xs text-slate-500 mb-1">Pending</div>
          <div className="text-lg font-semibold text-slate-800"><Rupee amount={totalPending} /></div>
          <div className="text-xs text-slate-400 mt-0.5">{pending.length} request(s)</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-slate-500 mb-1">Approved</div>
          <div className="text-lg font-semibold text-emerald-700"><Rupee amount={totalApproved} /></div>
          <div className="text-xs text-slate-400 mt-0.5">{approved.length} request(s)</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-slate-500 mb-1">Total requests</div>
          <div className="text-lg font-semibold text-slate-800">{items?.length ?? 0}</div>
        </Card>
      </div>

      {isLoading && <Skeleton className="h-40" />}

      {!isLoading && (!items || items.length === 0) && (
        <EmptyState
          icon={<Receipt size={28} className="text-slate-400" />}
          title="No reimbursement requests"
          description="Submit your first bill to get reimbursed in the next payroll cycle."
          action={<Button icon={<Plus size={14} />} onClick={() => setAddOpen(true)}>New request</Button>}
        />
      )}

      {items && items.length > 0 && (
        <Card>
          <div className="divide-y divide-slate-100">
            {items.map(r => (
              <button
                key={r.id}
                onClick={() => setDetailId(r.id)}
                className="w-full p-4 hover:bg-slate-50 text-left flex items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-slate-800 text-sm">{r.category}</span>
                    <StatusBadge status={r.status} />
                  </div>
                  <div className="text-xs text-slate-500 mt-0.5 truncate">
                    {r.description || '—'} · {format(new Date(r.requestedAt || r.createdAt), 'dd MMM yyyy')}
                    {r.files?.length ? ` · ${r.files.length} file(s)` : ''}
                  </div>
                  {r.cycle?.payrollMonth && (
                    <div className="text-xs text-slate-400 mt-0.5">Cycle: {r.cycle.payrollMonth}</div>
                  )}
                </div>
                <div className="font-semibold text-slate-800 shrink-0">
                  <Rupee amount={Number(r.amount)} />
                </div>
              </button>
            ))}
          </div>
        </Card>
      )}

      {addOpen && <RequestModal onClose={() => setAddOpen(false)} />}
      {detailId && <DetailModal id={detailId} onClose={() => setDetailId(null)} />}
    </div>
  )
}
