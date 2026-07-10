import { useState, useRef } from 'react'
import { UploadCloud, CheckCircle2, XCircle, AlertTriangle, FileText, Loader2 } from 'lucide-react'
import api from '../../services/api'
import { Button, Alert } from '../../components/ui'

interface BulkItem {
  id: string
  employeeId: string | null
  matchedName: string | null
  extractedPan: string | null
  matchConfidence: number | null
  matchMethod: string | null
  partAFileName: string | null
  partBFileName: string | null
  status: 'PENDING' | 'MATCHED' | 'UNMATCHED' | 'CONFIRMED' | 'REJECTED'
  employee?: { id: string; name: string; employeeCode: string } | null
}

interface EmployeeOption { id: string; name: string; employeeCode: string; status?: string }

export default function Form16BulkUploadPage() {
  const fileRef = useRef<HTMLInputElement>(null)
  const [files, setFiles] = useState<File[]>([])
  const [uploading, setUploading] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [items, setItems] = useState<BulkItem[]>([])
  const [error, setError] = useState('')
  const [employees, setEmployees] = useState<EmployeeOption[]>([])
  const [results, setResults] = useState<any[] | null>(null)

  async function loadEmployees() {
    if (employees.length) return
    const res = await api.get('/api/form16/all-employees')
    const list = (res.data?.data || []).map((e: any) => ({ id: e.id, name: e.name, employeeCode: e.employeeCode, status: e.status }))
    setEmployees(list)
  }

  function handleFilesSelected(fileList: FileList | null) {
    if (!fileList) return
    const arr = Array.from(fileList).filter(f => f.type === 'application/pdf')
    setFiles(arr.slice(0, 100))
  }

  async function handleUpload() {
    if (!files.length) return
    setUploading(true)
    setError('')
    setResults(null)
    try {
      const formData = new FormData()
      files.forEach(f => formData.append('files', f))
      const res = await api.post('/api/form16/bulk-upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      const data = res.data.data
      setSessionId(data.sessionId)
      setItems(data.items)
      await loadEmployees()
    } catch (e: any) {
      setError(e?.response?.data?.error || 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  async function handleManualMatch(itemId: string, employeeId: string) {
    if (!employeeId) return
    try {
      const res = await api.put(`/api/form16/bulk-items/${itemId}`, { employeeId })
      setItems(prev => prev.map(i => i.id === itemId ? res.data.data : i))
    } catch (e: any) {
      setError(e?.response?.data?.error || 'Match update failed')
    }
  }

  async function handleReject(itemId: string) {
    try {
      await api.delete(`/api/form16/bulk-items/${itemId}`)
      setItems(prev => prev.map(i => i.id === itemId ? { ...i, status: 'REJECTED' } : i))
    } catch (e: any) {
      setError(e?.response?.data?.error || 'Reject failed')
    }
  }

  async function handleConfirm() {
    if (!sessionId) return
    setConfirming(true)
    setError('')
    try {
      const res = await api.post(`/api/form16/bulk-confirm/${sessionId}`)
      setResults(res.data.data.results)
      setItems(prev => prev.map(i => {
        const r = res.data.data.results.find((x: any) => x.itemId === i.id)
        if (!r) return i
        return { ...i, status: r.success ? 'CONFIRMED' : i.status }
      }))
    } catch (e: any) {
      setError(e?.response?.data?.error || 'Confirm failed')
    } finally {
      setConfirming(false)
    }
  }

  const matchedCount = items.filter(i => i.status === 'MATCHED').length
  const unmatchedCount = items.filter(i => i.status === 'UNMATCHED').length
  const showReview = items.length > 0

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">Bulk Form 16 Upload</h1>
        <p className="text-sm text-slate-500 mt-1">Upload up to 100 PDFs. System matches Part A + B and employees automatically.</p>
      </div>

      {error && <Alert type="error" message={error} />}

      {!showReview && (
        <div className="border-2 border-dashed border-slate-300 rounded-2xl p-10 text-center bg-slate-50/50">
          <UploadCloud className="mx-auto text-slate-400" size={40} />
          <p className="mt-3 text-sm text-slate-600">Select up to 100 Form 16 PDFs (Part A and Part B mixed)</p>
          <input
            ref={fileRef} type="file" accept="application/pdf" multiple className="hidden"
            onChange={e => handleFilesSelected(e.target.files)}
          />
          <Button className="mt-4" onClick={() => fileRef.current?.click()}>Choose Files</Button>
          {files.length > 0 && (
            <p className="mt-3 text-sm text-slate-700 font-medium">{files.length} files selected</p>
          )}
          {files.length > 0 && (
            <Button className="mt-4" onClick={handleUpload} disabled={uploading}>
              {uploading ? <><Loader2 className="animate-spin mr-2" size={16} />Processing…</> : 'Upload & Match'}
            </Button>
          )}
        </div>
      )}

      {showReview && (
        <div className="space-y-4">
          <div className="flex gap-4 text-sm">
            <span className="px-3 py-1.5 rounded-lg bg-emerald-50 text-emerald-700 font-medium">{matchedCount} matched</span>
            <span className="px-3 py-1.5 rounded-lg bg-amber-50 text-amber-700 font-medium">{unmatchedCount} unmatched</span>
          </div>

          <div className="border border-slate-200 rounded-2xl overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="text-left px-4 py-2.5 font-medium">Employee</th>
                  <th className="text-left px-4 py-2.5 font-medium">PAN</th>
                  <th className="text-left px-4 py-2.5 font-medium">Files</th>
                  <th className="text-left px-4 py-2.5 font-medium">Confidence</th>
                  <th className="text-left px-4 py-2.5 font-medium">Status</th>
                  <th className="text-left px-4 py-2.5 font-medium">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items.map(item => (
                  <tr key={item.id} className={item.status === 'REJECTED' ? 'opacity-40' : ''}>
                    <td className="px-4 py-2.5">
                      {item.employee?.name || item.matchedName || <span className="text-slate-400">Unknown</span>}
                      {item.employee?.employeeCode && <span className="text-slate-400 text-xs ml-1">({item.employee.employeeCode})</span>}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs">{item.extractedPan || '—'}</td>
                    <td className="px-4 py-2.5 text-xs">
                      <div className="flex items-center gap-1"><FileText size={12} />{item.partAFileName}</div>
                      {item.partBFileName && <div className="flex items-center gap-1 text-slate-400"><FileText size={12} />{item.partBFileName}</div>}
                      {!item.partBFileName && <div className="text-amber-600 text-xs mt-0.5">Part B missing</div>}
                    </td>
                    <td className="px-4 py-2.5">{item.matchConfidence ?? 0}%</td>
                    <td className="px-4 py-2.5">
                      {item.status === 'MATCHED' && <span className="inline-flex items-center gap-1 text-emerald-600"><CheckCircle2 size={14} />Matched</span>}
                      {item.status === 'UNMATCHED' && <span className="inline-flex items-center gap-1 text-amber-600"><AlertTriangle size={14} />Unmatched</span>}
                      {item.status === 'CONFIRMED' && <span className="inline-flex items-center gap-1 text-brand-600"><CheckCircle2 size={14} />Uploaded</span>}
                      {item.status === 'REJECTED' && <span className="inline-flex items-center gap-1 text-slate-400"><XCircle size={14} />Excluded</span>}
                    </td>
                    <td className="px-4 py-2.5">
                      {(item.status === 'MATCHED' || item.status === 'UNMATCHED') && (
                        <div className="flex gap-2 items-center">
                          <select
                            className="text-xs border border-slate-200 rounded-lg px-2 py-1"
                            defaultValue=""
                            onChange={e => handleManualMatch(item.id, e.target.value)}
                          >
                            <option value="">Reassign…</option>
                            {employees.map(e => (
                              <option key={e.id} value={e.id}>{e.name} ({e.employeeCode}){e.status && e.status !== 'ACTIVE' ? ` — ${e.status}` : ''}</option>
                            ))}
                          </select>
                          <button className="text-xs text-red-500 hover:underline" onClick={() => handleReject(item.id)}>Exclude</button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {!results && (
            <div className="flex justify-end gap-3">
              <Button variant="secondary" onClick={() => { setItems([]); setFiles([]); setSessionId(null) }}>Cancel</Button>
              <Button onClick={handleConfirm} disabled={confirming || matchedCount === 0}>
                {confirming ? <><Loader2 className="animate-spin mr-2" size={16} />Uploading…</> : `Confirm & Upload ${matchedCount} Form 16s`}
              </Button>
            </div>
          )}

          {results && (
            <Alert
              type={results.every(r => r.success) ? 'success' : 'error'}
              message={`${results.filter(r => r.success).length} uploaded, ${results.filter(r => !r.success).length} failed.`}
            />
          )}
        </div>
      )}
    </div>
  )
}
