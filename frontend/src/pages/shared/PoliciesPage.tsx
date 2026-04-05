import { useState, useRef, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Pencil, Trash2, Search, ChevronUp, ChevronDown, X, Save, GripVertical } from 'lucide-react'
import { policiesApi } from '../../services/api'
import { useAuthStore } from '../../store/authStore'
import { PageHeader, Button, Card, Alert, Skeleton } from '../../components/ui'
import ReactQuill from 'react-quill'
import 'react-quill/dist/quill.snow.css'

// ─── QUILL TOOLBAR CONFIG ────────────────────────────────────────────────────

const QUILL_MODULES = {
  toolbar: [
    [{ header: [2, 3, false] }],
    ['bold', 'italic', 'underline'],
    [{ list: 'ordered' }, { list: 'bullet' }],
    ['clean'],
  ],
}

const QUILL_FORMATS = ['header', 'bold', 'italic', 'underline', 'list', 'bullet']

// ─── POLICY FORM (add / edit) ────────────────────────────────────────────────

function PolicyForm({
  initial,
  onSave,
  onCancel,
  loading,
}: {
  initial?: { title: string; content: string }
  onSave: (data: { title: string; content: string }) => void
  onCancel: () => void
  loading: boolean
}) {
  const [title,   setTitle]   = useState(initial?.title   || '')
  const [content, setContent] = useState(initial?.content || '')
  const [err,     setErr]     = useState('')

  function handleSave() {
    if (!title.trim())   { setErr('Title is required'); return }
    if (!content.trim()) { setErr('Content is required'); return }
    onSave({ title: title.trim(), content })
  }

  return (
    <div className="space-y-4">
      {err && <Alert type="error" message={err} />}
      <div>
        <label className="label">Policy Title</label>
        <input
          className="input mt-1"
          value={title}
          onChange={e => { setTitle(e.target.value); setErr('') }}
          placeholder="e.g. General Employment Rules"
        />
      </div>
      <div>
        <label className="label mb-1 block">Content</label>
        <div className="rounded-xl overflow-hidden border border-slate-200">
          <ReactQuill
            theme="snow"
            value={content}
            onChange={val => { setContent(val); setErr('') }}
            modules={QUILL_MODULES}
            formats={QUILL_FORMATS}
            style={{ minHeight: 220 }}
          />
        </div>
      </div>
      <div className="flex gap-2 justify-end pt-1">
        <Button variant="secondary" onClick={onCancel} disabled={loading}>Cancel</Button>
        <Button icon={<Save size={14} />} loading={loading} onClick={handleSave}>
          {initial ? 'Save Changes' : 'Add Policy'}
        </Button>
      </div>
    </div>
  )
}

// ─── POLICY CARD ─────────────────────────────────────────────────────────────

function PolicyCard({
  policy,
  index,
  total,
  isSuperAdmin,
  onEdit,
  onDelete,
  onMoveUp,
  onMoveDown,
}: {
  policy: any
  index: number
  total: number
  isSuperAdmin: boolean
  onEdit: () => void
  onDelete: () => void
  onMoveUp: () => void
  onMoveDown: () => void
}) {
  const [open, setOpen] = useState(false)

  return (
    <div className="border border-slate-200 rounded-xl overflow-hidden bg-white transition-shadow hover:shadow-sm">
      {/* Header row */}
      <div
        className="flex items-center gap-3 px-4 py-3.5 cursor-pointer select-none group"
        onClick={() => setOpen(o => !o)}
      >
        {isSuperAdmin && (
          <div className="flex flex-col gap-0.5 opacity-40 group-hover:opacity-70 transition-opacity flex-shrink-0">
            <GripVertical size={14} className="text-slate-400" />
          </div>
        )}

        <span className="w-6 h-6 rounded-full bg-brand-100 text-brand-700 text-xs font-bold flex items-center justify-center flex-shrink-0">
          {index + 1}
        </span>

        <span className="flex-1 text-sm font-semibold text-slate-800">
          {policy.title}
        </span>

        <div className="flex items-center gap-1 flex-shrink-0" onClick={e => e.stopPropagation()}>
          {isSuperAdmin && (
            <>
              <button
                disabled={index === 0}
                onClick={onMoveUp}
                className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 disabled:opacity-20 disabled:cursor-not-allowed transition-colors"
                title="Move up"
              >
                <ChevronUp size={14} />
              </button>
              <button
                disabled={index === total - 1}
                onClick={onMoveDown}
                className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 disabled:opacity-20 disabled:cursor-not-allowed transition-colors"
                title="Move down"
              >
                <ChevronDown size={14} />
              </button>
              <button
                onClick={onEdit}
                className="p-1.5 rounded-lg hover:bg-brand-50 text-slate-400 hover:text-brand-600 transition-colors"
                title="Edit"
              >
                <Pencil size={14} />
              </button>
              <button
                onClick={onDelete}
                className="p-1.5 rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-500 transition-colors"
                title="Delete"
              >
                <Trash2 size={14} />
              </button>
            </>
          )}
          <div className="p-1.5 text-slate-400">
            {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </div>
        </div>
      </div>

      {/* Content */}
      {open && (
        <div className="border-t border-slate-100 px-5 py-4">
          <div
            className="prose prose-sm max-w-none text-slate-700 policy-content"
            dangerouslySetInnerHTML={{ __html: policy.content }}
          />
        </div>
      )}
    </div>
  )
}

// ─── DELETE CONFIRM ──────────────────────────────────────────────────────────

function DeleteConfirm({ policy, onConfirm, onCancel, loading }: {
  policy: any; onConfirm: () => void; onCancel: () => void; loading: boolean
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 space-y-4">
        <h3 className="text-sm font-semibold text-slate-800">Delete Policy</h3>
        <p className="text-sm text-slate-500">
          Are you sure you want to delete <span className="font-semibold text-slate-700">{policy.title}</span>? This cannot be undone.
        </p>
        <div className="flex gap-2 justify-end">
          <Button variant="secondary" onClick={onCancel} disabled={loading}>Cancel</Button>
          <Button variant="danger" loading={loading} onClick={onConfirm}>Delete</Button>
        </div>
      </div>
    </div>
  )
}

// ─── MAIN PAGE ───────────────────────────────────────────────────────────────

export default function PoliciesPage() {
  const { user } = useAuthStore()
  const qc = useQueryClient()
  const isSuperAdmin = user?.role === 'SUPER_ADMIN'

  const [search,      setSearch]      = useState('')
  const [adding,      setAdding]      = useState(false)
  const [editPolicy,  setEditPolicy]  = useState<any>(null)
  const [deleteTarget,setDeleteTarget]= useState<any>(null)

  const { data: policies, isLoading } = useQuery({
    queryKey: ['policies'],
    queryFn: () => policiesApi.list().then(r => r.data.data),
  })

  const createMut = useMutation({
    mutationFn: (data: any) => policiesApi.create(data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['policies'] }); setAdding(false) },
  })

  const updateMut = useMutation({
    mutationFn: ({ id, data }: any) => policiesApi.update(id, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['policies'] }); setEditPolicy(null) },
  })

  const deleteMut = useMutation({
    mutationFn: (id: string) => policiesApi.delete(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['policies'] }); setDeleteTarget(null) },
  })

  const reorderMut = useMutation({
    mutationFn: (ids: string[]) => policiesApi.reorder(ids),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['policies'] }),
  })

  function movePolicy(index: number, dir: -1 | 1) {
    if (!policies) return
    const reordered = [...policies]
    const target = index + dir
    if (target < 0 || target >= reordered.length) return
    ;[reordered[index], reordered[target]] = [reordered[target], reordered[index]]
    reorderMut.mutate(reordered.map((p: any) => p.id))
  }

  const filtered = (policies || []).filter((p: any) =>
    !search || p.title.toLowerCase().includes(search.toLowerCase()) ||
    p.content.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="space-y-5 max-w-4xl">
      <PageHeader
        title="Company Policies"
        subtitle="Policies and guidelines for all employees"
        actions={
          isSuperAdmin && !adding && !editPolicy ? (
            <Button icon={<Plus size={14} />} onClick={() => setAdding(true)}>
              Add Policy
            </Button>
          ) : undefined
        }
      />

      {/* Search */}
      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          className="input pl-8 w-full"
          placeholder="Search policies…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        {search && (
          <button
            onClick={() => setSearch('')}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
          >
            <X size={14} />
          </button>
        )}
      </div>

      {/* Add form */}
      {adding && (
        <Card className="p-5">
          <h3 className="text-sm font-semibold text-slate-700 mb-4">New Policy</h3>
          <PolicyForm
            onSave={data => createMut.mutate(data)}
            onCancel={() => setAdding(false)}
            loading={createMut.isPending}
          />
        </Card>
      )}

      {/* Edit form */}
      {editPolicy && (
        <Card className="p-5">
          <h3 className="text-sm font-semibold text-slate-700 mb-4">Edit Policy</h3>
          <PolicyForm
            initial={{ title: editPolicy.title, content: editPolicy.content }}
            onSave={data => updateMut.mutate({ id: editPolicy.id, data })}
            onCancel={() => setEditPolicy(null)}
            loading={updateMut.isPending}
          />
        </Card>
      )}

      {/* List */}
      {isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-14 rounded-xl" />)}
        </div>
      ) : filtered.length === 0 ? (
        <Card className="p-10 text-center">
          <p className="text-sm text-slate-400">
            {search ? 'No policies match your search.' : 'No policies added yet.'}
          </p>
        </Card>
      ) : (
        <div className="space-y-2">
          {filtered.map((policy: any, i: number) => (
            <PolicyCard
              key={policy.id}
              policy={policy}
              index={i}
              total={filtered.length}
              isSuperAdmin={isSuperAdmin}
              onEdit={() => { setEditPolicy(policy); setAdding(false) }}
              onDelete={() => setDeleteTarget(policy)}
              onMoveUp={() => movePolicy(i, -1)}
              onMoveDown={() => movePolicy(i, 1)}
            />
          ))}
        </div>
      )}

      {/* Delete confirm */}
      {deleteTarget && (
        <DeleteConfirm
          policy={deleteTarget}
          onConfirm={() => deleteMut.mutate(deleteTarget.id)}
          onCancel={() => setDeleteTarget(null)}
          loading={deleteMut.isPending}
        />
      )}
    </div>
  )
}
