import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { PlusCircle, Trash2, UserPlus, CheckCircle2, XCircle, Send } from 'lucide-react'
import { leaveApi, employeeApi } from '../../services/api'
import { PageHeader, Button, Alert } from '../../components/ui'
import { DatePicker } from '../../components/DatePicker'
import clsx from 'clsx'

const LEAVE_KINDS = ['SICK', 'CASUAL', 'PLANNED'] as const
type LeaveKind = typeof LEAVE_KINDS[number]

interface LeaveRow {
  id: string
  leaveKind: LeaveKind
  startDate: string
  endDate: string
  isHalfDay: boolean
  halfDaySlot: 'FIRST_HALF' | 'SECOND_HALF'
  isLop: boolean
  reasonLabel: string
  customReason: string
}

interface EmployeeBlock {
  id: string
  employeeId: string
  rows: LeaveRow[]
}

function newRow(): LeaveRow {
  return {
    id: Math.random().toString(36).slice(2),
    leaveKind: 'SICK',
    startDate: '',
    endDate: '',
    isHalfDay: false,
    halfDaySlot: 'FIRST_HALF',
    isLop: false,
    reasonLabel: '',
    customReason: '',
  }
}

function newBlock(): EmployeeBlock {
  return { id: Math.random().toString(36).slice(2), employeeId: '', rows: [newRow()] }
}

type ResultItem = {
  index: number
  employeeId: string
  status: 'success' | 'error'
  message?: string
  data?: { id: string; totalDays: number; isLop: boolean; lopDays: number }
}

export default function BulkLeaveEntryPage() {
  const [blocks, setBlocks] = useState<EmployeeBlock[]>([newBlock()])
  const [results, setResults] = useState<ResultItem[] | null>(null)
  const [error, setError] = useState('')

  const { data: empData } = useQuery({
    queryKey: ['employees-active'],
    queryFn: () => employeeApi.list({ status: 'ACTIVE', limit: 500 }).then(r => r.data.data),
  })
  const employees: any[] = empData || []

  const { data: reasonsData } = useQuery({
    queryKey: ['leave-reasons'],
    queryFn: () => leaveApi.reasons().then(r => r.data.data),
  })
  const reasons: any[] = reasonsData || []

  const mutation = useMutation({
    mutationFn: (entries: any[]) => leaveApi.bulkEntry(entries),
    onSuccess: (res) => {
      setResults(res.data.data.results)
      setError('')
    },
    onError: (err: any) => {
      setError(err.response?.data?.message || 'Submission failed')
    },
  })

  function updateBlock(blockId: string, field: keyof EmployeeBlock, value: any) {
    setBlocks(prev => prev.map(b => b.id === blockId ? { ...b, [field]: value } : b))
  }

  function updateRow(blockId: string, rowId: string, field: keyof LeaveRow, value: any) {
    setBlocks(prev => prev.map(b => {
      if (b.id !== blockId) return b
      return { ...b, rows: b.rows.map(r => r.id === rowId ? { ...r, [field]: value } : r) }
    }))
  }

  function addRow(blockId: string) {
    setBlocks(prev => prev.map(b => b.id === blockId ? { ...b, rows: [...b.rows, newRow()] } : b))
  }

  function removeRow(blockId: string, rowId: string) {
    setBlocks(prev => prev.map(b => {
      if (b.id !== blockId) return b
      if (b.rows.length === 1) return b
      return { ...b, rows: b.rows.filter(r => r.id !== rowId) }
    }))
  }

  function removeBlock(blockId: string) {
    if (blocks.length === 1) return
    setBlocks(prev => prev.filter(b => b.id !== blockId))
  }

  function handleSubmit() {
    setError('')
    setResults(null)
    const entries: any[] = []
    let rowIndex = 0
    for (const block of blocks) {
      if (!block.employeeId) { setError('Select an employee for each block'); return }
      for (const row of block.rows) {
        if (!row.startDate || !row.reasonLabel) { setError('Fill in start date and reason for every row'); return }
        entries.push({
          employeeId:   block.employeeId,
          leaveKind:    row.leaveKind,
          startDate:    row.startDate,
          endDate:      row.endDate || row.startDate,
          isHalfDay:    row.isHalfDay,
          halfDaySlot:  row.isHalfDay ? row.halfDaySlot : undefined,
          isLop:        row.isLop,
          reasonLabel:  row.reasonLabel,
          customReason: row.customReason || undefined,
        })
        rowIndex++
      }
    }
    if (entries.length === 0) { setError('Add at least one leave entry'); return }
    mutation.mutate(entries)
  }

  function getEmpName(id: string) {
    const e = employees.find(e => e.id === id)
    return e ? `${e.name} (${e.employeeCode})` : id
  }

  const filteredReasons = (kind: LeaveKind) => reasons.filter(r => r.leaveKind === kind)

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <PageHeader
        title="Bulk Leave Entry"
        subtitle="Add or record leaves for employees — auto-approved"
      />

      {error && <Alert variant="error">{error}</Alert>}

      {/* Result table */}
      {results && (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
            <span className="font-medium text-sm text-gray-700">
              Submission Results — {results.filter(r => r.status === 'success').length} success,{' '}
              {results.filter(r => r.status === 'error').length} failed
            </span>
            <Button size="sm" variant="outline" onClick={() => { setResults(null); setBlocks([newBlock()]) }}>
              New Entry
            </Button>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
              <tr>
                <th className="px-4 py-2 text-left">#</th>
                <th className="px-4 py-2 text-left">Employee</th>
                <th className="px-4 py-2 text-left">Status</th>
                <th className="px-4 py-2 text-left">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {results.map((r, i) => (
                <tr key={i} className={r.status === 'error' ? 'bg-red-50' : ''}>
                  <td className="px-4 py-2 text-gray-400">{i + 1}</td>
                  <td className="px-4 py-2">{getEmpName(r.employeeId)}</td>
                  <td className="px-4 py-2">
                    {r.status === 'success'
                      ? <span className="flex items-center gap-1 text-emerald-600"><CheckCircle2 size={14}/> Success</span>
                      : <span className="flex items-center gap-1 text-red-600"><XCircle size={14}/> Failed</span>
                    }
                  </td>
                  <td className="px-4 py-2 text-gray-500">
                    {r.status === 'success'
                      ? `${r.data?.totalDays}d — ${r.data?.isLop ? `LOP (${r.data.lopDays}d)` : 'Leave deducted'}`
                      : r.message
                    }
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Entry blocks */}
      {!results && (
        <>
          {blocks.map((block, bi) => (
            <div key={block.id} className="bg-white border border-gray-200 rounded-xl overflow-hidden">
              {/* Employee selector header */}
              <div className="px-5 py-3 bg-gray-50 border-b border-gray-200 flex items-center gap-3">
                <span className="text-sm font-medium text-gray-600 whitespace-nowrap">Employee {bi + 1}:</span>
                <select
                  className="flex-1 text-sm border border-gray-300 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  value={block.employeeId}
                  onChange={e => updateBlock(block.id, 'employeeId', e.target.value)}
                >
                  <option value="">— Select Employee —</option>
                  {employees.map(e => (
                    <option key={e.id} value={e.id}>{e.name} ({e.employeeCode})</option>
                  ))}
                </select>
                {blocks.length > 1 && (
                  <button onClick={() => removeBlock(block.id)} className="text-gray-400 hover:text-red-500 transition-colors">
                    <Trash2 size={16} />
                  </button>
                )}
              </div>

              {/* Leave rows */}
              <div className="divide-y divide-gray-100">
                {block.rows.map((row, ri) => (
                  <div key={row.id} className="px-5 py-4">
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-xs font-medium text-gray-400 uppercase tracking-wide">Row {ri + 1}</span>
                      {block.rows.length > 1 && (
                        <button onClick={() => removeRow(block.id, row.id)} className="text-gray-300 hover:text-red-400 transition-colors">
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>

                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      {/* Leave Kind */}
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">Leave Type</label>
                        <select
                          className="w-full text-sm border border-gray-300 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                          value={row.leaveKind}
                          onChange={e => updateRow(block.id, row.id, 'leaveKind', e.target.value as LeaveKind)}
                        >
                          {LEAVE_KINDS.map(k => <option key={k} value={k}>{k}</option>)}
                        </select>
                      </div>

                      {/* Start Date */}
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">From Date</label>
                        <DatePicker
                          value={row.startDate}
                          onChange={v => updateRow(block.id, row.id, 'startDate', v)}
                        />
                      </div>

                      {/* End Date */}
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">To Date</label>
                        <DatePicker
                          value={row.endDate}
                          onChange={v => updateRow(block.id, row.id, 'endDate', v)}
                        />
                      </div>

                      {/* Reason */}
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">Reason</label>
                        <select
                          className="w-full text-sm border border-gray-300 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                          value={row.reasonLabel}
                          onChange={e => updateRow(block.id, row.id, 'reasonLabel', e.target.value)}
                        >
                          <option value="">— Select —</option>
                          {filteredReasons(row.leaveKind).map(r => (
                            <option key={r.id} value={r.label}>{r.label}</option>
                          ))}
                          <option value="__custom__">Other (custom)</option>
                        </select>
                      </div>
                    </div>

                    {/* Second row: toggles + custom reason */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
                      {/* Half Day */}
                      <div className="flex flex-col gap-1">
                        <label className="text-xs text-gray-500">Half Day</label>
                        <label className="inline-flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={row.isHalfDay}
                            onChange={e => updateRow(block.id, row.id, 'isHalfDay', e.target.checked)}
                            className="rounded border-gray-300 text-indigo-600"
                          />
                          <span className="text-sm text-gray-600">Yes</span>
                        </label>
                      </div>

                      {/* Half Day Slot — visible only if isHalfDay */}
                      {row.isHalfDay && (
                        <div>
                          <label className="block text-xs text-gray-500 mb-1">Slot</label>
                          <select
                            className="w-full text-sm border border-gray-300 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                            value={row.halfDaySlot}
                            onChange={e => updateRow(block.id, row.id, 'halfDaySlot', e.target.value)}
                          >
                            <option value="FIRST_HALF">First Half</option>
                            <option value="SECOND_HALF">Second Half</option>
                          </select>
                        </div>
                      )}

                      {/* Mark as LOP */}
                      <div className="flex flex-col gap-1">
                        <label className="text-xs text-gray-500">Mark as LOP</label>
                        <label className="inline-flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={row.isLop}
                            onChange={e => updateRow(block.id, row.id, 'isLop', e.target.checked)}
                            className="rounded border-gray-300 text-orange-500"
                          />
                          <span className={clsx('text-sm', row.isLop ? 'text-orange-600 font-medium' : 'text-gray-600')}>
                            {row.isLop ? 'LOP' : 'No'}
                          </span>
                        </label>
                      </div>

                      {/* Custom reason */}
                      {row.reasonLabel === '__custom__' && (
                        <div className="col-span-2 md:col-span-1">
                          <label className="block text-xs text-gray-500 mb-1">Custom Reason</label>
                          <input
                            type="text"
                            className="w-full text-sm border border-gray-300 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                            placeholder="Enter reason..."
                            value={row.customReason}
                            onChange={e => updateRow(block.id, row.id, 'customReason', e.target.value)}
                          />
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {/* Add row */}
              <div className="px-5 py-3 border-t border-gray-100">
                <button
                  onClick={() => addRow(block.id)}
                  className="text-sm text-indigo-600 hover:text-indigo-700 flex items-center gap-1.5 transition-colors"
                >
                  <PlusCircle size={15} /> Add Leave Row
                </button>
              </div>
            </div>
          ))}

          {/* Add employee block */}
          <button
            onClick={() => setBlocks(prev => [...prev, newBlock()])}
            className="w-full border-2 border-dashed border-gray-300 hover:border-indigo-400 rounded-xl py-4 text-sm text-gray-500 hover:text-indigo-600 flex items-center justify-center gap-2 transition-colors"
          >
            <UserPlus size={16} /> Add Another Employee
          </button>

          {/* Submit */}
          <div className="flex justify-end">
            <Button
              onClick={handleSubmit}
              disabled={mutation.isPending}
              className="flex items-center gap-2"
            >
              <Send size={15} />
              {mutation.isPending ? 'Submitting…' : 'Submit All Entries'}
            </Button>
          </div>
        </>
      )}
    </div>
  )
}
