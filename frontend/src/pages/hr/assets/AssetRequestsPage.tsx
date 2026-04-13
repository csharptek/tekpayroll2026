import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import { assetApi } from '../../../services/api'
import { PageHeader, Card, Button, Modal, Alert, Skeleton, Table, Th, Td, Tr, StatusBadge, EmptyState } from '../../../components/ui'
import { CheckCircle, XCircle } from 'lucide-react'

const STATUS_COLORS: Record<string, any> = {
  PENDING: 'yellow', APPROVED: 'green', REJECTED: 'red',
}

export default function AssetRequestsPage() {
  const qc = useQueryClient()
  const [statusFilter, setStatusFilter] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [reviewTarget, setReviewTarget] = useState<any>(null)
  const [reviewForm, setReviewForm] = useState({ status: 'APPROVED', notes: '' })
  const [error, setError] = useState('')

  const { data: requests, isLoading } = useQuery({
    queryKey: ['asset-requests', statusFilter, typeFilter],
    queryFn: () => assetApi.allRequests({ status: statusFilter || undefined, type: typeFilter || undefined }).then(r => r.data),
  })

  const reviewMut = useMutation({
    mutationFn: () => assetApi.reviewRequest(reviewTarget?.id, reviewForm),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['asset-requests'] }); setReviewTarget(null); setError('') },
    onError: (e: any) => setError(e.response?.data?.message || 'Error'),
  })

  return (
    <div className="space-y-5">
      <PageHeader title="Asset Requests" subtitle="Employee asset needed and return requests" />

      <Card>
        <div className="flex gap-3 p-4 border-b border-slate-100">
          <select className="input w-44" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
            <option value="">All Status</option>
            <option value="PENDING">Pending</option>
            <option value="APPROVED">Approved</option>
            <option value="REJECTED">Rejected</option>
          </select>
          <select className="input w-44" value={typeFilter} onChange={e => setTypeFilter(e.target.value)}>
            <option value="">All Types</option>
            <option value="NEEDED">Asset Needed</option>
            <option value="RETURN">Asset Return</option>
          </select>
        </div>

        {isLoading ? <Skeleton className="h-64 m-4" /> : !requests?.length ? (
          <EmptyState icon={<CheckCircle size={20} />} title="No requests found" />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Employee</Th><Th>Type</Th><Th>Category</Th>
                <Th>Asset</Th><Th>Reason</Th><Th>Date</Th>
                <Th>Status</Th><Th></Th>
              </tr>
            </thead>
            <tbody>
              {requests.map((req: any) => (
                <Tr key={req.id}>
                  <Td>
                    <div>
                      <p className="font-medium">{req.employee?.name}</p>
                      <p className="text-xs text-slate-400">{req.employee?.department}</p>
                    </div>
                  </Td>
                  <Td>
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${req.type === 'NEEDED' ? 'bg-blue-50 text-blue-700' : 'bg-orange-50 text-orange-700'}`}>
                      {req.type === 'NEEDED' ? 'Needed' : 'Return'}
                    </span>
                  </Td>
                  <Td className="text-slate-600">{req.category || '—'}{req.subCategory ? ` / ${req.subCategory}` : ''}</Td>
                  <Td className="text-slate-600">{req.asset?.name || '—'}</Td>
                  <Td className="max-w-[200px] truncate text-slate-500 text-sm">{req.reason}</Td>
                  <Td className="text-slate-500 text-sm">{format(new Date(req.createdAt), 'dd MMM yyyy')}</Td>
                  <Td><StatusBadge status={req.status} /></Td>
                  <Td>
                    {req.status === 'PENDING' && (
                      <div className="flex gap-1">
                        <Button variant="ghost" icon={<CheckCircle size={13} />} className="text-green-600"
                          onClick={() => { setReviewForm({ status: 'APPROVED', notes: '' }); setReviewTarget(req); setError('') }}>
                          Approve
                        </Button>
                        <Button variant="ghost" icon={<XCircle size={13} />} className="text-red-500"
                          onClick={() => { setReviewForm({ status: 'REJECTED', notes: '' }); setReviewTarget(req); setError('') }}>
                          Reject
                        </Button>
                      </div>
                    )}
                    {req.status !== 'PENDING' && req.reviewNotes && (
                      <span className="text-xs text-slate-400 italic">{req.reviewNotes}</span>
                    )}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <Modal open={!!reviewTarget} onClose={() => setReviewTarget(null)} title={reviewForm.status === 'APPROVED' ? 'Approve Request' : 'Reject Request'}>
        <div className="space-y-4">
          {error && <Alert type="error" message={error} />}
          <div>
            <p className="text-sm text-slate-600">
              <strong>{reviewTarget?.employee?.name}</strong> — {reviewTarget?.type === 'NEEDED' ? 'Asset Needed' : 'Asset Return'} request
            </p>
            <p className="text-sm text-slate-500 mt-1">{reviewTarget?.reason}</p>
          </div>
          <div>
            <label className="label">Notes (optional)</label>
            <textarea className="input" value={reviewForm.notes} onChange={e => setReviewForm(f => ({ ...f, notes: e.target.value }))} />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setReviewTarget(null)}>Cancel</Button>
            <Button
              loading={reviewMut.isPending}
              className={reviewForm.status === 'REJECTED' ? 'bg-red-600 hover:bg-red-700' : ''}
              onClick={() => reviewMut.mutate()}
            >
              {reviewForm.status === 'APPROVED' ? 'Approve' : 'Reject'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
