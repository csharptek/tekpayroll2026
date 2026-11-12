import { useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { format, addMonths, subMonths, parse } from 'date-fns'
import { ChevronLeft, ChevronRight, Mail, RefreshCw, AlertCircle, AlertTriangle, Info } from 'lucide-react'
import { payrollApi } from '../../services/api'
import { PageHeader, Button, Card, Table, Th, Td, Tr, Rupee, Skeleton, Alert } from '../../components/ui'
import clsx from 'clsx'

type Severity = 'error' | 'warning' | 'info'
const SEV: Record<Severity, { cls: string; icon: any }> = {
  error:   { cls: 'bg-red-50 text-red-700 border-red-200',       icon: AlertCircle },
  warning: { cls: 'bg-amber-50 text-amber-700 border-amber-200', icon: AlertTriangle },
  info:    { cls: 'bg-blue-50 text-blue-700 border-blue-200',    icon: Info },
}

function defaultMonth() {
  const now = new Date()
  return format(now.getDate() >= 28 ? addMonths(now, 1) : now, 'yyyy-MM')
}

export default function PayrollPrecheckPage() {
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const [month, setMonth] = useState<string>(params.get('month') || defaultMonth())
  const [filter, setFilter] = useState<'all' | 'issues' | 'skipped'>('issues')

  const { data, isLoading, isFetching, refetch, error } = useQuery({
    queryKey: ['payroll-precheck', month],
    queryFn: () => payrollApi.precheck(month).then(r => r.data.data),
  })

  const emailMut = useMutation({ mutationFn: () => payrollApi.precheckEmail(month) })

  function shift(delta: number) {
    const d = parse(month + '-01', 'yyyy-MM-dd', new Date())
    const m = format(delta > 0 ? addMonths(d, 1) : subMonths(d, 1), 'yyyy-MM')
    setMonth(m)
    setParams({ month: m })
  }

  const picks: any[] = data?.picks || []
  const shown = picks.filter(p =>
    filter === 'all' ? true :
    filter === 'skipped' ? !p.inManual :
    p.issues.some((i: any) => i.severity !== 'info'))

  return (
    <div className="space-y-5 max-w-6xl">
      <PageHeader
        title="Pre-run Check"
        subtitle="Read-only. Shows who payroll will pick, who is excluded, and what to fix before the run."
        actions={
          <>
            <Button variant="secondary" icon={<RefreshCw size={14} />} loading={isFetching} onClick={() => refetch()}>Refresh</Button>
            <Button variant="secondary" icon={<Mail size={14} />} loading={emailMut.isPending} onClick={() => emailMut.mutate()}>Email me</Button>
          </>
        }
      />

      <div className="flex items-center gap-3">
        <button className="p-1.5 rounded-lg hover:bg-slate-100" onClick={() => shift(-1)}><ChevronLeft size={16} /></button>
        <span className="text-sm font-semibold text-slate-800 w-28 text-center">
          {format(parse(month + '-01', 'yyyy-MM-dd', new Date()), 'MMMM yyyy')}
        </span>
        <button className="p-1.5 rounded-lg hover:bg-slate-100" onClick={() => shift(1)}><ChevronRight size={16} /></button>
        {data && (
          <span className="text-xs text-slate-500">
            Cycle {data.cycle.cycleStart} → {data.cycle.cycleEnd} · {data.cycle.exists ? `Status ${data.cycle.status}` : 'Not created yet'} · Auto run 27th
          </span>
        )}
      </div>

      {emailMut.isSuccess && <Alert type="success" message={`Sent to ${(emailMut.data as any)?.data?.data?.sentTo?.join(', ') || 'super admins'}`} />}
      {emailMut.isError && <Alert type="error" message="Email failed" />}
      {error && <Alert type="error" message="Could not load pre-run check" />}

      {isLoading || !data ? <Skeleton className="h-64 rounded-2xl" /> : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-6 gap-3">
            {[
              { label: 'Manual run pays', value: data.counts.manual },
              { label: 'Auto run pays',   value: data.counts.auto },
              { label: 'Excluded',        value: data.counts.excluded },
              { label: 'Errors',          value: data.counts.errors,   cls: data.counts.errors ? 'text-red-600' : '' },
              { label: 'Warnings',        value: data.counts.warnings, cls: data.counts.warnings ? 'text-amber-600' : '' },
              { label: 'Est. gross',      value: <Rupee amount={data.counts.estGrossManual} /> },
            ].map(c => (
              <div key={c.label} className="bg-white rounded-xl border border-slate-200 p-3">
                <p className="text-xs text-slate-400">{c.label}</p>
                <p className={clsx('text-lg font-bold text-slate-800', c.cls)}>{c.value}</p>
              </div>
            ))}
          </div>

          {data.counts.autoOnly > 0 && (
            <Alert type="warning" message={`${data.counts.autoOnly} skipped employee(s) are excluded by the manual run but the auto run (27th) still pays them today.`} />
          )}

          <Card
            title={`Employees picked (${shown.length}/${picks.length})`}
            action={
              <div className="flex gap-1 text-xs">
                {(['issues', 'skipped', 'all'] as const).map(f => (
                  <button key={f} onClick={() => setFilter(f)}
                    className={clsx('px-2.5 py-1 rounded-lg', filter === f ? 'bg-brand-600 text-white' : 'text-slate-600 hover:bg-slate-100')}>
                    {f === 'issues' ? 'Needs attention' : f === 'skipped' ? 'Skipped' : 'All'}
                  </button>
                ))}
              </div>
            }
          >
            <Table>
              <thead>
                <tr><Th>Employee</Th><Th>Status</Th><Th>Manual</Th><Th>Auto</Th><Th>Est. gross</Th><Th>Issues</Th></tr>
              </thead>
              <tbody>
                {shown.length === 0 && (
                  <tr><td colSpan={6} className="px-4 py-6 text-sm text-slate-400 text-center">Nothing here</td></tr>
                )}
                {shown.map(p => (
                  <Tr key={p.id} onClick={() => navigate(`/hr/employees/${p.id}`)} className="cursor-pointer">
                    <Td>
                      <p className="text-sm font-medium text-slate-800">{p.name}</p>
                      <p className="text-xs text-slate-400">{p.employeeCode}{p.isTrainee ? ' · Trainee' : ''}</p>
                    </Td>
                    <Td><span className="text-xs text-slate-600">{p.status}</span></Td>
                    <Td>{p.inManual ? <span className="text-xs text-emerald-600">Yes</span> : <span className="text-xs text-slate-400">No</span>}</Td>
                    <Td>{p.inAuto ? <span className="text-xs text-emerald-600">Yes</span> : <span className="text-xs text-slate-400">No</span>}</Td>
                    <Td>{p.estGross != null ? <Rupee amount={p.estGross} className="text-xs" /> : <span className="text-xs text-slate-400">—</span>}</Td>
                    <Td>
                      <div className="flex flex-wrap gap-1">
                        {p.issues.length === 0 && <span className="text-xs text-slate-400">OK</span>}
                        {p.issues.map((i: any, k: number) => {
                          const S = SEV[i.severity as Severity]
                          const Icon = S.icon
                          return (
                            <span key={k} className={clsx('inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded border', S.cls)}>
                              <Icon size={11} />{i.message}
                            </span>
                          )
                        })}
                      </div>
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </Card>

          <Card title={`Excluded (${data.excluded.length})`}>
            <Table>
              <thead><tr><Th>Employee</Th><Th>Status</Th><Th>Reason</Th></tr></thead>
              <tbody>
                {data.excluded.length === 0 && (
                  <tr><td colSpan={3} className="px-4 py-6 text-sm text-slate-400 text-center">None</td></tr>
                )}
                {data.excluded.map((x: any) => (
                  <Tr key={x.id} onClick={() => navigate(`/hr/employees/${x.id}`)} className="cursor-pointer">
                    <Td>
                      <p className="text-sm font-medium text-slate-800">{x.name}</p>
                      <p className="text-xs text-slate-400">{x.employeeCode}</p>
                    </Td>
                    <Td><span className="text-xs text-slate-600">{x.status}</span></Td>
                    <Td><span className="text-xs text-slate-600">{x.reason}</span></Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </Card>
        </>
      )}
    </div>
  )
}
