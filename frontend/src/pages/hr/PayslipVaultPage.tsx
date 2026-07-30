import { useState, useMemo } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { Archive, Download, Eye, FileSpreadsheet, Search } from 'lucide-react'
import { payslipVaultApi } from '../../services/api'
import { PageHeader, Card, Button, Input, Select, Table, Th, Td, Tr, EmptyState, Skeleton, Alert, StatusBadge, Modal } from '../../components/ui'

interface EmployeeRow {
  id: string
  employeeCode: string
  name: string
  department: string | null
  status: string
}

interface EmployeePayslip {
  id: string
  pdfKey: string | null
  generatedAt: string | null
  cycle: { payrollMonth: string; cycleStart: string }
  entry: { netSalary: string; grossSalary: string } | null
}

interface SalaryMonthRow {
  payrollMonth: string
  grossSalary: number
  netSalary: number
  pfAmount: number
  esiAmount: number
  ptAmount: number
  tdsAmount: number
  lopAmount: number
  loanDeduction: number
  status: string
}

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export default function PayslipVaultPage() {
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('ALL')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [months, setMonths] = useState<string[]>([])
  const [error, setError] = useState('')
  const [successMsg, setSuccessMsg] = useState('')

  // drill-down drawer
  const [drawerEmployee, setDrawerEmployee] = useState<EmployeeRow | null>(null)
  const [drawerTab, setDrawerTab] = useState<'payslips' | 'salary'> ('payslips')
  const [drawerSelectedPayslips, setDrawerSelectedPayslips] = useState<Set<string>>(new Set())
  const [drawerFrom, setDrawerFrom] = useState('')
  const [drawerTo, setDrawerTo] = useState('')

  const { data: employees, isLoading } = useQuery({
    queryKey: ['payslip-vault-employees'],
    queryFn: () => payslipVaultApi.employees().then((r) => r.data.data as EmployeeRow[]),
  })

  const { data: monthOptions } = useQuery({
    queryKey: ['payslip-vault-months'],
    queryFn: () => payslipVaultApi.months().then((r) => r.data.data as { payrollMonth: string }[]),
  })

  const { data: drawerPayslips, isLoading: drawerPayslipsLoading } = useQuery({
    queryKey: ['payslip-vault-employee-payslips', drawerEmployee?.id],
    queryFn: () => payslipVaultApi.employeePayslips(drawerEmployee!.id).then((r) => r.data.data as EmployeePayslip[]),
    enabled: !!drawerEmployee && drawerTab === 'payslips',
  })

  const { data: drawerSalary, isLoading: drawerSalaryLoading } = useQuery({
    queryKey: ['payslip-vault-salary-view', drawerEmployee?.id, drawerFrom, drawerTo],
    queryFn: () =>
      payslipVaultApi
        .salaryView(drawerEmployee!.id, drawerFrom || undefined, drawerTo || undefined)
        .then((r) => r.data.data as { monthly: SalaryMonthRow[]; cumulative: SalaryMonthRow; monthCount: number }),
    enabled: !!drawerEmployee && drawerTab === 'salary',
  })

  const openDrawer = (emp: EmployeeRow) => {
    setDrawerEmployee(emp)
    setDrawerTab('payslips')
    setDrawerSelectedPayslips(new Set())
    setDrawerFrom('')
    setDrawerTo('')
  }

  const toggleDrawerPayslip = (payrollMonth: string) => {
    setDrawerSelectedPayslips((prev) => {
      const next = new Set(prev)
      next.has(payrollMonth) ? next.delete(payrollMonth) : next.add(payrollMonth)
      return next
    })
  }

  const drawerDownloadMut = useMutation({
    mutationFn: async () => {
      const res = await payslipVaultApi.downloadSingle(drawerEmployee!.id, [...drawerSelectedPayslips])
      return res.data
    },
    onSuccess: (blob) => {
      saveBlob(blob, `${drawerEmployee?.employeeCode || 'employee'}_payslips.pdf`)
      showSuccess('Payslip PDF downloaded.')
    },
    onError: () => setError('Download failed for selected payslips.'),
  })

  const filtered = useMemo(() => {
    if (!employees) return []
    return employees.filter((e) => {
      const matchesSearch =
        !search ||
        e.name.toLowerCase().includes(search.toLowerCase()) ||
        e.employeeCode.toLowerCase().includes(search.toLowerCase())
      const matchesStatus = statusFilter === 'ALL' || e.status === statusFilter
      return matchesSearch && matchesStatus
    })
  }, [employees, search, statusFilter])

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const toggleAll = () => {
    if (selected.size === filtered.length) setSelected(new Set())
    else setSelected(new Set(filtered.map((e) => e.id)))
  }

  const toggleMonth = (m: string) => {
    setMonths((prev) => (prev.includes(m) ? prev.filter((x) => x !== m) : [...prev, m]))
  }

  const showSuccess = (msg: string) => {
    setSuccessMsg(msg)
    setTimeout(() => setSuccessMsg(''), 4000)
  }

  const singleDownloadMut = useMutation({
    mutationFn: async () => {
      const empId = [...selected][0]
      const res = await payslipVaultApi.downloadSingle(empId, months)
      return res.data
    },
    onSuccess: (blob) => {
      const emp = employees?.find((e) => e.id === [...selected][0])
      saveBlob(blob, `${emp?.employeeCode || 'employee'}_payslips.pdf`)
      showSuccess('Payslip PDF downloaded.')
    },
    onError: () => setError('Download failed. Check payslips exist for selected months.'),
  })

  const bulkDownloadMut = useMutation({
    mutationFn: async () => {
      const res = await payslipVaultApi.downloadBulk({
        employeeIds: [...selected],
        months: months.length ? months : undefined,
        from: from || undefined,
        to: to || undefined,
      })
      return res.data
    },
    onSuccess: (blob) => {
      saveBlob(blob, 'payslips_bulk.zip')
      showSuccess('Bulk payslips zip downloaded.')
    },
    onError: () => setError('Bulk download failed. Check payslips exist for selection.'),
  })

  const excelMut = useMutation({
    mutationFn: async () => {
      const res = await payslipVaultApi.exportExcel({
        employeeIds: [...selected],
        from: from || undefined,
        to: to || undefined,
      })
      return res.data
    },
    onSuccess: (blob) => {
      saveBlob(blob, 'salary_breakup.xlsx')
      showSuccess('Salary breakup Excel downloaded.')
    },
    onError: () => setError('Excel export failed. Check date range has payroll data.'),
  })

  const canSingleDownload = selected.size === 1 && months.length > 0
  const canBulkDownload = selected.size > 0 && (months.length > 0 || (from && to))
  const canExportExcel = selected.size > 0 && from && to

  return (
    <div className="space-y-6">
      <PageHeader
        title="Payslip Vault"
        subtitle="View and download salary slips — single or bulk, PDF or Excel"
      />

      {error && <Alert type="error" message={error} />}
      {successMsg && <Alert type="success" message={successMsg} />}

      <Card title="Filters">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Input
            placeholder="Search name or code"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <Select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            options={[
              { value: 'ALL', label: 'All Status' },
              { value: 'ACTIVE', label: 'Active' },
              { value: 'INACTIVE', label: 'Inactive' },
            ]}
          />
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} placeholder="From" />
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} placeholder="To" />
        </div>

        {monthOptions && monthOptions.length > 0 && (
          <div className="mt-4">
            <div className="text-sm font-medium text-gray-600 mb-2">
              Or pick specific months (for PDF download)
            </div>
            <div className="flex flex-wrap gap-2 max-h-32 overflow-y-auto">
              {monthOptions.map((m) => (
                <button
                  key={m.payrollMonth}
                  onClick={() => toggleMonth(m.payrollMonth)}
                  className={`px-3 py-1 rounded-full text-xs border ${
                    months.includes(m.payrollMonth)
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'bg-white text-gray-600 border-gray-300'
                  }`}
                >
                  {m.payrollMonth}
                </button>
              ))}
            </div>
          </div>
        )}
      </Card>

      <Card
        title={`Employees (${selected.size} selected)`}
        action={
          <div className="flex gap-2">
            <Button
              variant="secondary"
              disabled={!canSingleDownload || singleDownloadMut.isPending}
              onClick={() => singleDownloadMut.mutate()}
            >
              <Download size={16} className="mr-1" /> Single PDF
            </Button>
            <Button
              variant="secondary"
              disabled={!canBulkDownload || bulkDownloadMut.isPending}
              onClick={() => bulkDownloadMut.mutate()}
            >
              <Archive size={16} className="mr-1" /> Bulk Zip
            </Button>
            <Button
              disabled={!canExportExcel || excelMut.isPending}
              onClick={() => excelMut.mutate()}
            >
              <FileSpreadsheet size={16} className="mr-1" /> Export Excel
            </Button>
          </div>
        }
      >
        {isLoading ? (
          <Skeleton className="h-64" />
        ) : filtered.length === 0 ? (
          <EmptyState icon={<Search size={24} />} title="No employees found" description="Adjust search or filters." />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>
                  <input
                    type="checkbox"
                    checked={selected.size === filtered.length && filtered.length > 0}
                    onChange={toggleAll}
                  />
                </Th>
                <Th>Code</Th>
                <Th>Name</Th>
                <Th>Department</Th>
                <Th>Status</Th>
                <Th>Action</Th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((e) => (
                <Tr key={e.id} onClick={() => toggle(e.id)}>
                  <Td>
                    <input type="checkbox" checked={selected.has(e.id)} onChange={() => toggle(e.id)} />
                  </Td>
                  <Td>{e.employeeCode}</Td>
                  <Td>{e.name}</Td>
                  <Td>{e.department || '—'}</Td>
                  <Td><StatusBadge status={e.status} /></Td>
                  <Td>
                    <Button
                      variant="secondary"
                      onClick={(ev) => { ev.stopPropagation(); openDrawer(e) }}
                    >
                      <Eye size={14} className="mr-1" /> View
                    </Button>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <Card title="Notes">
        <ul className="text-sm text-gray-600 list-disc pl-5 space-y-1">
          <li>Single PDF: select exactly 1 employee + one or more months.</li>
          <li>Bulk Zip: select multiple employees + months, or a from/to date range.</li>
          <li>Export Excel: select employees + from/to date range for full salary breakup.</li>
          <li>Click "View" on any employee to browse their payslips or salary history.</li>
        </ul>
      </Card>

      <Modal
        open={!!drawerEmployee}
        onClose={() => setDrawerEmployee(null)}
        title={drawerEmployee ? `${drawerEmployee.name} (${drawerEmployee.employeeCode})` : ''}
        size="lg"
      >
        {drawerEmployee && (
          <div className="space-y-4">
            <div className="flex gap-2 border-b border-gray-200">
              <button
                className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px ${
                  drawerTab === 'payslips' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500'
                }`}
                onClick={() => setDrawerTab('payslips')}
              >
                Payslips
              </button>
              <button
                className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px ${
                  drawerTab === 'salary' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500'
                }`}
                onClick={() => setDrawerTab('salary')}
              >
                Salary View
              </button>
            </div>

            {drawerTab === 'payslips' && (
              <div className="space-y-3">
                {drawerPayslipsLoading ? (
                  <Skeleton className="h-40" />
                ) : !drawerPayslips || drawerPayslips.length === 0 ? (
                  <EmptyState title="No payslips found" description="No generated payslips for this employee yet." />
                ) : (
                  <>
                    <Table>
                      <thead>
                        <tr>
                          <Th></Th>
                          <Th>Month</Th>
                          <Th>Gross</Th>
                          <Th>Net</Th>
                        </tr>
                      </thead>
                      <tbody>
                        {drawerPayslips.map((p) => (
                          <Tr key={p.id} onClick={() => toggleDrawerPayslip(p.cycle.payrollMonth)}>
                            <Td>
                              <input
                                type="checkbox"
                                checked={drawerSelectedPayslips.has(p.cycle.payrollMonth)}
                                onChange={() => toggleDrawerPayslip(p.cycle.payrollMonth)}
                              />
                            </Td>
                            <Td>{p.cycle.payrollMonth}</Td>
                            <Td>{p.entry ? Number(p.entry.grossSalary).toLocaleString('en-IN') : '—'}</Td>
                            <Td>{p.entry ? Number(p.entry.netSalary).toLocaleString('en-IN') : '—'}</Td>
                          </Tr>
                        ))}
                      </tbody>
                    </Table>
                    <Button
                      disabled={drawerSelectedPayslips.size === 0 || drawerDownloadMut.isPending}
                      onClick={() => drawerDownloadMut.mutate()}
                    >
                      <Download size={16} className="mr-1" />
                      Download Selected ({drawerSelectedPayslips.size})
                    </Button>
                  </>
                )}
              </div>
            )}

            {drawerTab === 'salary' && (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <Input type="date" value={drawerFrom} onChange={(e) => setDrawerFrom(e.target.value)} placeholder="From" />
                  <Input type="date" value={drawerTo} onChange={(e) => setDrawerTo(e.target.value)} placeholder="To" />
                </div>
                {drawerSalaryLoading ? (
                  <Skeleton className="h-40" />
                ) : !drawerSalary || drawerSalary.monthly.length === 0 ? (
                  <EmptyState title="No salary data" description="No payroll entries found for this range." />
                ) : (
                  <>
                    <Table>
                      <thead>
                        <tr>
                          <Th>Month</Th>
                          <Th>Gross</Th>
                          <Th>PF</Th>
                          <Th>ESI</Th>
                          <Th>PT</Th>
                          <Th>TDS</Th>
                          <Th>LOP</Th>
                          <Th>Loan</Th>
                          <Th>Net</Th>
                        </tr>
                      </thead>
                      <tbody>
                        {drawerSalary.monthly.map((m) => (
                          <Tr key={m.payrollMonth}>
                            <Td>{m.payrollMonth}</Td>
                            <Td>{m.grossSalary.toLocaleString('en-IN')}</Td>
                            <Td>{m.pfAmount.toLocaleString('en-IN')}</Td>
                            <Td>{m.esiAmount.toLocaleString('en-IN')}</Td>
                            <Td>{m.ptAmount.toLocaleString('en-IN')}</Td>
                            <Td>{m.tdsAmount.toLocaleString('en-IN')}</Td>
                            <Td>{m.lopAmount.toLocaleString('en-IN')}</Td>
                            <Td>{m.loanDeduction.toLocaleString('en-IN')}</Td>
                            <Td className="font-medium">{m.netSalary.toLocaleString('en-IN')}</Td>
                          </Tr>
                        ))}
                      </tbody>
                    </Table>
                    <div className="bg-slate-50 rounded-lg p-3 text-sm">
                      <span className="font-medium">Cumulative ({drawerSalary.monthCount} months):</span>{' '}
                      Gross ₹{drawerSalary.cumulative.grossSalary.toLocaleString('en-IN')} · Net ₹
                      {drawerSalary.cumulative.netSalary.toLocaleString('en-IN')}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  )
}
