import { useState, useRef } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Upload, FileText, Eye, Lock, AlertTriangle, CheckCircle2, X } from 'lucide-react'
import { profileApi } from './shared'
import { Button, Alert } from '../ui'

const API_BASE = (import.meta as any).env?.VITE_API_URL || ''
function resolveFileUrl(url: string): string {
  if (!url) return url
  if (/^https?:\/\//i.test(url)) return url
  return `${API_BASE}${url}`
}

// Doc types employee can self-upload
const SELF_DOC_TYPES = [
  { type: 'PAN_CARD',       label: 'PAN Card',                icon: '🪪', single: true,  hasRef: true,  refLabel: 'PAN Number',    refPattern: '[A-Z]{5}[0-9]{4}[A-Z]{1}' },
  { type: 'AADHAAR_CARD',   label: 'Aadhaar Card',            icon: '🆔', single: true,  hasRef: true,  refLabel: 'Aadhaar Number', refPattern: '[0-9]{12}' },
  { type: 'PASSPORT',       label: 'Passport',                icon: '📘', single: true,  hasRef: false, refLabel: '',              refPattern: '' },
  { type: 'OFFER_LETTER',   label: "Previous Companies' Offer Letters",     icon: '📄', single: false, hasRef: false, refLabel: '',              refPattern: '' },
  { type: 'RELIEVING_LETTER', label: "Previous Companies' Relieving Letters", icon: '📋', single: false, hasRef: false, refLabel: '',              refPattern: '' },
]

interface UploadState {
  file: File | null
  referenceNumber: string
  error: string
  uploading: boolean
  showConfirm: boolean
}

function DocSection({
  empId,
  docDef,
  existingDocs,
  onUploaded,
}: {
  empId: string
  docDef: typeof SELF_DOC_TYPES[0]
  existingDocs: any[]
  onUploaded: () => void
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [state, setState] = useState<UploadState>({
    file: null, referenceNumber: '', error: '', uploading: false, showConfirm: false,
  })

  const myDocs   = existingDocs.filter(d => d.documentType === docDef.type)
  const locked   = myDocs.some(d => d.isLocked)

  // For single-type docs (PAN/Aadhaar/Passport): locked = no more uploads
  const canUpload = docDef.single ? !locked : true

  function pickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (!f) return
    setState(s => ({ ...s, file: f, error: '' }))
    if (fileRef.current) fileRef.current.value = ''
  }

  function attemptUpload() {
    if (!state.file) { setState(s => ({ ...s, error: 'Please select a file.' })); return }
    if (docDef.hasRef && !state.referenceNumber.trim()) {
      setState(s => ({ ...s, error: `${docDef.refLabel} is required.` })); return
    }
    setState(s => ({ ...s, showConfirm: true }))
  }

  const qc = useQueryClient()
  const uploadMut = useMutation({
    mutationFn: () => profileApi.selfUploadDocument(empId, state.file!, docDef.type, state.referenceNumber || undefined),
    onSuccess: () => {
      setState({ file: null, referenceNumber: '', error: '', uploading: false, showConfirm: false })
      qc.invalidateQueries({ queryKey: ['documents', empId] })
      onUploaded()
    },
    onError: (e: any) => {
      setState(s => ({ ...s, uploading: false, showConfirm: false, error: e?.response?.data?.error || 'Upload failed' }))
    },
  })

  function confirmUpload() {
    setState(s => ({ ...s, uploading: true }))
    uploadMut.mutate()
  }

  return (
    <div className="border border-slate-200 rounded-2xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-slate-50 border-b border-slate-100">
        <div className="flex items-center gap-2">
          <span className="text-base">{docDef.icon}</span>
          <span className="text-sm font-semibold text-slate-700">{docDef.label}</span>
          {!docDef.single && <span className="text-xs text-slate-400">(multiple allowed)</span>}
        </div>
        {locked && (
          <span className="flex items-center gap-1 text-xs text-amber-600 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">
            <Lock size={10} /> Locked
          </span>
        )}
      </div>

      <div className="p-4 space-y-3">
        {/* Existing docs */}
        {myDocs.length > 0 && (
          <div className="space-y-2">
            {myDocs.map((d: any) => (
              <div key={d.id} className={`flex items-center gap-3 p-2.5 rounded-xl border ${d.isVerified ? 'border-emerald-200 bg-emerald-50/30' : 'border-slate-100 bg-white'}`}>
                <FileText size={14} className="text-slate-400 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-slate-700 truncate">{d.fileName}</p>
                  <div className="flex gap-2 mt-0.5 text-xs text-slate-400 flex-wrap">
                    {d.referenceNumber && <span className="font-mono">{d.referenceNumber}</span>}
                    <span>{new Date(d.uploadedAt).toLocaleDateString('en-IN')}</span>
                    {d.uploadedByRole && d.uploadedByRole !== 'EMPLOYEE' && (
                      <span className="text-brand-500">Uploaded by HR</span>
                    )}
                    {d.isVerified && <span className="text-emerald-600 font-medium">✓ Verified</span>}
                    {d.isLocked && !d.isVerified && <span className="text-amber-600">Submitted</span>}
                  </div>
                </div>
                {/* View only — no download */}
                <a
                  href={resolveFileUrl(d.fileUrl)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-700 transition-colors"
                  title="View"
                >
                  <Eye size={14} />
                </a>
              </div>
            ))}
          </div>
        )}

        {/* Upload area */}
        {canUpload && (
          <div className="space-y-2">
            {docDef.hasRef && (
              <input
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl focus:border-brand-400 focus:outline-none bg-white font-mono"
                placeholder={docDef.refLabel}
                value={state.referenceNumber}
                onChange={e => setState(s => ({ ...s, referenceNumber: e.target.value.toUpperCase() }))}
              />
            )}

            <div className="flex items-center gap-2">
              <input ref={fileRef} type="file" accept=".pdf,image/*" className="hidden" onChange={pickFile} />
              {state.file ? (
                <div className="flex-1 flex items-center gap-2 px-3 py-2 border border-brand-200 rounded-xl bg-brand-50/30 text-sm">
                  <FileText size={13} className="text-brand-400 flex-shrink-0" />
                  <span className="flex-1 truncate text-slate-700">{state.file.name}</span>
                  <button onClick={() => setState(s => ({ ...s, file: null }))} className="text-slate-300 hover:text-red-400">
                    <X size={13} />
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => fileRef.current?.click()}
                  className="flex-1 flex items-center justify-center gap-2 py-2 border-2 border-dashed border-slate-200 rounded-xl text-sm text-slate-400 hover:border-brand-300 hover:text-brand-500 transition-all"
                >
                  <Upload size={14} /> Choose file (PDF or image)
                </button>
              )}
              {state.file && (
                <Button size="sm" onClick={attemptUpload} loading={uploadMut.isPending}>
                  Submit
                </Button>
              )}
            </div>

            {state.error && <p className="text-xs text-red-500">{state.error}</p>}
          </div>
        )}

        {!canUpload && myDocs.length === 0 && (
          <p className="text-xs text-slate-400 text-center py-2">No document uploaded yet.</p>
        )}
      </div>

      {/* Confirm modal */}
      {state.showConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-sm w-full p-6 space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center flex-shrink-0">
                <AlertTriangle size={18} className="text-amber-600" />
              </div>
              <div>
                <h3 className="font-semibold text-slate-900 text-sm">Confirm Submission</h3>
                <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                  Once submitted, <strong>you cannot edit or delete</strong> this document. Only HR can make changes. Are you sure you want to proceed?
                </p>
              </div>
            </div>
            <div className="flex gap-2 pt-1">
              <Button
                variant="secondary"
                className="flex-1"
                onClick={() => setState(s => ({ ...s, showConfirm: false }))}
                disabled={state.uploading}
              >
                Cancel
              </Button>
              <Button
                className="flex-1"
                onClick={confirmUpload}
                loading={state.uploading}
                icon={<CheckCircle2 size={14} />}
              >
                Yes, Submit
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

const COMPANY_DOC_LABELS: Record<string, string> = {
  FORM_16: '🧾 Form 16',
  APPOINTMENT_LETTER: '📑 Appointment Letter',
  EXPERIENCE_LETTER: '💼 Experience Letter',
  INCREMENT_LETTER: '📄 Increment Letter',
}

export default function MyDocumentsTab({ empId }: { empId: string }) {
  const qc = useQueryClient()

  const { data: documents, isLoading } = useQuery({
    queryKey: ['documents', empId],
    queryFn:  () => profileApi.getDocuments(empId).then(r => r.data.data),
  })

  if (isLoading) return (
    <div className="space-y-3">
      {[1,2,3].map(i => <div key={i} className="h-20 rounded-2xl bg-slate-100 animate-pulse" />)}
    </div>
  )

  const companyDocs = (documents || []).filter((d: any) => COMPANY_DOC_LABELS[d.documentType])

  return (
    <div className="space-y-4">
      <Alert
        type="warning"
        message="Once you submit a document, it is locked and cannot be edited. Contact HR if changes are needed."
      />
      {SELF_DOC_TYPES.map(def => (
        <DocSection
          key={def.type}
          empId={empId}
          docDef={def}
          existingDocs={documents || []}
          onUploaded={() => qc.invalidateQueries({ queryKey: ['documents', empId] })}
        />
      ))}

      {companyDocs.length > 0 && (
        <div className="rounded-2xl border border-slate-200 p-4">
          <h3 className="text-sm font-semibold text-slate-700 mb-3">Company Issued Documents</h3>
          <div className="space-y-2">
            {companyDocs.map((d: any) => (
              <div key={d.id} className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2.5">
                <div className="flex items-center gap-2 text-sm text-slate-700">
                  <span>{COMPANY_DOC_LABELS[d.documentType]}</span>
                  <span className="text-xs text-slate-400">{d.fileName}</span>
                </div>
                <a
                  href={resolveFileUrl(d.fileUrl)}
                  target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:underline"
                >
                  <Eye size={13}/> View
                </a>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
