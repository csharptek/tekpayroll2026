import { useState, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Plus, Upload, Download, Eye, Pencil, Search } from 'lucide-react'
import { assetApi } from '../../../services/api'
import { PageHeader, Button, Card, Modal, Input, Alert, Skeleton, Table, Th, Td, Tr, EmptyState, StatusBadge } from '../../../components/ui'
import { DatePicker } from '../../../components/DatePicker'
import { format } from 'date-fns'

const EMPTY_FORM = {
  assetCode: '', name: '', categoryId: '', subCategoryId: '',
  brand: '', model: '', serialNumber: '',
  purchaseDate: '', warrantyExpiry: '', notes: '',
}

const STATUS_COLORS: Record<string, any> = {
  AVAILABLE: 'green', ASSIGNED: 'blue', UNDER_REPAIR: 'yellow', RETIRED: 'red',
}

export default function AssetListPage() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const fileRef = useRef<HTMLInputElement>(null)

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [addOpen, setAddOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<any>(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [error, setError] = useState('')
  const [bulkResult, setBulkResult] = useState<any>(null)

  const { data: assets, isLoading } = useQuery({
    queryKey: ['assets', search, statusFilter, categoryFilter],
    queryFn: () => assetApi.list({ search: search || undefined, status: statusFilter || undefined, categoryId: categoryFilter || undefined }).then(r => r.data),
  })

  const { data: categories } = useQuery({
    queryKey: ['asset-categories'],
    queryFn: () => assetApi.categories().then(r => r.data),
  })

  const selectedCat = categories?.find((c: any) => c.id === form.categoryId)

  const createMut = useMutation({
    mutationFn: () => assetApi.create(form),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['assets'] }); setAddOpen(false); setForm(EMPTY_FORM); setError('') },
    onError: (e: any) => setError(e.response?.data?.message || 'Error'),
  })

  const updateMut = useMutation({
    mutationFn: () => assetApi.update(editTarget?.id, form),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['assets'] }); setEditTarget(null); setError('') },
    onError: (e: any) => setError(e.response?.data?.message || 'Error'),
  })

  const downloadTemplate = async () => {
    const res = await assetApi.bulkTemplate()
    const url = URL.createObjectURL(new Blob([res.data]))
    const a = document.createElement('a'); a.href = url; a.download = 'asset-template.xlsx'; a.click()
  }

  const bulkUpload = useMutation({
    mutationFn: (file: File) => assetApi.bulkUpload(file).then(r => r.data),
    onSuccess: (data) => { qc.invalidateQueries({ queryKey: ['assets'] }); setBulkResult(data) },
    onError: (e: any) => setError(e.response?.data?.message || 'Upload failed'),
  })

  const openEdit = (asset: any) => {
    setForm({
      assetCode: asset.assetCode, name: asset.name,
      categoryId: asset.categoryId, subCategoryId: asset.subCategoryId || '',
      brand: asset.brand || '', model: asset.model || '',
      serialNumber: asset.serialNumber || '',
      purchaseDate: asset.purchaseDate ? asset.purchaseDate.split('T')[0] : '',
      warrantyExpiry: asset.warrantyExpiry ? asset.warrantyExpiry.split('T')[0] : '',
      notes: asset.notes || '',
    })
    setEditTarget(asset)
    setError('')
  }

  const renderForm = () => (
    <div className="space-y-4">
      {error && <Alert type="error" message={error} />}
      <div className="grid grid-cols-2 gap-4">
        <Input label="Asset Name *" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
        <Input label="Asset Code *" value={form.assetCode} onChange={e => setForm(f => ({ ...f, assetCode: e.target.value }))} />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="label">Category *</label>
          <select className="input" value={form.categoryId} onChange={e => setForm(f => ({ ...f, categoryId: e.target.value, subCategoryId: '' }))}>
            <option value="">Select category</option>
            {categories?.map((c: any) => <option key={c.id} value={c.id}>{c.name} ({c.type})</option>)}
          </select>
        </div>
        <div>
          <label className="label">Sub-Category</label>
          <select className="input" value={form.subCategoryId} onChange={e => setForm(f => ({ ...f, subCategoryId: e.target.value }))} disabled={!form.categoryId}>
            <option value="">Select sub-category</option>
            {selectedCat?.subCategories?.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <Input label="Brand" value={form.brand} onChange={e => setForm(f => ({ ...f, brand: e.target.value }))} />
        <Input label="Model" value={form.model} onChange={e => setForm(f => ({ ...f, model: e.target.value }))} />
      </div>
      <Input label="Serial Number" value={form.serialNumber} onChange={e => setForm(f => ({ ...f, serialNumber: e.target.value }))} />
      <div className="grid grid-cols-2 gap-4">
        <DatePicker label="Purchase Date" value={form.purchaseDate} onChange={v => setForm(f => ({ ...f, purchaseDate: v }))} />
        <DatePicker label="Warranty Expiry" value={form.warrantyExpiry} onChange={v => setForm(f => ({ ...f, warrantyExpiry: v }))} />
      </div>
      <div>
        <label className="label">Notes</label>
        <textarea className="input min-h-[70px]" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
      </div>
    </div>
  )

  const stats = [
    { label: 'Total Assets', value: assets?.length || 0 },
    { label: 'Available', value: assets?.filter((a: any) => a.status === 'AVAILABLE').length || 0 },
    { label: 'Assigned', value: assets?.filter((a: any) => a.status === 'ASSIGNED').length || 0 },
    { label: 'Under Repair', value: assets?.filter((a: any) => a.status === 'UNDER_REPAIR').length || 0 },
  ]

  return (
    <div className="space-y-5">
      <PageHeader
        title="Assets"
        subtitle="Manage company assets"
        actions={
          <div className="flex gap-2">
            <Button variant="ghost" icon={<Download size={14} />} onClick={downloadTemplate}>Template</Button>
            <Button variant="ghost" icon={<Upload size={14} />} onClick={() => fileRef.current?.click()}>Bulk Upload</Button>
            <input ref={fileRef} type="file" accept=".xlsx" className="hidden" onChange={e => e.target.files?.[0] && bulkUpload.mutate(e.target.files[0])} />
            <Button icon={<Plus size={14} />} onClick={() => { setForm(EMPTY_FORM); setAddOpen(true); setError('') }}>Add Asset</Button>
          </div>
        }
      />

      <div className="grid grid-cols-4 gap-4">
        {stats.map(({ label, value }) => (
          <div key={label} className="card p-4">
            <p className="stat-label">{label}</p>
            <p className="text-xl font-display font-bold text-slate-900 mt-1">{value}</p>
          </div>
        ))}
      </div>

      <Card>
        <div className="flex gap-3 p-4 border-b border-slate-100">
          <div className="relative flex-1">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input className="input pl-8" placeholder="Search assets..." value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <select className="input w-44" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
            <option value="">All Status</option>
            <option value="AVAILABLE">Available</option>
            <option value="ASSIGNED">Assigned</option>
            <option value="UNDER_REPAIR">Under Repair</option>
            <option value="RETIRED">Retired</option>
          </select>
          <select className="input w-44" value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)}>
            <option value="">All Categories</option>
            {categories?.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>

        {isLoading ? <Skeleton className="h-64 m-4" /> : !assets?.length ? (
          <EmptyState icon={<Plus size={20} />} title="No assets found" />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Code</Th><Th>Name</Th><Th>Category</Th><Th>Brand / Model</Th>
                <Th>Status</Th><Th>Assigned To</Th><Th>Warranty</Th><Th></Th>
              </tr>
            </thead>
            <tbody>
              {assets.map((asset: any) => {
                const active = asset.assignments?.[0]
                return (
                  <Tr key={asset.id}>
                    <Td className="font-mono text-xs">{asset.assetCode}</Td>
                    <Td className="font-medium">{asset.name}</Td>
                    <Td>
                      <span>{asset.category?.name}</span>
                      {asset.subCategory && <span className="text-slate-400"> / {asset.subCategory.name}</span>}
                    </Td>
                    <Td className="text-slate-500">{[asset.brand, asset.model].filter(Boolean).join(' · ') || '—'}</Td>
                    <Td><StatusBadge status={asset.status} /></Td>
                    <Td>{active ? <span className="text-sm">{active.employee?.name}</span> : <span className="text-slate-400">—</span>}</Td>
                    <Td className="text-slate-500 text-sm">{asset.warrantyExpiry ? format(new Date(asset.warrantyExpiry), 'dd MMM yyyy') : '—'}</Td>
                    <Td>
                      <div className="flex gap-1">
                        <Button variant="ghost" icon={<Eye size={13} />} onClick={() => navigate(`/hr/assets/${asset.id}`)} />
                        <Button variant="ghost" icon={<Pencil size={13} />} onClick={() => openEdit(asset)} />
                      </div>
                    </Td>
                  </Tr>
                )
              })}
            </tbody>
          </Table>
        )}
      </Card>

      {/* Add Modal */}
      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="Add Asset">
        <div className="space-y-4">
          {renderForm()}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button loading={createMut.isPending} onClick={() => createMut.mutate()}>Create Asset</Button>
          </div>
        </div>
      </Modal>

      {/* Edit Modal */}
      <Modal open={!!editTarget} onClose={() => setEditTarget(null)} title="Edit Asset">
        <div className="space-y-4">
          {renderForm()}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setEditTarget(null)}>Cancel</Button>
            <Button loading={updateMut.isPending} onClick={() => updateMut.mutate()}>Update Asset</Button>
          </div>
        </div>
      </Modal>

      {/* Bulk Upload Result Modal */}
      <Modal open={!!bulkResult} onClose={() => setBulkResult(null)} title="Bulk Upload Result">
        {bulkResult && (
          <div className="space-y-3">
            <p className="text-sm text-slate-600">Imported <strong>{bulkResult.imported}</strong> of <strong>{bulkResult.total}</strong> rows.</p>
            {bulkResult.results?.filter((r: any) => r.status === 'error').length > 0 && (
              <div className="max-h-60 overflow-y-auto space-y-1">
                {bulkResult.results.filter((r: any) => r.status === 'error').map((r: any) => (
                  <Alert key={r.row} type="error" message={`Row ${r.row}: ${r.error}`} />
                ))}
              </div>
            )}
            <div className="flex justify-end">
              <Button onClick={() => setBulkResult(null)}>Close</Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
