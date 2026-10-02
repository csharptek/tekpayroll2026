import { useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Download } from 'lucide-react'
import { payrollApi } from '../services/api'
import { Modal, Button, Rupee, Skeleton } from './ui'

interface Props {
  cycleId: string
  open: boolean
  onClose: () => void
}

export function saveBlob(data: BlobPart, fileName: string) {
  const blob = new Blob([data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

export default function PfSheetModal({ cycleId, open, onClose }: Props) {
  const qc = useQueryClient()
  const [entrySel, setEntrySel] = useState<Set<string>>(new Set())
  const [extraSel, setExtraSel] = useState<Set<string>>(new Set())
  const [q, setQ] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const { data, isLoading } = useQuery({
    queryKey: ['pf-sheet-employees', cycleId],
    queryFn: () => payrollApi.pfSheetEmployees(cycleId).then(r => r.data.data),
    enabled: open && !!cycleId,
  })

  useEffect(() => {
    if (data) {
      setEntrySel(new Set<string>(data.entries.map((e: any) => e.id)))
      setExtraSel(new Set<string>())
      setNote('')
      setErr('')
      setQ('')
    }
  }, [data])

  const others = useMemo(() => {
    const list: any[] = data?.others || []
    const t = q.trim().toLowerCase()
    if (!t) return list
    return list.filter(o => o.name.toLowerCase().includes(t) || o.employeeCode.toLowerCase().includes(t))
  }, [data, q])

  function toggle(set: Set<string>, setter: (s: Set<string>) => void, id: string) {
    const n = new Set(set)
    n.has(id) ? n.delete(id) : n.add(id)
    setter(n)
  }

  async function download() {
    setBusy(true)
    setErr('')
    try {
      const res = await payrollApi.pfSheetExport(cycleId, {
        entryEmployeeIds: Array.from(entrySel),
        extraEmployeeIds: Array.from(extraSel),
        note: note.trim() || undefined,
      })
      saveBlob(res.data, `pf-sheet-${data?.payrollMonth || 'export'}.xlsx`)
      qc.invalidateQueries({ queryKey: ['pf-sheets'] })
      onClose()
    } catch (e: any) {
      setErr('Export failed')
    } finally {
      setBusy(false)
    }
  }

  const total = entrySel.size + extraSel.size
  const entries: any[] = data?.entries || []

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="xl"
      title={`PF Sheet — ${data?.payrollMonth || ''}`}
      footer={
        <>
          {err && <span className="text-sm text-red-500 mr-auto self-center">{err}</span>}
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button icon={<Download size={14} />} loading={busy} disabled={total === 0} onClick={download}>
            Download ({total})
          </Button>
        </>
      }
    >
      {isLoading || !data ? (
        <Skeleton className="h-64 rounded-xl" />
      ) : (
        <div className="space-y-5">
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-semibold text-slate-800">In this payroll ({entrySel.size}/{entries.length})</p>
              <div className="flex gap-3 text-xs">
                <button className="text-brand-600" onClick={() => setEntrySel(new Set<string>(entries.map(e => e.id)))}>All</button>
                <button className="text-brand-600" onClick={() => setEntrySel(new Set<string>())}>None</button>
              </div>
            </div>
            <div className="border border-slate-100 rounded-lg max-h-56 overflow-y-auto divide-y divide-slate-50">
              {entries.map(e => (
                <label key={e.id} className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-slate-50">
                  <input type="checkbox" checked={entrySel.has(e.id)} onChange={() => toggle(entrySel, setEntrySel, e.id)} />
                  <span className="flex-1 text-sm text-slate-800">{e.name}
                    <span className="text-xs text-slate-400 ml-2">{e.employeeCode}</span>
                  </span>
                  <span className="text-xs text-slate-500"><Rupee amount={e.gross} /></span>
                </label>
              ))}
            </div>
          </div>

          <div>
            <p className="text-sm font-semibold text-slate-800 mb-1">Add employees not in this payroll ({extraSel.size} added)</p>
            <p className="text-xs text-slate-400 mb-2">Full-month breakup from salary structure.</p>
            <input
              className="input mb-2"
              placeholder="Search name or code"
              value={q}
              onChange={e => setQ(e.target.value)}
            />
            <div className="border border-slate-100 rounded-lg max-h-56 overflow-y-auto divide-y divide-slate-50">
              {others.length === 0 && <p className="text-sm text-slate-400 px-3 py-3">No employees</p>}
              {others.map(o => (
                <label key={o.id} className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-slate-50">
                  <input type="checkbox" checked={extraSel.has(o.id)} onChange={() => toggle(extraSel, setExtraSel, o.id)} />
                  <span className="flex-1 text-sm text-slate-800">{o.name}
                    <span className="text-xs text-slate-400 ml-2">{o.employeeCode}</span>
                  </span>
                  {o.skipReason && <span className="text-xs text-amber-600">Skipped: {o.skipReason}</span>}
                </label>
              ))}
            </div>
          </div>

          <div>
            <label className="label">Note (optional)</label>
            <input className="input" value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. Sent to PF consultant" maxLength={500} />
          </div>
        </div>
      )}
    </Modal>
  )
}
