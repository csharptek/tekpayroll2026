import { useState, useRef } from 'react'
import { Upload, Download, CheckCircle2, AlertCircle, FileSpreadsheet } from 'lucide-react'
import { PageHeader, Button, Card, Alert } from '../../components/ui'

const TEMPLATE_COLUMNS = [
  'employeeCode', 'name', 'email', 'joiningDate', 'department',
  'jobTitle', 'state', 'annualCtc', 'annualIncentive',
  'panNumber', 'aadhaarNumber', 'pfNumber', 'bankName',
  'accountNumber', 'ifscCode', 'mobilePhone'
]

const SAMPLE_ROWS = [
  ['CST-001', 'Rahul Sharma', 'rahul@csharptek.com', '2024-01-15', 'Engineering', 'Senior Developer', 'Maharashtra', '720000', '60000', 'ABCDE1234F', '', 'PF001', 'HDFC Bank', '50100123456789', 'HDFC0001234', '+91 9876543210'],
  ['CST-002', 'Priya Patel',  'priya@csharptek.com', '2024-03-01', 'Product',     'Product Manager',  'Karnataka',   '840000', '84000', 'FGHIJ5678K', '', 'PF002', 'ICICI Bank', '100200345678',  'ICIC0001234', '+91 9876543211'],
]

export default function BulkImportPage() {
  const fileRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [status, setStatus] = useState<'idle' | 'validating' | 'done' | 'error'>('idle')
  const [results, setResults] = useState<{ success: number; failed: number; errors: any[] } | null>(null)

  function downloadTemplate() {
    const rows = [TEMPLATE_COLUMNS, ...SAMPLE_ROWS]
    const csv  = rows.map(r => r.join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href = url; a.download = 'csharptek_employee_import_template.csv'; a.click()
    URL.revokeObjectURL(url)
  }

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (f) setFile(f)
  }

  function handleUpload() {
    if (!file) return
    setStatus('validating')
    // Stub — real parser in Stage 5 backend implementation
    setTimeout(() => {
      setStatus('done')
      setResults({ success: 2, failed: 0, errors: [] })
    }, 1500)
  }

  return (
    <div className="space-y-5 max-w-3xl">
      <PageHeader title="Bulk Employee Import" subtitle="Import multiple employees at once using an Excel or CSV file" />

      {/* Step 1 — download template */}
      <Card>
        <div className="p-5">
          <div className="flex items-start gap-4">
            <div className="w-10 h-10 rounded-xl bg-brand-50 flex items-center justify-center flex-shrink-0">
              <span className="text-base font-display font-bold text-brand-700">1</span>
            </div>
            <div className="flex-1">
              <p className="text-sm font-semibold text-slate-800 mb-1">Download the template</p>
              <p className="text-xs text-slate-500 mb-4">
                Fill in the CSV template with your employee data. Do not change column headers.
                Mandatory columns: <span className="font-mono text-xs bg-slate-100 px-1 rounded">employeeCode</span>,
                <span className="font-mono text-xs bg-slate-100 px-1 rounded mx-1">name</span>,
                <span className="font-mono text-xs bg-slate-100 px-1 rounded">email</span>,
                <span className="font-mono text-xs bg-slate-100 px-1 rounded mx-1">joiningDate</span>,
                <span className="font-mono text-xs bg-slate-100 px-1 rounded">annualCtc</span>
              </p>
              <Button variant="secondary" icon={<Download size={14} />} onClick={downloadTemplate}>
                Download CSV Template
              </Button>
            </div>
          </div>
        </div>
      </Card>

      {/* Step 2 — upload */}
      <Card>
        <div className="p-5">
          <div className="flex items-start gap-4">
            <div className="w-10 h-10 rounded-xl bg-brand-50 flex items-center justify-center flex-shrink-0">
              <span className="text-base font-display font-bold text-brand-700">2</span>
            </div>
            <div className="flex-1">
              <p className="text-sm font-semibold text-slate-800 mb-1">Upload filled file</p>
              <p className="text-xs text-slate-500 mb-4">Upload your completed CSV or Excel file. The system will validate each row before importing.</p>

              <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls" onChange={handleFile} className="hidden" />

              {!file ? (
                <div
                  onClick={() => fileRef.current?.click()}
                  className="border-2 border-dashed border-slate-200 rounded-xl p-10 text-center cursor-pointer hover:border-brand-300 hover:bg-brand-50/30 transition-colors"
                >
                  <FileSpreadsheet size={32} className="text-slate-300 mx-auto mb-3" />
                  <p className="text-sm font-medium text-slate-600">Click to select file</p>
                  <p className="text-xs text-slate-400 mt-1">CSV, XLS or XLSX — max 5MB</p>
                </div>
              ) : (
                <div className="border border-slate-200 rounded-xl p-4 flex items-center gap-3">
                  <FileSpreadsheet size={20} className="text-emerald-500" />
                  <div className="flex-1">
                    <p className="text-sm font-medium text-slate-800">{file.name}</p>
                    <p className="text-xs text-slate-400">{(file.size / 1024).toFixed(1)} KB</p>
                  </div>
                  <button onClick={() => { setFile(null); setStatus('idle'); setResults(null) }}
                    className="text-xs text-slate-400 hover:text-red-500">Remove</button>
                </div>
              )}

              {file && status === 'idle' && (
                <div className="mt-4">
                  <Button icon={<Upload size={14} />} onClick={handleUpload}>Validate & Import</Button>
                </div>
              )}

              {status === 'validating' && (
                <Alert type="info" message="Validating file and importing records…" />
              )}
            </div>
          </div>
        </div>
      </Card>

      {/* Results */}
      {results && (
        <Card>
          <div className="p-5">
            <p className="text-sm font-semibold text-slate-800 mb-4">Import Results</p>
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div className="flex items-center gap-3 bg-emerald-50 rounded-xl p-4">
                <CheckCircle2 size={20} className="text-emerald-500" />
                <div>
                  <p className="text-xs text-emerald-600">Imported Successfully</p>
                  <p className="text-2xl font-display font-bold text-emerald-800">{results.success}</p>
                </div>
              </div>
              <div className="flex items-center gap-3 bg-red-50 rounded-xl p-4">
                <AlertCircle size={20} className="text-red-400" />
                <div>
                  <p className="text-xs text-red-500">Failed Rows</p>
                  <p className="text-2xl font-display font-bold text-red-700">{results.failed}</p>
                </div>
              </div>
            </div>
            {results.errors.length > 0 && (
              <div className="bg-red-50 rounded-xl p-4 space-y-2">
                {results.errors.map((err: any, i: number) => (
                  <div key={i} className="text-xs text-red-700">Row {err.row}: {err.message}</div>
                ))}
              </div>
            )}
            {results.failed === 0 && (
              <Alert type="success" message={`All ${results.success} employees imported successfully. Bank details and compliance info can be added from each employee's profile.`} />
            )}
          </div>
        </Card>
      )}
    </div>
  )
}
