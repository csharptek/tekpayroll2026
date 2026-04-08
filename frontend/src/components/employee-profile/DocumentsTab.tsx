import { useState, useRef } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Upload, Trash2, CheckCircle2, Download, FileText, Eye, Plus, X, FolderUp, Lock } from 'lucide-react'
import { profileApi, Field, sel } from './shared'
import { Button, Alert } from '../ui'

const DOC_TYPES = [
  'PAN_CARD', 'AADHAAR_CARD', 'PASSPORT', 'OFFER_LETTER', 'RELIEVING_LETTER',
  'APPOINTMENT_LETTER', 'EXPERIENCE_LETTER', 'EDUCATION_CERTIFICATE',
  'ADDRESS_PROOF', 'BANK_PROOF', 'OTHER',
]

const DOC_LABELS: Record<string, string> = {
  PAN_CARD: 'PAN Card', AADHAAR_CARD: 'Aadhaar Card', PASSPORT: 'Passport',
  OFFER_LETTER: 'Offer Letter', RELIEVING_LETTER: 'Relieving Letter',
  APPOINTMENT_LETTER: 'Appointment Letter',
  EXPERIENCE_LETTER: 'Experience Letter', EDUCATION_CERTIFICATE: 'Education Certificate',
  ADDRESS_PROOF: 'Address Proof', BANK_PROOF: 'Bank Proof', OTHER: 'Other',
}

const DOC_ICONS: Record<string, string> = {
  PAN_CARD: '🪪', AADHAAR_CARD: '🆔', PASSPORT: '📘', OFFER_LETTER: '📄',
  RELIEVING_LETTER: '📋', APPOINTMENT_LETTER: '📑', EXPERIENCE_LETTER: '💼',
  EDUCATION_CERTIFICATE: '🎓', ADDRESS_PROOF: '🏠', BANK_PROOF: '🏦', OTHER: '📎',
}

interface PendingFile {
  id: string
  file: File
  docType: string
  notes: string
  uploading: boolean
  done: boolean
  error: string
}

export default function DocumentsTab({ emp, isHR, onSaved }: { emp: any; isHR: boolean; onSaved: () => void }) {
  const qc         = useQueryClient()
  const fileRef    = useRef<HTMLInputElement>(null)
  const multiRef   = useRef<HTMLInputElement>(null)

  // Single upload state
  const [docType,         setDocType]         = useState('PAN_CARD')
  const [notes,           setNotes]           = useState('')
  const [referenceNumber, setReferenceNumber] = useState('')
  const [error,           setError]           = useState('')

  // Multi upload state
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([])
  const [multiError,   setMultiError]   = useState('')
  const [uploading,    setUploading]    = useState(false)

  const { data: documents } = useQuery({
    queryKey: ['documents', emp.id],
    queryFn:  () => profileApi.getDocuments(emp.id).then(r => r.data.data),
  })

  const uploadMut = useMutation({
    mutationFn: (file: File) => profileApi.uploadDocument(emp.id, file, docType, notes, referenceNumber),
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

  function onMultiFilesSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || [])
    if (!files.length) return
    const newEntries: PendingFile[] = files.map(f => ({
      id: `${f.name}-${Date.now()}-${Math.random()}`,
      file: f,
      docType: 'OTHER',
      notes: '',
      uploading: false,
      done: false,
      error: '',
    }))
    setPendingFiles(prev => [...prev, ...newEntries])
    if (multiRef.current) multiRef.current.value = ''
  }

  function updatePending(id: string, key: 'docType' | 'notes', val: string) {
    setPendingFiles(prev => prev.map(p => p.id === id ? { ...p, [key]: val } : p))
  }

  function removePending(id: string) {
    setPendingFiles(prev => prev.filter(p => p.id !== id))
  }

  async function uploadAll() {
    if (!pendingFiles.length) return
    setUploading(true)
    setMultiError('')

    for (const pf of pendingFiles) {
      setPendingFiles(prev => prev.map(p => p.id === pf.id ? { ...p, uploading: true } : p))
      try {
        await profileApi.uploadDocument(emp.id, pf.file, pf.docType, pf.notes)
        setPendingFiles(prev => prev.map(p => p.id === pf.id ? { ...p, uploading: false, done: true } : p))
      } catch (e: any) {
        const msg = e?.response?.data?.error || 'Upload failed'
        setPendingFiles(prev => prev.map(p => p.id === pf.id ? { ...p, uploading: false, error: msg } : p))
      }
    }

    await qc.invalidateQueries({ queryKey: ['documents', emp.id] })
    setUploading(false)
    // Remove successfully uploaded
    setPendingFiles(prev => prev.filter(p => !p.done))
  }

  // Group by type
  const grouped: Record<string, any[]> = {}
  documents?.forEach((d: any) => {
    if (!grouped[d.documentType]) grouped[d.documentType] = []
    grouped[d.documentType].push(d)
  })

  const allDone = pendingFiles.length > 0 && pendingFiles.every(p => p.done)

  return (
    <div className="space-y-5">
      {error && <Alert type="error" message={error}/>}

      {isHR && (
        <>
          {/* Single upload */}
          <div className="border border-slate-200 rounded-2xl p-4 bg-slate-50/50">
            <p className="text-sm font-semibold text-slate-700 mb-3">Upload Document</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Field label="Document Type">
                <select
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl focus:border-brand-400 focus:outline-none bg-white"
                  value={docType} onChange={e => setDocType(e.target.value)}>
                  {DOC_TYPES.map(t => <option key={t} value={t}>{DOC_LABELS[t]}</option>)}
                </select>
              </Field>
              <Field label="Reference No. (PAN/Aadhaar)">
                <input
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl focus:border-brand-400 focus:outline-none bg-white font-mono"
                  value={notes} onChange={e => setNotes(e.target.value)} placeholder="e.g. ABCDE1234F"/>
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

          {/* Multi upload */}
          <div className="border border-brand-200 rounded-2xl p-4 bg-brand-50/20">
            <div className="flex items-center justify-between mb-1">
              <p className="text-sm font-semibold text-slate-700">Bulk Document Upload</p>
            </div>
            <p className="text-xs text-slate-400 mb-3">Select multiple files at once, then assign a document type to each before uploading.</p>

            <input ref={multiRef} type="file" accept=".pdf,image/*" multiple className="hidden"
              onChange={onMultiFilesSelected}/>

            {pendingFiles.length === 0 ? (
              <button
                onClick={() => multiRef.current?.click()}
                className="w-full border-2 border-dashed border-brand-200 rounded-xl py-6 flex flex-col items-center gap-2 text-brand-400 hover:border-brand-400 hover:text-brand-600 hover:bg-brand-50 transition-all"
              >
                <FolderUp size={24}/>
                <span className="text-sm font-medium">Click to select multiple files</span>
              </button>
            ) : (
              <div className="space-y-3">
                {pendingFiles.map(pf => (
                  <div key={pf.id} className={`border rounded-xl p-3 bg-white transition-all ${
                    pf.done ? 'border-emerald-200 bg-emerald-50/30' :
                    pf.error ? 'border-red-200 bg-red-50/20' :
                    'border-slate-200'
                  }`}>
                    <div className="flex items-start gap-3">
                      <FileText size={16} className="text-slate-400 mt-1 flex-shrink-0"/>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-slate-700 truncate">{pf.file.name}</p>
                        <p className="text-xs text-slate-400 mb-2">{formatSize(pf.file.size)}</p>
                        {!pf.done && !pf.error && (
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            <select
                              className="w-full px-2 py-1.5 text-xs border border-slate-200 rounded-lg focus:border-brand-400 focus:outline-none bg-white"
                              value={pf.docType}
                              onChange={e => updatePending(pf.id, 'docType', e.target.value)}>
                              {DOC_TYPES.map(t => <option key={t} value={t}>{DOC_LABELS[t]}</option>)}
                            </select>
                            <input
                              className="w-full px-2 py-1.5 text-xs border border-slate-200 rounded-lg focus:border-brand-400 focus:outline-none"
                              placeholder="Notes (optional)"
                              value={pf.notes}
                              onChange={e => updatePending(pf.id, 'notes', e.target.value)}/>
                          </div>
                        )}
                        {pf.done && <p className="text-xs text-emerald-600 font-medium">✓ Uploaded successfully</p>}
                        {pf.error && <p className="text-xs text-red-600">{pf.error}</p>}
                        {pf.uploading && <p className="text-xs text-brand-500 animate-pulse">Uploading...</p>}
                      </div>
                      {!pf.uploading && !pf.done && (
                        <button onClick={() => removePending(pf.id)} className="text-slate-300 hover:text-red-400 transition-colors flex-shrink-0">
                          <X size={14}/>
                        </button>
                      )}
                    </div>
                  </div>
                ))}

                <div className="flex items-center gap-3 pt-1">
                  <Button
                    icon={<Upload size={14}/>}
                    loading={uploading}
                    onClick={uploadAll}
                    disabled={uploading || pendingFiles.every(p => p.done)}
                  >
                    Upload All ({pendingFiles.filter(p => !p.done).length} files)
                  </Button>
                  <button
                    onClick={() => multiRef.current?.click()}
                    className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-brand-600 transition-colors"
                  >
                    <Plus size={13}/> Add more
                  </button>
                  {pendingFiles.some(p => p.done) && (
                    <button
                      onClick={() => setPendingFiles(prev => prev.filter(p => !p.done))}
                      className="text-xs text-slate-400 hover:text-slate-600 ml-auto"
                    >
                      Clear done
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </>
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
                      <p className="text-sm font-medium text-slate-800 truncate flex items-center gap-1.5">{d.isLocked && <Lock size={11} className="text-amber-500 flex-shrink-0" />}{d.fileName}</p>
                      <div className="flex gap-3 mt-0.5 text-xs text-slate-400 flex-wrap">
                        <span>{new Date(d.uploadedAt).toLocaleDateString('en-IN')}</span>
                        {d.fileSize && <span>{formatSize(d.fileSize)}</span>}
                        {d.referenceNumber && <span className="font-mono">{d.referenceNumber}</span>}
                        {d.notes && <span>· {d.notes}</span>}
                        {d.uploadedByRole === 'EMPLOYEE' && <span className="text-brand-500">Self-uploaded</span>}
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
