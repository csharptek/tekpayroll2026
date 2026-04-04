import { useState, useRef } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Upload, Trash2, CheckCircle2, Download, FileText, Eye } from 'lucide-react'
import { profileApi, Field, sel } from './shared'
import { Button, Alert } from '../ui'

const DOC_TYPES = [
  'PAN_CARD', 'AADHAAR_CARD', 'PASSPORT', 'OFFER_LETTER', 'APPOINTMENT_LETTER',
  'EXPERIENCE_LETTER', 'EDUCATION_CERTIFICATE', 'ADDRESS_PROOF', 'BANK_PROOF', 'OTHER',
]

const DOC_LABELS: Record<string, string> = {
  PAN_CARD: 'PAN Card', AADHAAR_CARD: 'Aadhaar Card', PASSPORT: 'Passport',
  OFFER_LETTER: 'Offer Letter', APPOINTMENT_LETTER: 'Appointment Letter',
  EXPERIENCE_LETTER: 'Experience Letter', EDUCATION_CERTIFICATE: 'Education Certificate',
  ADDRESS_PROOF: 'Address Proof', BANK_PROOF: 'Bank Proof', OTHER: 'Other',
}

const DOC_ICONS: Record<string, string> = {
  PAN_CARD: '🪪', AADHAAR_CARD: '🆔', PASSPORT: '📘', OFFER_LETTER: '📄',
  APPOINTMENT_LETTER: '📋', EXPERIENCE_LETTER: '💼', EDUCATION_CERTIFICATE: '🎓',
  ADDRESS_PROOF: '🏠', BANK_PROOF: '🏦', OTHER: '📎',
}

export default function DocumentsTab({ emp, isHR, onSaved }: { emp: any; isHR: boolean; onSaved: () => void }) {
  const qc        = useQueryClient()
  const fileRef   = useRef<HTMLInputElement>(null)
  const [docType, setDocType] = useState('PAN_CARD')
  const [notes,   setNotes]   = useState('')
  const [error,   setError]   = useState('')
  const [preview, setPreview] = useState<string | null>(null)

  const { data: documents } = useQuery({
    queryKey: ['documents', emp.id],
    queryFn:  () => profileApi.getDocuments(emp.id).then(r => r.data.data),
  })

  const uploadMut = useMutation({
    mutationFn: (file: File) => profileApi.uploadDocument(emp.id, file, docType, notes),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['documents', emp.id] }); setNotes('') },
    onError: (e: any) => setError(e?.response?.data?.error || 'Upload failed'),
  })

  const verifyMut = useMutation({
    mutationFn: (did: string) => profileApi.verifyDocument(emp.id, did),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['documents', emp.id] }),
  })

  const deleteMut = useMutation({
    mutationFn: (did: string) => profileApi.deleteDocument(emp.id, did),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['documents', emp.id] }),
  })

  function formatSize(bytes: number) {
    if (!bytes) return ''
    return bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)}MB` : `${(bytes / 1024).toFixed(0)}KB`
  }

  // Group by type
  const grouped: Record<string, any[]> = {}
  documents?.forEach((d: any) => {
    if (!grouped[d.documentType]) grouped[d.documentType] = []
    grouped[d.documentType].push(d)
  })

  return (
    <div className="space-y-5">
      {error && <Alert type="error" message={error}/>}

      {/* Upload section */}
      {isHR && (
        <div className="border border-slate-200 rounded-2xl p-4 bg-slate-50/50">
          <p className="text-sm font-semibold text-slate-700 mb-3">Upload Document</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Field label="Document Type">
              <select className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl focus:border-brand-400 focus:outline-none bg-white"
                value={docType} onChange={e => setDocType(e.target.value)}>
                {DOC_TYPES.map(t => <option key={t} value={t}>{DOC_LABELS[t]}</option>)}
              </select>
            </Field>
            <Field label="Notes (optional)">
              <input className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl focus:border-brand-400 focus:outline-none bg-white"
                value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optional note"/>
            </Field>
            <Field label="File (PDF or Image)">
              <input ref={fileRef} type="file" accept=".pdf,image/*" className="hidden"
                onChange={e => { if (e.target.files?.[0]) { setError(''); uploadMut.mutate(e.target.files[0]) } }}/>
              <Button className="w-full" variant="secondary" icon={<Upload size={14}/>}
                loading={uploadMut.isPending}
                onClick={() => fileRef.current?.click()}>
                Choose File
              </Button>
            </Field>
          </div>
        </div>
      )}

      {/* Document list */}
      {!documents?.length ? (
        <div className="text-center py-12 text-slate-400">
          <FileText size={32} className="mx-auto mb-3 opacity-30"/>
          <p className="text-sm">No documents uploaded yet.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {Object.entries(grouped).map(([type, docs]) => (
            <div key={type}>
              <p className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-2">
                {DOC_ICONS[type]} {DOC_LABELS[type]}
              </p>
              <div className="space-y-2">
                {docs.map((d: any) => (
                  <div key={d.id} className={`flex items-center gap-3 p-3 rounded-xl border ${d.isVerified ? 'border-emerald-200 bg-emerald-50/30' : 'border-slate-200 bg-white'}`}>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-800 truncate">{d.fileName}</p>
                      <div className="flex gap-3 mt-0.5 text-xs text-slate-400">
                        <span>{new Date(d.uploadedAt).toLocaleDateString('en-IN')}</span>
                        {d.fileSize && <span>{formatSize(d.fileSize)}</span>}
                        {d.notes && <span>· {d.notes}</span>}
                        {d.isVerified && <span className="text-emerald-600 font-medium">✓ Verified</span>}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <a href={d.fileUrl} target="_blank" rel="noopener noreferrer"
                        className="p-2 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-700 transition-colors">
                        <Eye size={14}/>
                      </a>
                      <a href={d.fileUrl} download={d.fileName}
                        className="p-2 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-700 transition-colors">
                        <Download size={14}/>
                      </a>
                      {isHR && !d.isVerified && (
                        <button onClick={() => verifyMut.mutate(d.id)}
                          className="p-2 rounded-lg hover:bg-emerald-50 text-slate-400 hover:text-emerald-600 transition-colors" title="Mark as verified">
                          <CheckCircle2 size={14}/>
                        </button>
                      )}
                      {isHR && (
                        <button onClick={() => deleteMut.mutate(d.id)}
                          className="p-2 rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-600 transition-colors">
                          <Trash2 size={14}/>
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
