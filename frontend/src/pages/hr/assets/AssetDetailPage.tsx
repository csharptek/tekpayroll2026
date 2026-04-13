import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, UserPlus, RotateCcw, Settings } from 'lucide-react'
import { format } from 'date-fns'
import { assetApi, employeeApi } from '../../../services/api'
import { PageHeader, Button, Card, Modal, Alert, Skeleton, Table, Th, Td, Tr, StatusBadge, Input } from '../../../components/ui'
import { DatePicker } from '../../../components/DatePicker'

const STATUS_COLORS: Record<string, any> = {
  AVAILABLE: 'green', ASSIGNED: 'blue', UNDER_REPAIR: 'yellow', RETIRED: 'red',
}

const CONDITION_COLORS: Record<string, any> = {
  GOOD: 'green', DAMAGED: 'yellow', LOST: 'red',
}

export default function AssetDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const qc = useQueryClient()

  const [assignOpen, setAssignOpen] = useState(false)
  const [returnTarget, setReturnTarget] = useState<any>(null)
  const [statusOpen, setStatusOpen] = useState(false)
  const [assignForm, setAssignForm] = useState({ employeeId: '', condition: 'GOOD', notes: '', assignedDate: '' })
  const [returnForm, setReturnForm] = useState({ returnCondition: 'GOOD', notes: '' })
  const [newStatus, setNewStatus] = useState('')
  const [error, setError] = useState('')

  const { data: asset, isLoading } = useQuery({
    queryKey: ['asset', id],
    queryFn: () => assetApi.get(id!).then(r => r.data),
  })

  const { data: employees } = useQuery({
    queryKey: ['employees-active'],
    queryFn: () => employeeApi.list({ status: 'ACTIVE', limit: 500 }).then(r => r.data.data),
  })

  const assignMut = useMutation({
    mutationFn: () => assetApi.assign(id!, assignForm),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['asset', id] }); setAssignOpen(false); setAssignForm({ employeeId: '', condition: 'GOOD', notes: '', assignedDate: '' }); setError('') },
    onError: (e: any) => setError(e.response?.data?.message || 'Error'),
  })

  const returnMut = useMutation({
    mutationFn: () => assetApi.return(id!, { assignmentId: returnTarget?.id, ...returnForm }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['asset', id] }); setReturnTarget(null); setError('') },
    onError: (e: any) => setError(e.response?.data?.message || 'Error'),
  })

  const statusMut = useMutation({
    mutationFn: () => assetApi.updateStatus(id!, newStatus),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['asset', id] }); setStatusOpen(false); setError('') },
    onError: (e: any) => setError(e.response?.data?.message || 'Error'),
  })

  if (isLoading) return <Skeleton className="h-96 m-6" />
  if (!asset) return <p className="p-6 text-slate-500">Asset not found.</p>

  const activeAssignment = asset.assignments?.find((a: any) => a.isActive)

  return (
    <div className="space-y-5">
      <PageHeader
        title={asset.name}
        subtitle={`${asset.assetCode} · ${asset.category?.name}${asset.subCategory ? ' / ' + asset.subCategory.name : ''}`}
        actions={
          <div className="flex gap-2">
            <Button variant="ghost" icon={<ArrowLeft size={14} />} onClick={() => navigate(-1)}>Back</Button>
            {asset.status === 'AVAILABLE' && (
              <Button icon={<UserPlus size={14} />} onClick={() => { setAssignForm({ employeeId: '', condition: 'GOOD', notes: '', assignedDate: '' }); setAssignOpen(true); setError('') }}>
                Assign
              </Button>
            )}
            {asset.status !== 'ASSIGNED' && (
              <Button variant="ghost" icon={<Settings size={14} />} onClick={() => { setNewStatus(asset.status); setStatusOpen(true); setError('') }}>
                Change Status
              </Button>
            )}
          </div>
        }
      />

      {/* Info Grid */}
      <div className="grid grid-cols-2 gap-5">
        <Card className="p-5 space-y-3">
          <h3 className="font-semibold text-slate-700">Asset Details</h3>
          {[
            ['Status', <StatusBadge status={asset.status} />],
            ['Brand', asset.brand || '—'],
            ['Model', asset.model || '—'],
            ['Serial No.', asset.serialNumber || '—'],
            ['Purchase Date', asset.purchaseDate ? format(new Date(asset.purchaseDate), 'dd MMM yyyy') : '—'],
            ['Warranty Expiry', asset.warrantyExpiry ? format(new Date(asset.warrantyExpiry), 'dd MMM yyyy') : '—'],
          ].map(([label, value]) => (
            <div key={String(label)} className="flex justify-between text-sm">
              <span className="text-slate-500">{label}</span>
              <span className="font-medium text-slate-800">{value}</span>
            </div>
          ))}
          {asset.notes && <p className="text-sm text-slate-500 border-t pt-3 mt-2">{asset.notes}</p>}
        </Card>

        <Card className="p-5 space-y-3">
          <h3 className="font-semibold text-slate-700">Current Assignment</h3>
          {activeAssignment ? (
            <>
              {[
                ['Employee', activeAssignment.employee?.name],
                ['Employee Code', activeAssignment.employee?.employeeCode],
                ['Department', activeAssignment.employee?.department || '—'],
                ['Assigned Date', format(new Date(activeAssignment.assignedDate), 'dd MMM yyyy')],
                ['Assigned By', activeAssignment.assignedByName],
                ['Condition', <StatusBadge status={activeAssignment.condition} />],
              ].map(([label, value]) => (
                <div key={String(label)} className="flex justify-between text-sm">
                  <span className="text-slate-500">{label}</span>
                  <span className="font-medium text-slate-800">{value}</span>
                </div>
              ))}
              <div className="pt-2">
                <Button variant="ghost" icon={<RotateCcw size={13} />} onClick={() => { setReturnForm({ returnCondition: 'GOOD', notes: '' }); setReturnTarget(activeAssignment); setError('') }}>
                  Mark as Returned
                </Button>
              </div>
            </>
          ) : (
            <p className="text-sm text-slate-400">No active assignment.</p>
          )}
        </Card>
      </div>

      {/* Assignment History */}
      <Card>
        <div className="p-4 border-b border-slate-100">
          <h3 className="font-semibold text-slate-700">Assignment History</h3>
        </div>
        {!asset.assignments?.length ? (
          <p className="text-sm text-slate-400 p-4">No assignments yet.</p>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Employee</Th><Th>Assigned Date</Th><Th>Returned Date</Th>
                <Th>Condition</Th><Th>Return Condition</Th><Th>Assigned By</Th>
              </tr>
            </thead>
            <tbody>
              {asset.assignments.map((a: any) => (
                <Tr key={a.id}>
                  <Td>
                    <div>
                      <p className="font-medium">{a.employee?.name}</p>
                      <p className="text-xs text-slate-400">{a.employee?.employeeCode}</p>
                    </div>
                  </Td>
                  <Td>{format(new Date(a.assignedDate), 'dd MMM yyyy')}</Td>
                  <Td>{a.returnedDate ? format(new Date(a.returnedDate), 'dd MMM yyyy') : <span className="text-green-600 font-medium">Active</span>}</Td>
                  <Td><StatusBadge status={a.condition} /></Td>
                  <Td>{a.returnCondition ? <StatusBadge status={a.returnCondition} /> : '—'}</Td>
                  <Td className="text-slate-500">{a.assignedByName}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      {/* Assign Modal */}
      <Modal open={assignOpen} onClose={() => setAssignOpen(false)} title="Assign Asset">
        <div className="space-y-4">
          {error && <Alert type="error" message={error} />}
          <div>
            <label className="label">Employee *</label>
            <select className="input" value={assignForm.employeeId} onChange={e => setAssignForm(f => ({ ...f, employeeId: e.target.value }))}>
              <option value="">Select employee</option>
              {employees?.map((emp: any) => <option key={emp.id} value={emp.id}>{emp.name} ({emp.employeeCode})</option>)}
            </select>
          </div>
          <div>
            <label className="label">Condition</label>
            <select className="input" value={assignForm.condition} onChange={e => setAssignForm(f => ({ ...f, condition: e.target.value }))}>
              <option value="GOOD">Good</option>
              <option value="DAMAGED">Damaged</option>
            </select>
          </div>
          <DatePicker label="Assigned Date" value={assignForm.assignedDate} onChange={v => setAssignForm(f => ({ ...f, assignedDate: v }))} />
          <div>
            <label className="label">Notes</label>
            <textarea className="input" value={assignForm.notes} onChange={e => setAssignForm(f => ({ ...f, notes: e.target.value }))} />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setAssignOpen(false)}>Cancel</Button>
            <Button loading={assignMut.isPending} onClick={() => assignMut.mutate()}>Assign</Button>
          </div>
        </div>
      </Modal>

      {/* Return Modal */}
      <Modal open={!!returnTarget} onClose={() => setReturnTarget(null)} title="Mark Asset Returned">
        <div className="space-y-4">
          {error && <Alert type="error" message={error} />}
          <div>
            <label className="label">Return Condition</label>
            <select className="input" value={returnForm.returnCondition} onChange={e => setReturnForm(f => ({ ...f, returnCondition: e.target.value }))}>
              <option value="GOOD">Good</option>
              <option value="DAMAGED">Damaged</option>
              <option value="LOST">Lost</option>
            </select>
          </div>
          <div>
            <label className="label">Notes</label>
            <textarea className="input" value={returnForm.notes} onChange={e => setReturnForm(f => ({ ...f, notes: e.target.value }))} />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setReturnTarget(null)}>Cancel</Button>
            <Button loading={returnMut.isPending} onClick={() => returnMut.mutate()}>Confirm Return</Button>
          </div>
        </div>
      </Modal>

      {/* Change Status Modal */}
      <Modal open={statusOpen} onClose={() => setStatusOpen(false)} title="Change Asset Status">
        <div className="space-y-4">
          {error && <Alert type="error" message={error} />}
          <div>
            <label className="label">Status</label>
            <select className="input" value={newStatus} onChange={e => setNewStatus(e.target.value)}>
              <option value="AVAILABLE">Available</option>
              <option value="UNDER_REPAIR">Under Repair</option>
              <option value="RETIRED">Retired</option>
            </select>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setStatusOpen(false)}>Cancel</Button>
            <Button loading={statusMut.isPending} onClick={() => statusMut.mutate()}>Update</Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
