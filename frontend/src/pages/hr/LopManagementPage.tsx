import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Save, Upload, AlertCircle } from 'lucide-react'
import { payrollApi, lopApi, employeeApi } from '../../services/api'
import {
  PageHeader, Button, Card, Alert, Skeleton,
  Table, Th, Td, Tr, Input
} from '../../components/ui'

export default function LopManagementPage() {
  const { id: cycleId } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [lopValues, setLopValues] = useState<Record<string, { days: string; reason: string }>>({})
  const [saved, setSaved] = useState(false)

  const { data: cycle } = useQuery({
    queryKey: ['payroll-cycle-meta', cycleId],
    queryFn: () => payrollApi.cycles().then(r => r.data.data.find((c: any) => c.id === cycleId)),
    enabled: !!cycleId,
  })

  const { data: employees, isLoading: loadingEmp } = useQuery({
    queryKey: ['employees-active'],
    queryFn: () => employeeApi.list({ status: 'ACTIVE', limit: 200 }).then(r => r.data.data),
  })

  const { data: existingLop, isLoading: loadingLop } = useQuery({
    queryKey: ['lop-entries', cycleId],
    queryFn: () => lopApi.list(cycleId!).then(r => r.data.data),
    enabled: !!cycleId,
    onSuccess: (data: any[]) => {
      const init: Record<string, { days: string; reason: string }> = {}
      data.forEach((e: any) => {
        init[e.employeeId] = { days: String(e.lopDays), reason: e.reason || '' }
      })
      setLopValues(init)
    },
  })

  const saveMut = useMutation({
    mutationFn: async () => {
      const promises = Object.entries(lopValues)
        .filter(([, v]) => v.days && parseInt(v.days) > 0)
        .map(([employeeId, v]) =>
          lopApi.upsert({ cycleId, employeeId, lopDays: parseInt(v.days), reason: v.reason })
        )
      await Promise.all(promises)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lop-entries', cycleId] })
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    },
  })

  const isLoading = loadingEmp || loadingLop

  function getValue(empId: string) {
    return lopValues[empId] || { days: '', reason: '' }
  }

  function setDays(empId: string, days: string) {
    setLopValues(prev => ({ ...prev, [empId]: { ...getValue(empId), days } }))
  }

  function setReason(empId: string, reason: string) {
    setLopValues(prev => ({ ...prev, [empId]: { ...getValue(empId), reason } }))
  }

  const totalLopEmployees = Object.values(lopValues).filter(v => v.days && parseInt(v.days) > 0).length

  return (
    <div className="space-y-5 max-w-5xl">
      <PageHeader
        title="LOP Management"
        subtitle={`Cycle: ${cycle?.payrollMonth || cycleId}`}
        actions={
          <div className="flex gap-2">
            <Button variant="ghost" icon={<ArrowLeft size={14} />} onClick={() => navigate('/hr/payroll')}>Back</Button>
            <Button icon={<Save size={14} />} loading={saveMut.isPending} onClick={() => saveMut.mutate()}>
              Save LOP Entries
            </Button>
          </div>
        }
      />

      <div className="grid grid-cols-3 gap-4">
        {[
          { label: 'Total Employees', value: employees?.length ?? '—' },
          { label: 'With LOP', value: totalLopEmployees },
          { label: 'Total LOP Days', value: Object.values(lopValues).reduce((s, v) => s + (parseInt(v.days) || 0), 0) },
        ].map(({ label, value }) => (
          <div key={label} className="card p-4">
            <p className="stat-label">{label}</p>
            <p className="text-2xl font-display font-bold text-slate-900 mt-1">{value}</p>
          </div>
        ))}
      </div>

      {saved && <Alert type="success" message="LOP entries saved successfully." />}
      {saveMut.isError && <Alert type="error" message="Failed to save some entries. Please retry." />}

      <Alert type="info" title="How LOP works"
        message="Enter unapproved leave days for each employee. Leave blank or 0 for no LOP. LOP Amount = (Gross / Total Cycle Days) × LOP Days." />

      <Card>
        <div className="p-4 flex items-center justify-between border-b border-slate-100">
          <p className="section-title">Employee LOP Entry</p>
          <span className="text-xs text-slate-400">Only enter days with unapproved leaves</span>
        </div>

        {isLoading ? <Skeleton className="h-64 m-4" /> : (
          <Table>
            <thead>
              <tr className="border-b border-slate-100">
                <Th>Employee</Th>
                <Th>Department</Th>
                <Th className="w-32">LOP Days</Th>
                <Th>Reason</Th>
              </tr>
            </thead>
            <tbody>
              {(employees || []).map((emp: any) => {
                const val = getValue(emp.id)
                const hasLop = val.days && parseInt(val.days) > 0
                return (
                  <Tr key={emp.id} className={hasLop ? 'bg-amber-50/40' : ''}>
                    <Td>
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-full bg-brand-100 flex items-center justify-center flex-shrink-0">
                          <span className="text-xs font-semibold text-brand-700">{emp.name.charAt(0)}</span>
                        </div>
                        <div>
                          <p className="text-sm font-medium text-slate-800">{emp.name}</p>
                          <p className="text-xs text-slate-400 font-mono">{emp.employeeCode}</p>
                        </div>
                      </div>
                    </Td>
                    <Td>{emp.department || '—'}</Td>
                    <Td>
                      <input
                        type="number"
                        min="0"
                        max="31"
                        value={val.days}
                        onChange={e => setDays(emp.id, e.target.value)}
                        placeholder="0"
                        className="input w-24 text-center font-mono"
                      />
                    </Td>
                    <Td>
                      <input
                        type="text"
                        value={val.reason}
                        onChange={e => setReason(emp.id, e.target.value)}
                        placeholder={hasLop ? "Reason for LOP…" : "—"}
                        disabled={!hasLop}
                        className="input w-full text-sm disabled:opacity-40 disabled:cursor-not-allowed"
                      />
                    </Td>
                  </Tr>
                )
              })}
            </tbody>
          </Table>
        )}

        <div className="p-4 border-t border-slate-100 flex justify-end">
          <Button icon={<Save size={14} />} loading={saveMut.isPending} onClick={() => saveMut.mutate()}>
            Save All LOP Entries
          </Button>
        </div>
      </Card>
    </div>
  )
}
