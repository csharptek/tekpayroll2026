import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft, Pencil, UserX, GitMerge, Phone, Mail,
  MapPin, Calendar, Building2, CreditCard, FileText,
  TrendingUp, Wallet, ChevronRight, Download, AlertCircle
} from 'lucide-react'
import { format } from 'date-fns'
import { employeeApi, payslipApi, loanApi } from '../../services/api'
import {
  PageHeader, Button, StatusBadge, Card, Rupee,
  Table, Th, Td, Tr, EmptyState, Skeleton, Modal, Alert
} from '../../components/ui'
import clsx from 'clsx'

type Tab = 'overview' | 'payroll' | 'loans' | 'revisions'

const TABS: { id: Tab; label: string; icon: any }[] = [
  { id: 'overview',  label: 'Overview',        icon: Building2 },
  { id: 'payroll',   label: 'Payroll History',  icon: CreditCard },
  { id: 'loans',     label: 'Loans',            icon: Wallet },
  { id: 'revisions', label: 'Salary Revisions', icon: TrendingUp },
]

function OverviewTab({ employee }: { employee: any }) {
  const monthly    = Number(employee.annualCtc) / 12
  const basic      = monthly * 0.40
  const hra        = basic * 0.80
  const allowances = monthly - basic - hra

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
      <div className="lg:col-span-2 space-y-5">
        <Card title="Employee Information">
          <div className="divide-y divide-slate-50">
            {[
              { label: 'Email',        value: employee.email,              icon: Mail },
              { label: 'Phone',        value: employee.mobilePhone || '—', icon: Phone },
              { label: 'Department',   value: employee.department || '—',  icon: Building2 },
              { label: 'Designation',  value: employee.jobTitle || '—',    icon: Building2 },
              { label: 'Location',     value: employee.officeLocation || '—', icon: MapPin },
              { label: 'State (PT)',   value: employee.state || '—',       icon: MapPin },
              { label: 'Joining Date', value: format(new Date(employee.joiningDate), 'dd MMM yyyy'), icon: Calendar },
              { label: 'Entra ID',     value: employee.entraId ? 'Synced from M365' : 'Manual entry', icon: CreditCard },
            ].map(({ label, value, icon: Icon }) => (
              <div key={label} className="flex items-center gap-3 px-5 py-3">
                <Icon size={14} className="text-slate-400 flex-shrink-0" />
                <span className="text-xs text-slate-500 w-28 flex-shrink-0">{label}</span>
                <span className="text-sm text-slate-800 font-medium">{value}</span>
              </div>
            ))}
          </div>
        </Card>

        <Card title="Compliance Details">
          <div className="divide-y divide-slate-50">
            {[
              { label: 'PAN',     value: employee.panNumber },
              { label: 'Aadhaar', value: employee.aadhaarNumber },
              { label: 'PF No.', value: employee.pfNumber },
              { label: 'ESI No.', value: employee.esiNumber },
              { label: 'UAN',     value: employee.uanNumber },
            ].map(({ label, value }) => (
              <div key={label} className="flex items-center gap-3 px-5 py-3">
                <span className="text-xs text-slate-500 w-28 flex-shrink-0">{label}</span>
                {value
                  ? <span className="text-sm font-mono text-slate-800">{value}</span>
                  : <span className="text-xs text-slate-300 italic">Not provided</span>
                }
              </div>
            ))}
          </div>
        </Card>
      </div>

      <div className="space-y-5">
        <Card>
          <div className="p-5">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-4">Salary Breakdown</p>
            <div className="space-y-3">
              <div className="flex justify-between">
                <span className="text-sm text-slate-500">Annual CTC</span>
                <Rupee amount={employee.annualCtc} className="text-sm font-bold text-slate-900" />
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-slate-500">Monthly CTC</span>
                <Rupee amount={monthly} className="text-sm font-semibold text-slate-700" />
              </div>
              <hr className="border-slate-100" />
              {[
                { label: 'Basic (40%)', value: basic },
                { label: 'HRA (80% of Basic)', value: hra },
                { label: 'Allowances', value: allowances },
              ].map(({ label, value }) => (
                <div key={label} className="flex justify-between">
                  <span className="text-xs text-slate-400">{label}</span>
                  <Rupee amount={value} className="text-xs text-slate-600" />
                </div>
              ))}
              <hr className="border-slate-100" />
              <div className="flex justify-between">
                <span className="text-sm text-slate-500">Annual Incentive</span>
                <Rupee amount={employee.annualIncentive} className="text-sm text-slate-700" />
              </div>
            </div>
          </div>
        </Card>

        {employee.bankDetail && (
          <Card>
            <div className="p-5">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">Bank Details</p>
              <div className="space-y-2.5">
                {[
                  { label: 'Bank', value: employee.bankDetail.bankName },
                  { label: 'Account', value: '••••••••' + employee.bankDetail.accountNumber.slice(-4) },
                  { label: 'IFSC', value: employee.bankDetail.ifscCode },
                ].map(({ label, value }) => (
                  <div key={label}>
                    <p className="text-xs text-slate-400">{label}</p>
                    <p className="text-sm font-mono text-slate-800">{value}</p>
                  </div>
                ))}
                {employee.bankDetail.pendingChange && (
                  <div className="flex items-center gap-1.5 text-xs text-amber-600 bg-amber-50 px-2 py-1.5 rounded-lg mt-1">
                    <AlertCircle size={12} /> Bank change pending approval
                  </div>
                )}
              </div>
            </div>
          </Card>
        )}

        {employee.resignationDate && (
          <div className="p-4 bg-red-50 rounded-xl border border-red-100">
            <p className="text-xs font-semibold text-red-700 mb-2">Resignation</p>
            <div className="space-y-1 text-xs">
              <div className="flex justify-between">
                <span className="text-red-400">Resigned on</span>
                <span className="text-red-800 font-medium">{format(new Date(employee.resignationDate), 'dd MMM yyyy')}</span>
              </div>
              {employee.lastWorkingDay && (
                <div className="flex justify-between">
                  <span className="text-red-400">Last working day</span>
                  <span className="text-red-800 font-medium">{format(new Date(employee.lastWorkingDay), 'dd MMM yyyy')}</span>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function PayrollHistoryTab({ employeeId }: { employeeId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['employee-payroll', employeeId],
    queryFn: () => employeeApi.payrollHistory(employeeId).then(r => r.data.data),
  })
  const { data: payslips } = useQuery({
    queryKey: ['employee-payslips', employeeId],
    queryFn: () => payslipApi.forEmployee(employeeId).then(r => r.data.data),
  })
  const payslipMap = new Map((payslips || []).map((p: any) => [p.entryId, p]))
  if (isLoading) return <Card><Skeleton className="h-64 m-4" /></Card>
  return (
    <Card>
      {!data?.length ? (
        <EmptyState icon={<CreditCard size={22} />} title="No payroll history yet" description="Not yet included in any payroll cycle." />
      ) : (
        <Table>
          <thead>
            <tr className="border-b border-slate-100">
              <Th>Month</Th><Th className="text-right">Gross</Th>
              <Th className="text-right">Deductions</Th><Th className="text-right">Net</Th>
              <Th>LOP</Th><Th>Status</Th><Th>Payslip</Th>
            </tr>
          </thead>
          <tbody>
            {data.map((e: any) => {
              const ded = ['pfAmount','esiAmount','ptAmount','tdsAmount','lopAmount','incentiveRecovery','loanDeduction'].reduce((s: number, k: string) => s + Number(e[k] || 0), 0)
              const ps = payslipMap.get(e.id) as any
              return (
                <Tr key={e.id}>
                  <Td className="font-semibold">{e.cycle?.payrollMonth}</Td>
                  <Td className="text-right"><Rupee amount={e.grossSalary} /></Td>
                  <Td className="text-right text-red-600"><Rupee amount={ded} /></Td>
                  <Td className="text-right font-bold"><Rupee amount={e.netSalary} /></Td>
                  <Td>{e.lopDays > 0 ? <span className="text-amber-600 font-medium">{e.lopDays}d</span> : '—'}</Td>
                  <Td><StatusBadge status={e.status} /></Td>
                  <Td>
                    {ps?.pdfUrl
                      ? <a href={ps.pdfUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-xs text-brand-600 font-medium"><Download size={12} />PDF</a>
                      : <StatusBadge status={ps?.status || 'PENDING'} />}
                  </Td>
                </Tr>
              )
            })}
          </tbody>
        </Table>
      )}
    </Card>
  )
}

function LoansTab({ employeeId }: { employeeId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['employee-loans', employeeId],
    queryFn: () => loanApi.forEmployee(employeeId).then(r => r.data.data),
  })
  if (isLoading) return <Card><Skeleton className="h-40 m-4" /></Card>
  return (
    <div className="space-y-4">
      {!data?.length
        ? <Card><EmptyState icon={<Wallet size={22} />} title="No loans" description="No active or past loans." /></Card>
        : data.map((loan: any) => (
          <Card key={loan.id}>
            <div className="p-5">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <p className="text-sm font-semibold">Loan #{loan.id.slice(-6).toUpperCase()}</p>
                  <p className="text-xs text-slate-400">{loan.purpose || 'Personal loan'}</p>
                </div>
                <StatusBadge status={loan.status} />
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
                {[
                  { label: 'Principal', value: <Rupee amount={loan.principalAmount} /> },
                  { label: 'Outstanding', value: <Rupee amount={loan.outstandingBalance} className="text-red-600 font-bold" /> },
                  { label: 'EMI / month', value: <Rupee amount={loan.emiAmount} /> },
                  { label: 'Tenure', value: `${loan.tenureMonths} months` },
                ].map(({ label, value }) => (
                  <div key={label}>
                    <p className="text-xs text-slate-400 mb-0.5">{label}</p>
                    <p className="text-sm font-semibold text-slate-800">{value}</p>
                  </div>
                ))}
              </div>
              <div>
                <div className="flex justify-between text-xs text-slate-400 mb-1">
                  <span>Repaid</span>
                  <span>{Math.round((Number(loan.totalRepaid) / Number(loan.principalAmount)) * 100)}%</span>
                </div>
                <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                  <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${Math.min(100, (Number(loan.totalRepaid) / Number(loan.principalAmount)) * 100)}%` }} />
                </div>
              </div>
            </div>
          </Card>
        ))
      }
    </div>
  )
}

function RevisionsTab({ employeeId }: { employeeId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['salary-revisions', employeeId],
    queryFn: () => employeeApi.salaryRevisions(employeeId).then(r => r.data.data),
  })
  if (isLoading) return <Card><Skeleton className="h-40 m-4" /></Card>
  return (
    <Card>
      {!data?.length
        ? <EmptyState icon={<TrendingUp size={22} />} title="No salary revisions yet" />
        : <div className="divide-y divide-slate-50">
          {data.map((rev: any) => {
            const diff = Number(rev.newCtc) - Number(rev.previousCtc)
            const pct  = ((diff / Number(rev.previousCtc)) * 100).toFixed(1)
            return (
              <div key={rev.id} className="px-5 py-4">
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <p className="text-sm font-semibold">CTC Revision — {format(new Date(rev.effectiveFrom), 'dd MMM yyyy')}</p>
                    <p className="text-xs text-slate-400">By {rev.revisedByName}</p>
                  </div>
                  <span className={clsx('badge', diff >= 0 ? 'badge-green' : 'badge-red')}>
                    {diff >= 0 ? '+' : ''}{pct}%
                  </span>
                </div>
                <div className="flex items-center gap-3 text-sm">
                  <Rupee amount={rev.previousCtc} className="text-slate-400 line-through" />
                  <ChevronRight size={14} className="text-slate-300" />
                  <Rupee amount={rev.newCtc} className="font-bold text-slate-800" />
                </div>
                {rev.reason && <p className="text-xs text-slate-400 mt-1 italic">"{rev.reason}"</p>}
              </div>
            )
          })}
        </div>
      }
    </Card>
  )
}

export default function EmployeeDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [activeTab, setActiveTab] = useState<Tab>('overview')
  const [deactivateOpen, setDeactivateOpen] = useState(false)

  const { data: employee, isLoading } = useQuery({
    queryKey: ['employee', id],
    queryFn: () => employeeApi.get(id!).then(r => r.data.data),
    enabled: !!id,
  })

  const deactivateMut = useMutation({
    mutationFn: () => employeeApi.deactivate(id!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['employee', id] })
      queryClient.invalidateQueries({ queryKey: ['employees'] })
      setDeactivateOpen(false)
    },
  })

  if (isLoading) return <div className="space-y-4"><Skeleton className="h-32 rounded-xl" /><Skeleton className="h-64 rounded-xl" /></div>
  if (!employee) return <Alert type="error" message="Employee not found." />

  return (
    <div className="space-y-5">
      <PageHeader title="" actions={
        <div className="flex flex-wrap gap-2">
          <Button variant="ghost" icon={<ArrowLeft size={14} />} onClick={() => navigate('/hr/employees')}>Back</Button>
          <Button variant="secondary" icon={<Pencil size={14} />} onClick={() => navigate(`/hr/employees/${id}/edit`)}>Edit</Button>
          {employee.status === 'ACTIVE' && (
            <Button variant="danger" icon={<UserX size={14} />} onClick={() => setDeactivateOpen(true)}>Deactivate</Button>
          )}
        </div>
      } />

      {/* Profile hero */}
      <Card>
        <div className="p-5 flex items-start gap-5">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center flex-shrink-0 shadow-card-md">
            <span className="text-2xl font-display font-bold text-white">{employee.name.charAt(0)}</span>
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-xl font-display font-bold text-slate-900">{employee.name}</h1>
              <StatusBadge status={employee.status} />
              {employee.entraId && <span className="badge badge-blue gap-1"><span className="w-1.5 h-1.5 rounded-full bg-blue-400" />M365</span>}
            </div>
            <p className="text-sm text-slate-500 mt-0.5">{employee.jobTitle || '—'}{employee.department ? ` · ${employee.department}` : ''}</p>
            <div className="flex items-center gap-4 mt-2 flex-wrap text-xs text-slate-400">
              <span className="font-mono bg-slate-100 px-2 py-0.5 rounded">{employee.employeeCode}</span>
              <span className="flex items-center gap-1"><Calendar size={11} />Joined {format(new Date(employee.joiningDate), 'dd MMM yyyy')}</span>
              <span className="flex items-center gap-1"><Mail size={11} />{employee.email}</span>
            </div>
          </div>
          <div className="text-right hidden sm:block">
            <p className="text-xs text-slate-400">Annual CTC</p>
            <Rupee amount={employee.annualCtc} className="text-xl font-display font-bold text-slate-900" />
            <p className="text-xs text-slate-400 mt-0.5"><Rupee amount={Number(employee.annualCtc) / 12} /> / month</p>
          </div>
        </div>
      </Card>

      {/* Tab bar */}
      <div className="flex gap-1 bg-slate-100 p-1 rounded-xl w-fit">
        {TABS.map(({ id: tabId, label, icon: Icon }) => (
          <button key={tabId} onClick={() => setActiveTab(tabId)}
            className={clsx('flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-all duration-150',
              activeTab === tabId ? 'bg-white text-brand-700 shadow-card' : 'text-slate-500 hover:text-slate-700')}>
            <Icon size={13} />{label}
          </button>
        ))}
      </div>

      <div className="animate-fade-in">
        {activeTab === 'overview'  && <OverviewTab employee={employee} />}
        {activeTab === 'payroll'   && <PayrollHistoryTab employeeId={id!} />}
        {activeTab === 'loans'     && <LoansTab employeeId={id!} />}
        {activeTab === 'revisions' && <RevisionsTab employeeId={id!} />}
      </div>

      <Modal open={deactivateOpen} onClose={() => setDeactivateOpen(false)} title="Deactivate Employee"
        footer={<><Button variant="secondary" onClick={() => setDeactivateOpen(false)}>Cancel</Button><Button variant="danger" loading={deactivateMut.isPending} onClick={() => deactivateMut.mutate()}>Deactivate</Button></>}>
        <p className="text-sm text-slate-600">Deactivate <span className="font-semibold text-slate-900">{employee.name}</span>? They will be excluded from future payroll runs.</p>
      </Modal>
    </div>
  )
}
