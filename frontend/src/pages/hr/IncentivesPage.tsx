import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Gift, RefreshCw } from 'lucide-react'
import { payrollApi, payslipApi, employeeApi } from '../../services/api'
import { PageHeader, Card, Button, Input, Alert, Skeleton, StatusBadge } from '../../components/ui'

const INCENTIVE_TDS_PERCENT = 10

export default function IncentivesPage() {
  const qc = useQueryClient()

  const [employeeId, setEmployeeId] = useState('')
  const [entryId, setEntryId]       = useState('')
  const [incentive, setIncentive]   = useState('')
  const [tdsOverride, setTdsOverride] = useState('')
  const [note, setNote]             = useState('')
  const [error, setError]           = useState('')
  const [success, setSuccess]       = useState('')

  const { data: employees, isLoading: loadingEmp } = useQuery({
    queryKey: ['employees-active'],
    queryFn: () => employeeApi.list({ status: 'ACTIVE', limit: 500 }).then((r: any) => r.data.data),
  })

  const { data: entries, isLoading: loadingEntries } = useQuery({
    queryKey: ['payroll-entries-for-employee', employeeId],
    queryFn: () => payrollApi.entriesForEmployee(employeeId).then((r: any) => r.data.data),
    enabled: !!employeeId,
  })

  const selectedEntry = useMemo(
    () => (entries || []).find((e: any) => e.id === entryId),
    [entries, entryId]
  )

  const isLocked = selectedEntry && ['LOCKED', 'DISBURSED'].includes(selectedEntry.cycle.status)

  const computedTds = incentive
    ? Math.round(Number(incentive) * INCENTIVE_TDS_PERCENT) / 100
    : 0
  const finalTds = tdsOverride !== '' ? Number(tdsOverride) : computedTds

  const saveMut = useMutation({
    mutationFn: async () => {
      if (isLocked) {
        return payrollApi.setIncentiveLocked(entryId, {
          incentive: Number(incentive),
          ...(tdsOverride !== '' ? { incentiveTdsAmount: Number(tdsOverride) } : {}),
          note,
        })
      }
      return payrollApi.adjustEntry(entryId, {
        incentive: Number(incentive),
        ...(tdsOverride !== '' ? { incentiveTdsAmount: Number(tdsOverride) } : {}),
        adjustmentNote: note || undefined,
      })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['payroll-entries-for-employee', employeeId] })
      setSuccess('Incentive saved. Regenerate the payslip to reflect it on the PDF.')
      setError('')
    },
    onError: (e: any) => setError(e?.response?.data?.error || 'Failed to save incentive'),
  })

  const regenMut = useMutation({
    mutationFn: () => payslipApi.regenerate(entryId),
    onSuccess: () => setSuccess('Payslip regenerated.'),
    onError: (e: any) => setError(e?.response?.data?.error || 'Failed to regenerate payslip'),
  })

  function submit() {
    setError('')
    setSuccess('')
    if (!entryId) return setError('Select employee and payroll cycle')
    if (!incentive || Number(incentive) <= 0) return setError('Enter a valid incentive amount')
    if (isLocked && !note.trim()) return setError('Note is required when the cycle is locked/disbursed')
    saveMut.mutate()
  }

  return (
    <div className="space-y-5 max-w-2xl">
      <PageHeader title="Incentives" subtitle="Add a one-off incentive to an employee's payroll entry — 10% TDS applied automatically" />

      <Alert type="info" title="How this works"
        message="Pick the employee and the payroll cycle. If that cycle is still unlocked, the change applies immediately. If it's already locked or disbursed, it's applied as a scoped correction to that one employee only — the rest of the cycle is untouched. Regenerate the payslip afterwards so the PDF reflects it." />

      <Card>
        <div className="p-5 space-y-4">
          <div>
            <label className="text-xs font-medium text-slate-500 mb-1 block">Employee</label>
            <select className="input" value={employeeId}
              onChange={e => { setEmployeeId(e.target.value); setEntryId(''); setSuccess(''); setError('') }}>
              <option value="">Select employee…</option>
              {(employees || []).map((emp: any) => (
                <option key={emp.id} value={emp.id}>{emp.name} · {emp.employeeCode}</option>
              ))}
            </select>
          </div>

          {employeeId && (
            <div>
              <label className="text-xs font-medium text-slate-500 mb-1 block">Payroll cycle</label>
              {loadingEntries ? <Skeleton className="h-9" /> : (
                <select className="input" value={entryId}
                  onChange={e => { setEntryId(e.target.value); setSuccess(''); setError('') }}>
                  <option value="">Select cycle…</option>
                  {(entries || []).map((en: any) => (
                    <option key={en.id} value={en.id}>
                      {en.cycle.payrollMonth} — {en.cycle.status}
                      {Number(en.incentive) > 0 ? ` (existing incentive ₹${en.incentive})` : ''}
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}

          {selectedEntry && (
            <>
              <div className="flex items-center gap-2">
                <StatusBadge status={selectedEntry.cycle.status} />
                <span className="text-xs text-slate-400">Current net salary: ₹{Number(selectedEntry.netSalary).toLocaleString('en-IN')}</span>
              </div>

              {isLocked && (
                <Alert type="warning" message="This cycle is locked/disbursed. This will be applied as a scoped single-employee correction — a reason is required." />
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-slate-500 mb-1 block">Incentive amount (₹) <span className="text-rose-500">*</span></label>
                  <Input type="number" inputMode="decimal" value={incentive} onChange={e => setIncentive(e.target.value)} />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-500 mb-1 block">TDS on incentive (₹)</label>
                  <Input type="number" inputMode="decimal" value={tdsOverride}
                    placeholder={computedTds ? String(computedTds) : `Auto (${INCENTIVE_TDS_PERCENT}%)`}
                    onChange={e => setTdsOverride(e.target.value)} />
                </div>
              </div>
              <p className="text-xs text-slate-400 -mt-2">
                Net effect on this payslip: +₹{incentive || 0} − ₹{finalTds || 0} TDS
              </p>

              <div>
                <label className="text-xs font-medium text-slate-500 mb-1 block">
                  Note {isLocked && <span className="text-rose-500">*</span>}
                </label>
                <Input value={note} onChange={e => setNote(e.target.value)}
                  placeholder="Reason for this incentive" />
              </div>

              {error && <Alert type="error" message={error} />}
              {success && <Alert type="success" message={success} />}

              <div className="flex justify-end gap-2 pt-2">
                {selectedEntry && Number(selectedEntry.incentive) > 0 && (
                  <Button variant="ghost" icon={<RefreshCw size={14} />}
                    loading={regenMut.isPending} onClick={() => regenMut.mutate()}>
                    Regenerate Payslip
                  </Button>
                )}
                <Button icon={<Gift size={14} />} loading={saveMut.isPending} onClick={submit}>
                  Save Incentive
                </Button>
              </div>
            </>
          )}
        </div>
      </Card>
    </div>
  )
}
