import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Pencil, Trash2, ChevronDown, ChevronRight } from 'lucide-react'
import { assetApi } from '../../../services/api'
import { PageHeader, Button, Card, Modal, Input, Alert, Skeleton, EmptyState } from '../../../components/ui'

export default function AssetConfiguratorPage() {
  const qc = useQueryClient()
  const [expanded, setExpanded] = useState<string | null>(null)
  const [catModal, setCatModal] = useState<{ open: boolean; edit?: any }>({ open: false })
  const [subModal, setSubModal] = useState<{ open: boolean; categoryId?: string; edit?: any }>({ open: false })
  const [catForm, setCatForm] = useState({ name: '', type: 'IT' })
  const [subForm, setSubForm] = useState({ name: '' })
  const [error, setError] = useState('')

  const { data: categories, isLoading } = useQuery({
    queryKey: ['asset-categories'],
    queryFn: () => assetApi.categories().then(r => r.data),
  })

  const createCat = useMutation({
    mutationFn: () => assetApi.createCategory(catForm),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['asset-categories'] }); setCatModal({ open: false }); setCatForm({ name: '', type: 'IT' }); setError('') },
    onError: (e: any) => setError(e.response?.data?.message || 'Error'),
  })

  const updateCat = useMutation({
    mutationFn: () => assetApi.updateCategory(catModal.edit?.id, { name: catForm.name }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['asset-categories'] }); setCatModal({ open: false }); setError('') },
    onError: (e: any) => setError(e.response?.data?.message || 'Error'),
  })

  const deleteCat = useMutation({
    mutationFn: (id: string) => assetApi.deleteCategory(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['asset-categories'] }),
  })

  const createSub = useMutation({
    mutationFn: () => assetApi.createSubCategory({ name: subForm.name, categoryId: subModal.categoryId }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['asset-categories'] }); setSubModal({ open: false }); setSubForm({ name: '' }); setError('') },
    onError: (e: any) => setError(e.response?.data?.message || 'Error'),
  })

  const updateSub = useMutation({
    mutationFn: () => assetApi.updateSubCategory(subModal.edit?.id, { name: subForm.name }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['asset-categories'] }); setSubModal({ open: false }); setError('') },
    onError: (e: any) => setError(e.response?.data?.message || 'Error'),
  })

  const deleteSub = useMutation({
    mutationFn: (id: string) => assetApi.deleteSubCategory(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['asset-categories'] }),
  })

  const openEditCat = (cat: any) => {
    setCatForm({ name: cat.name, type: cat.type })
    setCatModal({ open: true, edit: cat })
    setError('')
  }

  const openAddSub = (categoryId: string) => {
    setSubForm({ name: '' })
    setSubModal({ open: true, categoryId })
    setError('')
  }

  const openEditSub = (sub: any, categoryId: string) => {
    setSubForm({ name: sub.name })
    setSubModal({ open: true, categoryId, edit: sub })
    setError('')
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Asset Configurator"
        subtitle="Manage asset categories and sub-categories"
        actions={
          <Button icon={<Plus size={14} />} onClick={() => { setCatForm({ name: '', type: 'IT' }); setCatModal({ open: true }); setError('') }}>
            Add Category
          </Button>
        }
      />

      {isLoading ? <Skeleton className="h-64" /> : !categories?.length ? (
        <Card><EmptyState icon={<Plus size={20} />} title="No categories yet" description="Add a category to get started" /></Card>
      ) : (
        <div className="space-y-3">
          {categories.map((cat: any) => (
            <Card key={cat.id} className="overflow-hidden">
              <div
                className="flex items-center justify-between p-4 cursor-pointer hover:bg-slate-50"
                onClick={() => setExpanded(expanded === cat.id ? null : cat.id)}
              >
                <div className="flex items-center gap-3">
                  {expanded === cat.id ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                  <div>
                    <p className="font-medium text-slate-900">{cat.name}</p>
                    <p className="text-xs text-slate-500">{cat.type} · {cat.subCategories?.length || 0} sub-categories</p>
                  </div>
                </div>
                <div className="flex gap-2" onClick={e => e.stopPropagation()}>
                  <Button variant="ghost" icon={<Plus size={13} />} onClick={() => openAddSub(cat.id)}>Add Sub</Button>
                  <Button variant="ghost" icon={<Pencil size={13} />} onClick={() => openEditCat(cat)} />
                  <Button variant="ghost" icon={<Trash2 size={13} />} className="text-red-500" onClick={() => deleteCat.mutate(cat.id)} />
                </div>
              </div>

              {expanded === cat.id && (
                <div className="border-t border-slate-100 divide-y divide-slate-50">
                  {!cat.subCategories?.length ? (
                    <p className="text-sm text-slate-400 px-6 py-3">No sub-categories yet.</p>
                  ) : cat.subCategories.map((sub: any) => (
                    <div key={sub.id} className="flex items-center justify-between px-8 py-3 hover:bg-slate-50">
                      <span className="text-sm text-slate-700">{sub.name}</span>
                      <div className="flex gap-2">
                        <Button variant="ghost" icon={<Pencil size={12} />} onClick={() => openEditSub(sub, cat.id)} />
                        <Button variant="ghost" icon={<Trash2 size={12} />} className="text-red-500" onClick={() => deleteSub.mutate(sub.id)} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      {/* Category Modal */}
      <Modal open={catModal.open} onClose={() => setCatModal({ open: false })} title={catModal.edit ? 'Edit Category' : 'Add Category'}>
        <div className="space-y-4">
          {error && <Alert type="error" message={error} />}
          <Input label="Category Name" value={catForm.name} onChange={e => setCatForm(f => ({ ...f, name: e.target.value }))} />
          {!catModal.edit && (
            <div>
              <label className="label">Type</label>
              <select className="input" value={catForm.type} onChange={e => setCatForm(f => ({ ...f, type: e.target.value }))}>
                <option value="IT">IT</option>
                <option value="PHYSICAL">Physical</option>
              </select>
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setCatModal({ open: false })}>Cancel</Button>
            <Button loading={createCat.isPending || updateCat.isPending} onClick={() => catModal.edit ? updateCat.mutate() : createCat.mutate()}>
              {catModal.edit ? 'Update' : 'Create'}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Sub-category Modal */}
      <Modal open={subModal.open} onClose={() => setSubModal({ open: false })} title={subModal.edit ? 'Edit Sub-Category' : 'Add Sub-Category'}>
        <div className="space-y-4">
          {error && <Alert type="error" message={error} />}
          <Input label="Sub-Category Name" value={subForm.name} onChange={e => setSubForm({ name: e.target.value })} />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setSubModal({ open: false })}>Cancel</Button>
            <Button loading={createSub.isPending || updateSub.isPending} onClick={() => subModal.edit ? updateSub.mutate() : createSub.mutate()}>
              {subModal.edit ? 'Update' : 'Create'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
