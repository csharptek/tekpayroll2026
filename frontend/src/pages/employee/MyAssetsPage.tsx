import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import { Plus } from 'lucide-react'
import { assetApi } from '../../services/api'
import { PageHeader, Card, Button, Modal, Alert, Skeleton, Table, Th, Td, Tr, StatusBadge, EmptyState } from '../../components/ui'

export default function MyAssetsPage() {
  const qc = useQueryClient()
  const [requestOpen, setRequestOpen] = useState(false)
  const [form, setForm] = useState({ type: 'NEEDED', assetId: '', category: '', subCategory: '', reason: '' })
  const [error, setError] = useState('')

  const { data: assignments, isLoading } = useQuery({
    queryKey: ['my-assets'],
    queryFn: () => assetApi.myAssets().then(r => r.data),
  })

  const { data: myRequests } = useQuery({
    queryKey: ['my-asset-requests'],
    queryFn: () => assetApi.myRequests().then(r => r.data),
  })

  const createRequest = useMutation({
    mutationFn: () => assetApi.createRequest({
      type: form.type,
      assetId: form.type === 'RETURN' && form.assetId ? form.assetId : undefined,
      category: form.category || undefined,
      subCategory: form.subCategory || undefined,
      reason: form.reason,
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['my-asset-requests'] }); setRequestOpen(false); setForm({ type: 'NEEDED', assetId: '', category: '', subCategory: '', reason: '' }); setError('') },
    onError: (e: any) => setError(e.response?.data?.message || 'Error'),
  })

  return (
    <div className="space-y-5">
      <PageHeader
        title="My Assets"
        subtitle="Assets assigned to you"
        actions={
          <Button icon={<Plus size={14} />} onClick={() => { setForm({ type: 'NEEDED', assetId: '', category: '', subCategory: '', reason: '' }); setRequestOpen(true); setError('') }}>
            Raise Request
          </Button>
        }
      />

      <Card>
        <div className="p-4 border-b border-slate-100">
          <h3 className="font-semibold text-slate-700">Currently Assigned</h3>
        </div>
        {isLoading ? <Skeleton className="h-48 m-4" /> : !assignments?.length ? (
          <EmptyState icon={<Plus size={20} />} title="No assets assigned" description="Raise a request if you need an asset" />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Asset</Th><Th>Code</Th><Th>Category</Th>
                <Th>Assigned Date</Th><Th>Warranty Expiry</Th>
              </tr>
            </thead>
            <tbody>
              {assignments.map((a: any) => (
                <Tr key={a.id}>
                  <Td className="font-medium">{a.asset?.name}</Td>
                  <Td className="font-mono text-xs">{a.asset?.assetCode}</Td>
                  <Td>{a.asset?.category?.name}{a.asset?.subCategory ? ` / ${a.asset.subCategory.name}` : ''}</Td>
                  <Td>{format(new Date(a.assignedDate), 'dd MMM yyyy')}</Td>
                  <Td className="text-slate-500">{a.asset?.warrantyExpiry ? format(new Date(a.asset.warrantyExpiry), 'dd MMM yyyy') : '—'}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      {/* My Requests */}
      {!!myRequests?.length && (
        <Card>
          <div className="p-4 border-b border-slate-100">
            <h3 className="font-semibold text-slate-700">My Requests</h3>
          </div>
          <Table>
            <thead>
              <tr>
                <Th>Type</Th><Th>Category</Th><Th>Reason</Th><Th>Date</Th><Th>Status</Th><Th>Notes</Th>
              </tr>
            </thead>
            <tbody>
              {myRequests.map((r: any) => (
                <Tr key={r.id}>
                  <Td>
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${r.type === 'NEEDED' ? 'bg-blue-50 text-blue-700' : 'bg-orange-50 text-orange-700'}`}>
                      {r.type === 'NEEDED' ? 'Needed' : 'Return'}
                    </span>
                  </Td>
                  <Td className="text-slate-600">{r.category || r.asset?.name || '—'}</Td>
                  <Td className="text-slate-500 text-sm max-w-[200px] truncate">{r.reason}</Td>
                  <Td className="text-slate-500 text-sm">{format(new Date(r.createdAt), 'dd MMM yyyy')}</Td>
                  <Td>
                    <StatusBadge status={r.status} />
                  </Td>
                  <Td className="text-slate-400 text-sm italic">{r.reviewNotes || '—'}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}

      {/* Raise Request Modal */}
      <Modal open={requestOpen} onClose={() => setRequestOpen(false)} title="Raise Asset Request">
        <div className="space-y-4">
          {error && <Alert type="error" message={error} />}
          <div>
            <label className="label">Request Type</label>
            <select className="input" value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value, assetId: '' }))}>
              <option value="NEEDED">I need an asset</option>
              <option value="RETURN">I want to return an asset</option>
            </select>
          </div>

          {form.type === 'NEEDED' && (
            <>
              <div>
                <label className="label">Category (optional)</label>
                <input className="input" placeholder="e.g. IT, Physical" value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))} />
              </div>
              <div>
                <label className="label">Sub-Category (optional)</label>
                <input className="input" placeholder="e.g. Laptop, Chair" value={form.subCategory} onChange={e => setForm(f => ({ ...f, subCategory: e.target.value }))} />
              </div>
            </>
          )}

          {form.type === 'RETURN' && (
            <div>
              <label className="label">Select Asset to Return *</label>
              <select className="input" value={form.assetId} onChange={e => setForm(f => ({ ...f, assetId: e.target.value }))}>
                <option value="">Select asset</option>
                {assignments?.map((a: any) => (
                  <option key={a.assetId} value={a.assetId}>{a.asset?.name} ({a.asset?.assetCode})</option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className="label">Reason *</label>
            <textarea className="input min-h-[80px]" value={form.reason} onChange={e => setForm(f => ({ ...f, reason: e.target.value }))} />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setRequestOpen(false)}>Cancel</Button>
            <Button loading={createRequest.isPending} onClick={() => createRequest.mutate()}>Submit</Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
