import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { FileText, Play, RefreshCw, Download } from 'lucide-react'
import { payrollApi, payslipApi } from '../../services/api'
import { PageHeader, Button, Card, Alert, Skeleton, Table, Th, Td, Tr, EmptyState, StatusBadge, Modal } from '../../components/ui'
import { format } from 'date-fns'

export default function PayslipGenerationPage() {
  const qc = useQueryClient()
  const [selectedCycle, setSelectedCycle] = useState('')
  const [generateConfirm, setGenerateConfirm] = useState(false)
  const [success, setSuccess] = useState(false)

  const { data: cycles, isLoading: loadingCycles } = useQuery({
    queryKey: ['payroll-cycles'],
    queryFn: () => payrollApi.cycles().then(r => r.data.data),
  })

  const disbursedCycles = (cycles || []).filter((c: any) => ['LOCKED', 'DISBURSED', 'CALCULATED'].includes(c.status))

  const { data: cycle, isLoading: loadingCycle } = useQuery({
    queryKey: ['payroll-cycle', selectedCycle],
    queryFn: () => payrollApi.cycle(selectedCycle).then(r => r.data.data),
    enabled: !!selectedCycle,
  })

  const genMut = useMutation({
    mutationFn: () => payslipApi.generate(selectedCycle),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['payroll-cycle', selectedCycle] })
      setGenerateConfirm(false)
      setSuccess(true)
      setTimeout(() => setSuccess(false), 4000)
    },
  })

  const entries = cycle?.entries || []
  const payslipStatusMap: Record<string, any> = {}
  entries.forEach((e: any) => { if (e.payslip) payslipStatusMap[e.id] = e.payslip })

  const generated = Object.values(payslipStatusMap).filter((p: any) => p.status !== 'PENDING').length
  const emailed   = Object.values(payslipStatusMap).filter((p: any) => p.status === 'EMAILED').length

  return (
    <div className="space-y-5">
      <PageHeader title="Payslip Generation" subtitle="Generate and send payslips to employees" />

      {/* Cycle selector */}
      <Card>
        <div className="p-5">
          <div className="flex items-end gap-4">
            <div className="flex-1 flex flex-col gap-1">
              <label className="label">Select Payroll Cycle</label>
              <select className="input" value={selectedCycle} onChange={e => setSelectedCycle(e.target.value)}>
                <option value="">Choose a cycle…</option>
                {disbursedCycles.map((c: any) => (
                  <option key={c.id} value={c.id}>{c.payrollMonth} — {c.status}</option>
                ))}
              </select>
            </div>
            <Button
              icon={<Play size={14} />}
              disabled={!selectedCycle}
              onClick={() => setGenerateConfirm(true)}
            >
              Generate Payslips
            </Button>
          </div>
        </div>
      </Card>

      {success && <Alert type="success" message="Payslip generation triggered successfully. PDFs will be ready shortly and employees will be emailed." />}

      {/* Stats */}
      {selectedCycle && cycle && (
        <div className="grid grid-cols-4 gap-4">
          {[
            { label: 'Total Employees', value: entries.length },
            { label: 'Generated',       value: generated },
            { label: 'Emailed',         value: emailed },
            { label: 'Pending',         value: entries.length - generated },
          ].map(({ label, value }) => (
            <div key={label} className="card p-4">
              <p className="stat-label">{label}</p>
              <p className="text-2xl font-display font-bold text-slate-900 mt-1">{value}</p>
            </div>
          ))}
        </div>
      )}

      {/* Employee payslip status */}
      {selectedCycle && (
        <Card title="Employee Payslip Status">
          {loadingCycle ? <Skeleton className="h-64 m-4" /> : !entries.length ? (
            <EmptyState icon={<FileText size={20} />} title="No entries in this cycle" description="Run payroll first to generate entries." />
          ) : (
            <Table>
              <thead><tr className="border-b border-slate-100">
                <Th>Employee</Th><Th>Net Salary</Th><Th>Payslip Status</Th><Th>Generated At</Th><Th>Emailed At</Th><Th>Actions</Th>
              </tr></thead>
              <tbody>
                {entries.map((entry: any) => {
                  const ps = entry.payslip
                  return (
                    <Tr key={entry.id}>
                      <Td>
                        <p className="font-medium text-slate-800">{entry.employee?.name}</p>
                        <p className="text-xs text-slate-400">{entry.employee?.department}</p>
                      </Td>
                      <Td className="font-semibold rupee">₹{Number(entry.netSalary).toLocaleString('en-IN')}</Td>
                      <Td><StatusBadge status={ps?.status || 'PENDING'} /></Td>
                      <Td><span className="text-xs text-slate-500">{ps?.generatedAt ? format(new Date(ps.generatedAt), 'dd MMM, HH:mm') : '—'}</span></Td>
                      <Td><span className="text-xs text-slate-500">{ps?.emailedAt ? format(new Date(ps.emailedAt), 'dd MMM, HH:mm') : '—'}</span></Td>
                      <Td>
                        {ps?.pdfUrl
                          ? <a href={ps.pdfUrl} target="_blank" rel="noreferrer">
                              <Button variant="ghost" size="sm" icon={<Download size={12} />}>PDF</Button>
                            </a>
                          : <Button variant="ghost" size="sm" icon={<RefreshCw size={12} />} onClick={() => genMut.mutate()}>Regenerate</Button>
                        }
                      </Td>
                    </Tr>
                  )
                })}
              </tbody>
            </Table>
          )}
        </Card>
      )}

      <Modal open={generateConfirm} onClose={() => setGenerateConfirm(false)} title="Generate Payslips"
        footer={<><Button variant="secondary" onClick={() => setGenerateConfirm(false)}>Cancel</Button>
          <Button loading={genMut.isPending} onClick={() => genMut.mutate()} icon={<Play size={13} />}>Generate & Email</Button></>}>
        <p className="text-sm text-slate-600">
          Generate PDF payslips for all <strong>{entries.length} employees</strong> in cycle <strong>{cycle?.payrollMonth}</strong>?
          Payslips will be saved and emailed to each employee automatically.
        </p>
      </Modal>
    </div>
  )
}
