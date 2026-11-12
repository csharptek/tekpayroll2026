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

export function saveBlob(data: BlobPart, fileName: string, type = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') {
  const blob = new Blob([data], { type })
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
  const [lop, setLop] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState('')
  const [warn, setWarn] = useState('')

  const { data, isLoading } = useQuery({
    queryKey: ['pf-sheet-employees', cycleId],
    queryFn: () => payrollApi.pfSheetEmployees(cycleId).then(r => r.data.data),
    enabled: open && !!cycleId,
  })

  useEffect(() => {
    if (data) {
      setEntrySel(new Set<string>(data.entries.map((e: any) => e.id)))
      setExtraSel(new Set<string>((data.others || []).filter((o: any) => o.autoInclude).map((o: any) => o.id)))
      setLop({})
      setNote('')
      setErr('')
      setWarn('')
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

  async function download(format: 'xlsx' | 'ecr' | 'esic' = 'xlsx') {
    setBusy(format)
    setErr('')
    setWarn('')
    try {
      const res = await payrollApi.pfSheetExport(cycleId, {
        format,
        entryEmployeeIds: Array.from(entrySel),
        extraEmployeeIds: Array.from(extraSel),
        extraLop: Object.fromEntries(
          Array.from(extraSel).map(id => [id, Number(lop[id] ?? (data?.others || []).find((o: any) => o.id === id)?.lopDays ?? 0) || 0])
        ),
        note: note.trim() || undefined,
      })
      const month = data?.payrollMonth || 'export'
      if (format === 'ecr') {
        saveBlob(res.data, `ecr-${month}.txt`, 'text/plain')
      } else {
        saveBlob(res.data, format === 'esic' ? `esic-${month}.xlsx` : `pf-sheet-${month}.xlsx`)
      }
      const missing = decodeURIComponent(String(res.headers?.['x-missing'] || ''))
      if (missing) {
        setWarn(`${format === 'ecr' ? 'UAN' : 'ESIC IP no.'} missing — excluded: ${missing}`)
      } else if (format === 'xlsx') {
        qc.invalidateQueries({ queryKey: ['pf-sheets'] })
        onClose()
      }
      if (format === 'xlsx') qc.invalidateQueries({ queryKey: ['pf-sheets'] })
    } catch (e: any) {
      setErr('Export failed')
    } finally {
      setBusy(null)
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
          {!err && warn && <span className="text-xs text-amber-600 mr-auto self-center max-w-xs">{warn}</span>}
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="secondary" icon={<Download size={14} />} loading={busy === 'ecr'} disabled={total === 0 || !!busy} onClick={() => download('ecr')}>
            ECR .txt
          </Button>
          <Button variant="secondary" icon={<Download size={14} />} loading={busy === 'esic'} disabled={total === 0 || !!busy} onClick={() => download('esic')}>
            ESIC .xlsx
          </Button>
          <Button icon={<Download size={14} />} loading={busy === 'xlsx'} disabled={total === 0 || !!busy} onClick={() => download('xlsx')}>
            PF Sheet ({total})
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
            <p className="text-xs text-slate-400 mb-2">Prorated for joining / last working day. Set LOP days if any. Exited this month and unpaid-leave employees are pre-selected.</p>
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
                  {o.tag && <span className="text-xs text-blue-600">{o.tag}</span>}
                  {!o.tag && o.skipReason && <span className="text-xs text-amber-600">Skipped: {o.skipReason}</span>}
                  <span className="text-xs text-slate-500">{o.payableDays}/{o.totalDays} days</span>
                  {extraSel.has(o.id) && (
                    <span className="flex items-center gap-1 text-xs text-slate-500" onClick={e => e.preventDefault()}>
                      LOP
                      <input
                        type="number" min={0} step={0.5}
                        className="input w-16 py-1"
                        value={lop[o.id] ?? String(o.lopDays ?? 0)}
                        onChange={e => setLop({ ...lop, [o.id]: e.target.value })}
                      />
                    </span>
                  )}
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
