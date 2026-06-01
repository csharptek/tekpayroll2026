import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { FileText, Play, RefreshCw, Eye, Mail, Send } from 'lucide-react'
import { payrollApi, payslipApi } from '../../services/api'
import { PageHeader, Button, Card, Alert, Skeleton, Table, Th, Td, Tr, EmptyState, StatusBadge, Modal } from '../../components/ui'
import { format } from 'date-fns'

export default function PayslipGenerationPage() {
  const qc = useQueryClient()
  const [selectedCycle, setSelectedCycle] = useState('')
  const [generateConfirm, setGenerateConfirm] = useState(false)
  const [emailAllConfirm, setEmailAllConfirm] = useState(false)
  const [successMsg, setSuccessMsg] = useState('')
  const [emailingId, setEmailingId] = useState<string | null>(null)

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

  const showSuccess = (msg: string) => {
    setSuccessMsg(msg)
    setTimeout(() => setSuccessMsg(''), 4000)
  }

  const genMut = useMutation({
    mutationFn: () => payslipApi.generate(selectedCycle),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['payroll-cycle', selectedCycle] })
      setGenerateConfirm(false)
      showSuccess('Payslips generated successfully.')
    },
  })

  const emailAllMut = useMutation({
    mutationFn: () => payslipApi.emailAll(selectedCycle),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['payroll-cycle', selectedCycle] })
      setEmailAllConfirm(false)
      const d = res.data.data
      showSuccess(`Emailed ${d.success} employees. ${d.failed > 0 ? `${d.failed} failed.` : ''}`)
    },
  })

  const emailOneMut = useMutation({
    mutationFn: (payslipId: string) => {
      setEmailingId(payslipId)
      return payslipApi.emailOne(payslipId)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['payroll-cycle', selectedCycle] })
      setEmailingId(null)
      showSuccess('Payslip emailed successfully.')
    },
    onError: () => setEmailingId(null),
  })

  const regenMut = useMutation({
    mutationFn: (entryId: string) => payslipApi.generate(selectedCycle),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['payroll-cycle', selectedCycle] })
      showSuccess('Payslip regenerated.')
    },
  })

  const entries = cycle?.entries || []
  const payslipStatusMap: Record<string, any> = {}
  entries.forEach((e: any) => { if (e.payslip) payslipStatusMap[e.id] = e.payslip })

  const generated = Object.values(payslipStatusMap).filter((p: any) => ['GENERATED', 'EMAILED'].includes(p.status)).length
  const emailed   = Object.values(payslipStatusMap).filter((p: any) => p.status === 'EMAILED').length
  const pending   = entries.length - generated

  const hasGenerated = generated > 0

  return (
    <div className="space-y-5">
      <PageHeader title="Payslip Generation" subtitle="Generate and send payslips to employees" />

      {/* Cycle selector */}
      <Card>
        <div className="p-5">
          <div className="flex items-end gap-4 flex-wrap">
            <div className="flex-1 flex flex-col gap-1 min-w-[200px]">
              <label className="label">Select Payroll Cycle</label>
              <select className="input" value={selectedCycle} onChange={e => setSelectedCycle(e.target.value)}>
                <option value="">Choose a cycle…</option>
                {disbursedCycles.map((c: any) => (
                  <option key={c.id} value={c.id}>{c.payrollMonth} — {c.status}</option>
                ))}
              </select>
            </div>
            <div className="flex gap-2">
              <Button
                icon={<Play size={14} />}
                disabled={!selectedCycle}
                onClick={() => setGenerateConfirm(true)}
              >
                Generate Payslips
              </Button>
              {hasGenerated && (
                <Button
                  variant="secondary"
                  icon={<Send size={14} />}
                  disabled={!selectedCycle}
                  onClick={() => setEmailAllConfirm(true)}
                >
                  Email All
                </Button>
              )}
            </div>
          </div>
        </div>
      </Card>

      {successMsg && <Alert type="success" message={successMsg} />}

      {/* Stats */}
      {selectedCycle && cycle && (
        <div className="grid grid-cols-4 gap-4">
          {[
            { label: 'Total Employees', value: entries.length },
            { label: 'Generated',       value: generated },
            { label: 'Emailed',         value: emailed },
            { label: 'Pending',         value: pending },
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
                  const haspdf = !!ps?.pdfUrl
                  const isEmailingThis = emailingId === ps?.id
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
                        <div className="flex items-center gap-1">
                          {haspdf && (
                            <a href={ps.pdfUrl} target="_blank" rel="noreferrer">
                              <Button variant="ghost" size="sm" icon={<Eye size={12} />}>Preview</Button>
                            </a>
                          )}
                          {haspdf && (
                            <Button
                              variant="ghost"
                              size="sm"
                              icon={<Mail size={12} />}
                              loading={isEmailingThis}
                              onClick={() => emailOneMut.mutate(ps.id)}
                            >
                              Email
                            </Button>
                          )}
                          {!haspdf && (
                            <Button
                              variant="ghost"
                              size="sm"
                              icon={<RefreshCw size={12} />}
                              onClick={() => regenMut.mutate(entry.id)}
                            >
                              Generate
                            </Button>
                          )}
                        </div>
                      </Td>
                    </Tr>
                  )
                })}
              </tbody>
            </Table>
          )}
        </Card>
      )}

      {/* Generate confirm modal */}
      <Modal open={generateConfirm} onClose={() => setGenerateConfirm(false)} title="Generate Payslips"
        footer={<><Button variant="secondary" onClick={() => setGenerateConfirm(false)}>Cancel</Button>
          <Button loading={genMut.isPending} onClick={() => genMut.mutate()} icon={<Play size={13} />}>Generate PDFs</Button></>}>
        <p className="text-sm text-slate-600">
          Generate PDF payslips for all <strong>{entries.length} employees</strong> in cycle <strong>{cycle?.payrollMonth}</strong>?
          PDFs will be saved. Emails will <strong>not</strong> be sent automatically — use Email buttons after generation.
        </p>
      </Modal>

      {/* Email all confirm modal */}
      <Modal open={emailAllConfirm} onClose={() => setEmailAllConfirm(false)} title="Email All Payslips"
        footer={<><Button variant="secondary" onClick={() => setEmailAllConfirm(false)}>Cancel</Button>
          <Button loading={emailAllMut.isPending} onClick={() => emailAllMut.mutate()} icon={<Send size={13} />}>Send Emails</Button></>}>
        <p className="text-sm text-slate-600">
          Send payslip emails to all <strong>{generated} employees</strong> with generated payslips in cycle <strong>{cycle?.payrollMonth}</strong>?
        </p>
      </Modal>
    </div>
  )
}
