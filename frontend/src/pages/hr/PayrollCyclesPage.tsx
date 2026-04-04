import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Plus, Play, Lock, Banknote, Eye, ChevronRight, Calendar } from 'lucide-react'
import { format } from 'date-fns'
import { payrollApi } from '../../services/api'
import {
  PageHeader, Button, Card, StatusBadge, Rupee,
  Table, Th, Td, Tr, EmptyState, Skeleton, Modal, Input, Alert
} from '../../components/ui'

function NewCycleModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient()
  const [month, setMonth] = useState('')

  const mutation = useMutation({
    mutationFn: () => {
      if (!month) return Promise.reject(new Error('Select a month'))
      const [year, m] = month.split('-').map(Number)
      // cycle: 26th prev month to 25th current
      const cycleStart = new Date(year, m - 2, 26)
      const cycleEnd   = new Date(year, m - 1, 25)
      return payrollApi.createCycle({
        cycleStart: cycleStart.toISOString(),
        cycleEnd:   cycleEnd.toISOString(),
        payrollMonth: month,
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payroll-cycles'] })
      onClose()
      setMonth('')
    },
  })

  return (
    <Modal open={open} onClose={onClose} title="Create Payroll Cycle"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button loading={mutation.isPending} onClick={() => mutation.mutate()} icon={<Plus size={13} />}>Create Cycle</Button>
        </>
      }>
      <div className="space-y-4">
        <div className="flex flex-col gap-1">
          <label className="label">Payroll Month *</label>
          <input type="month" value={month} onChange={e => setMonth(e.target.value)} className="input" />
          <p className="text-xs text-slate-400">Cycle will run from 26th of previous month to 25th of selected month.</p>
        </div>
        {month && (
          <div className="bg-brand-50 rounded-xl p-3 text-xs text-brand-700 space-y-1">
            {(() => {
              const [y, m2] = month.split('-').map(Number)
              const start = new Date(y, m2 - 2, 26)
              const end   = new Date(y, m2 - 1, 25)
              return (
                <>
                  <div className="flex justify-between"><span>Cycle Start</span><strong>{format(start, 'dd MMM yyyy')}</strong></div>
                  <div className="flex justify-between"><span>Cycle End</span><strong>{format(end, 'dd MMM yyyy')}</strong></div>
                  <div className="flex justify-between"><span>Payroll Run</span><strong>27th {format(end, 'MMM yyyy')}</strong></div>
                  <div className="flex justify-between"><span>Payslips</span><strong>5th {format(new Date(y, m2, 5), 'MMM yyyy')}</strong></div>
                </>
              )
            })()}
          </div>
        )}
        {mutation.isError && <Alert type="error" message={(mutation.error as any)?.message || 'Failed to create cycle'} />}
      </div>
    </Modal>
  )
}

export default function PayrollCyclesPage() {
  const navigate = useNavigate()
  const [newOpen, setNewOpen] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ['payroll-cycles'],
    queryFn: () => payrollApi.cycles().then(r => r.data.data),
  })

  const cycles: any[] = data || []

  const statusActions: Record<string, { label: string; icon: any; to: (id: string) => string; variant?: any }> = {
    DRAFT:      { label: 'Run Payroll', icon: Play,    to: (id) => `/hr/payroll/${id}/run`,    variant: 'primary' },
    CALCULATED: { label: 'Run Payroll', icon: Play,    to: (id) => `/hr/payroll/${id}/run`,    variant: 'primary' },
    LOCKED:     { label: 'View Detail', icon: Eye,     to: (id) => `/hr/payroll/${id}/detail`, variant: 'secondary' },
    DISBURSED:  { label: 'View Detail', icon: Eye,     to: (id) => `/hr/payroll/${id}/detail`, variant: 'secondary' },
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Payroll Cycles"
        subtitle="Manage monthly payroll runs"
        actions={<Button icon={<Plus size={14} />} onClick={() => setNewOpen(true)}>New Cycle</Button>}
      />

      {/* Summary strip */}
      {cycles.length > 0 && (() => {
        const latest = cycles[0]
        return (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {[
              { label: 'Latest Cycle', value: latest.payrollMonth, sub: latest.status },
              { label: 'Employees', value: latest.employeeCount ?? '—', sub: 'in cycle' },
              { label: 'Gross Payout', value: latest.totalGross ? <Rupee amount={latest.totalGross} /> : '—', sub: 'before deductions' },
              { label: 'Net Payout',   value: latest.totalNet   ? <Rupee amount={latest.totalNet} />   : '—', sub: 'take-home total' },
            ].map(({ label, value, sub }) => (
              <div key={label} className="card p-4">
                <p className="stat-label">{label}</p>
                <p className="text-lg font-display font-bold text-slate-900 mt-1">{value}</p>
                <p className="text-xs text-slate-400 mt-0.5">{sub}</p>
              </div>
            ))}
          </div>
        )
      })()}

      <Card>
        {isLoading ? <Skeleton className="h-64 m-4" /> : cycles.length === 0 ? (
          <EmptyState
            icon={<Calendar size={22} />}
            title="No payroll cycles yet"
            description="Create your first payroll cycle to get started."
            action={<Button size="sm" icon={<Plus size={13} />} onClick={() => setNewOpen(true)}>Create First Cycle</Button>}
          />
        ) : (
          <Table>
            <thead>
              <tr className="border-b border-slate-100">
                <Th>Month</Th>
                <Th>Cycle Period</Th>
                <Th className="text-right">Employees</Th>
                <Th className="text-right">Gross</Th>
                <Th className="text-right">Net</Th>
                <Th>Status</Th>
                <Th>Actions</Th>
              </tr>
            </thead>
            <tbody>
              {cycles.map((cycle: any) => {
                const action = statusActions[cycle.status]
                return (
                  <Tr key={cycle.id}>
                    <Td>
                      <span className="font-semibold text-slate-800">{cycle.payrollMonth}</span>
                    </Td>
                    <Td>
                      <span className="text-xs text-slate-500">
                        {format(new Date(cycle.cycleStart), 'dd MMM')} – {format(new Date(cycle.cycleEnd), 'dd MMM yyyy')}
                      </span>
                    </Td>
                    <Td className="text-right">{cycle.employeeCount ?? '—'}</Td>
                    <Td className="text-right">
                      {cycle.totalGross ? <Rupee amount={cycle.totalGross} /> : <span className="text-slate-300">—</span>}
                    </Td>
                    <Td className="text-right font-semibold">
                      {cycle.totalNet ? <Rupee amount={cycle.totalNet} /> : <span className="text-slate-300">—</span>}
                    </Td>
                    <Td><StatusBadge status={cycle.status} /></Td>
                    <Td>
                      <div className="flex items-center gap-2">
                        {action && (
                          <Button size="sm" variant={action.variant || 'secondary'} icon={<action.icon size={12} />}
                            onClick={() => navigate(action.to(cycle.id))}>
                            {action.label}
                          </Button>
                        )}
                        <button onClick={() => navigate(`/hr/payroll/${cycle.id}/detail`)}
                          className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors">
                          <ChevronRight size={15} />
                        </button>
                      </div>
                    </Td>
                  </Tr>
                )
              })}
            </tbody>
          </Table>
        )}
      </Card>

      <NewCycleModal open={newOpen} onClose={() => setNewOpen(false)} />
    </div>
  )
}
