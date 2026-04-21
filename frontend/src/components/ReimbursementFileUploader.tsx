import { useRef, useState } from 'react'
import { Camera, Upload, X, FileText, ImageIcon } from 'lucide-react'

interface Props {
  files: File[]
  onChange: (files: File[]) => void
  max?: number
  disabled?: boolean
}

const MAX_SIZE = 10 * 1024 * 1024 // 10MB
const ALLOWED  = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf']

export default function ReimbursementFileUploader({ files, onChange, max = 5, disabled }: Props) {
  const fileRef   = useRef<HTMLInputElement>(null)
  const cameraRef = useRef<HTMLInputElement>(null)
  const [error, setError] = useState('')

  function handle(list: FileList | null) {
    if (!list || !list.length) return
    const incoming = Array.from(list)
    const valid: File[] = []
    for (const f of incoming) {
      if (!ALLOWED.includes(f.type) && !/\.(jpe?g|png|webp|heic|heif|pdf)$/i.test(f.name)) {
        setError(`"${f.name}": unsupported file type`)
        continue
      }
      if (f.size > MAX_SIZE) { setError(`"${f.name}": over 10MB`); continue }
      valid.push(f)
    }
    const combined = [...files, ...valid].slice(0, max)
    onChange(combined)
    if (combined.length === max && (files.length + valid.length) > max) {
      setError(`Maximum ${max} files allowed`)
    } else if (valid.length) {
      setError('')
    }
  }

  function remove(idx: number) {
    onChange(files.filter((_, i) => i !== idx))
    setError('')
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <button
          type="button"
          disabled={disabled || files.length >= max}
          onClick={() => cameraRef.current?.click()}
          className="flex-1 flex items-center justify-center gap-2 px-3 py-2 border border-slate-300 rounded-lg text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Camera size={16} /> Camera
        </button>
        <button
          type="button"
          disabled={disabled || files.length >= max}
          onClick={() => fileRef.current?.click()}
          className="flex-1 flex items-center justify-center gap-2 px-3 py-2 border border-slate-300 rounded-lg text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Upload size={16} /> Upload files
        </button>
      </div>

      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={e => { handle(e.target.files); e.target.value = '' }}
      />
      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf"
        multiple
        className="hidden"
        onChange={e => { handle(e.target.files); e.target.value = '' }}
      />

      {error && <p className="text-xs text-rose-600">{error}</p>}
      <p className="text-xs text-slate-500">
        {files.length} / {max} files · JPG, PNG, WEBP, HEIC, PDF · max 10MB each
      </p>

      {files.length > 0 && (
        <div className="space-y-1.5">
          {files.map((f, i) => (
            <div key={i} className="flex items-center gap-2 px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg">
              {f.type.startsWith('image/')
                ? <ImageIcon size={14} className="text-slate-500 shrink-0" />
                : <FileText  size={14} className="text-slate-500 shrink-0" />}
              <span className="text-xs text-slate-700 flex-1 truncate">{f.name}</span>
              <span className="text-xs text-slate-400">{(f.size / 1024).toFixed(0)} KB</span>
              <button
                type="button"
                disabled={disabled}
                onClick={() => remove(i)}
                className="text-slate-400 hover:text-rose-600 disabled:opacity-40"
              >
                <X size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
