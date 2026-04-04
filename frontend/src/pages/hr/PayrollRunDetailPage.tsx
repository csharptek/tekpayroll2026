import { useParams, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, Download, FileText } from 'lucide-react'
import { format } from 'date-fns'
import { payrollApi } from '../../services/api'
import { PageHeader, Button, Card, StatusBadge, Rupee, Table, Th, Td, Tr, Skeleton } from '../../components/ui'

export default function PayrollRunDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  const { data: cycle, isLoading } = useQuery({
    queryKey: ['payroll-cycle', id],
    queryFn: () => payrollApi.cycle(id!).then(r => r.data.data),
    enabled: !!id,
  })

  if (isLoading) return <Skeleton className="h-96 rounded-xl" />
  if (!cycle) return null

  const entries = cycle.entries || []

  return (
    <div className="space-y-5">
      <PageHeader
        title={`Payroll Detail — ${cycle.payrollMonth}`}
        subtitle={`${format(new Date(cycle.cycleStart), 'dd MMM')} – ${format(new Date(cycle.cycleEnd), 'dd MMM yyyy')}`}
        actions={
          <div className="flex gap-2">
            <Button variant="ghost" icon={<ArrowLeft size={14} />} onClick={() => navigate('/hr/payroll')}>Back</Button>
            <Button variant="secondary" icon={<Download size={14} />}>Export Excel</Button>
          </div>
        }
      />

      {/* Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: 'Status',      value: <StatusBadge status={cycle.status} /> },
          { label: 'Employees',   value: cycle.employeeCount ?? entries.length },
          { label: 'Total Gross', value: <Rupee amount={cycle.totalGross || 0} /> },
          { label: 'Total Net',   value: <Rupee amount={cycle.totalNet || 0} className="font-bold text-emerald-700" /> },
        ].map(({ label, value }) => (
          <div key={label} className="card p-4">
            <p className="stat-label">{label}</p>
            <p className="text-lg font-display font-bold text-slate-800 mt-1">{value}</p>
          </div>
        ))}
      </div>

      {/* Entries table */}
      <Card title="Employee Payroll Register">
        <Table>
          <thead>
            <tr className="border-b border-slate-100">
              <Th>Employee</Th>
              <Th className="text-right">Gross</Th>
              <Th className="text-right">PF</Th>
              <Th className="text-right">ESI</Th>
              <Th className="text-right">PT</Th>
              <Th className="text-right">TDS</Th>
              <Th className="text-right">LOP</Th>
              <Th className="text-right">Net</Th>
              <Th>Payslip</Th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e: any) => (
              <Tr key={e.id}>
                <Td>
                  <div>
                    <p className="font-medium text-slate-800">{e.employee?.name}</p>
                    <p className="text-xs text-slate-400">{e.employee?.department}</p>
                  </div>
                </Td>
                <Td className="text-right"><Rupee amount={e.proratedGross} /></Td>
                <Td className="text-right"><Rupee amount={e.pfAmount} /></Td>
                <Td className="text-right">{Number(e.esiAmount) > 0 ? <Rupee amount={e.esiAmount} /> : '—'}</Td>
                <Td className="text-right">{Number(e.ptAmount) > 0 ? <Rupee amount={e.ptAmount} /> : '—'}</Td>
                <Td className="text-right">{Number(e.tdsAmount) > 0 ? <Rupee amount={e.tdsAmount} /> : '—'}</Td>
                <Td className="text-right">{Number(e.lopAmount) > 0 ? <Rupee amount={e.lopAmount} className="text-red-500" /> : '—'}</Td>
                <Td className="text-right font-bold"><Rupee amount={e.netSalary} /></Td>
                <Td>
                  {e.payslip?.pdfUrl
                    ? <a href={e.payslip.pdfUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-xs text-brand-600"><FileText size={12} />PDF</a>
                    : <StatusBadge status={e.payslip?.status || 'PENDING'} />
                  }
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </div>
  )
}
