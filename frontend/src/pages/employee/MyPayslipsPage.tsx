import { useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { Download, FileText, Lock, Eye, EyeOff } from 'lucide-react'
import { payslipApi, employeeApi } from '../../services/api'
import { useAuthStore } from '../../store/authStore'
import { PageHeader, Card, Table, Th, Td, Tr, EmptyState, Skeleton, StatusBadge, Rupee } from '../../components/ui'
import { format } from 'date-fns'

const SESSION_KEY = 'payslip_unlocked'

export default function MyPayslipsPage() {
  const { user } = useAuthStore()
  const [year, setYear] = useState(new Date().getFullYear())
  const [unlocked, setUnlocked] = useState(() => sessionStorage.getItem(SESSION_KEY) === '1')
  const [pwInput, setPwInput] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [pwError, setPwError] = useState('')

  const { data: payslips, isLoading: loadingPayslips } = useQuery({
    queryKey: ['my-payslips', user?.id],
    queryFn: () => payslipApi.forEmployee(user!.id).then(r => r.data.data),
    enabled: !!user?.id,
  })

  const { data: history } = useQuery({
    queryKey: ['my-payroll-history', user?.id],
    queryFn: () => employeeApi.payrollHistory(user!.id).then(r => r.data.data),
    enabled: !!user?.id,
  })

  const { data: pwStatus } = useQuery({
    queryKey: ['payslip-password-status'],
    queryFn: () => payslipApi.passwordStatus().then(r => r.data.data),
  })

  const { mutate: verify, isLoading: verifying } = useMutation({
    mutationFn: () => payslipApi.verifyPassword(pwInput),
    onSuccess: () => {
      sessionStorage.setItem(SESSION_KEY, '1')
      setUnlocked(true)
      setPwError('')
    },
    onError: (e: any) => {
      setPwError(e?.response?.data?.error || 'Incorrect password')
    },
  })

  const entryMap = new Map((history || []).map((e: any) => [e.id, e]))
  const filtered = (payslips || []).filter((ps: any) => {
    if (!ps.cycle?.payrollMonth) return true
    return ps.cycle.payrollMonth.startsWith(String(year))
  })
  const years = [...new Set((payslips || []).map((ps: any) => ps.cycle?.payrollMonth?.slice(0, 4)).filter(Boolean))]
    .sort((a: any, b: any) => b - a)

  const noPasswordSet = pwStatus && !pwStatus.hasPassword

  if (!unlocked && !noPasswordSet) {
    return (
      <div className="space-y-5">
        <PageHeader title="My Payslips" subtitle="Enter your payslip password to view figures" />
        <Card>
          <div className="p-8 flex flex-col items-center gap-5 max-w-sm mx-auto">
            <div className="w-14 h-14 bg-blue-50 rounded-2xl flex items-center justify-center">
              <Lock size={24} className="text-blue-600" />
            </div>
            <div className="text-center">
              <p className="font-semibold text-slate-800">Password Protected</p>
              <p className="text-sm text-slate-500 mt-1">Your payslip figures are protected. Enter your password to view.</p>
              {pwStatus?.resetAllowed && (
                <p className="text-xs text-amber-600 mt-2 bg-amber-50 px-3 py-1.5 rounded-lg border border-amber-200">
                  Admin has allowed you to set a new password. Go to <strong>My Settings</strong> to reset it.
                </p>
              )}
            </div>
            <div className="w-full space-y-3">
              <div className="relative">
                <input
                  type={showPw ? 'text' : 'password'}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 pr-10"
                  placeholder="Enter payslip password"
                  value={pwInput}
                  onChange={e => { setPwInput(e.target.value); setPwError('') }}
                  onKeyDown={e => e.key === 'Enter' && pwInput && verify()}
                />
                <button
                  type="button"
                  onClick={() => setShowPw(p => !p)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400"
                >
                  {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              {pwError && <p className="text-xs text-red-600">{pwError}</p>}
              <button
                onClick={() => verify()}
                disabled={!pwInput || verifying}
                className="w-full py-2.5 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-40"
              >
                {verifying ? 'Verifying…' : 'Unlock'}
              </button>
            </div>
            <p className="text-xs text-slate-400 text-center">Forgot your password? Contact your admin to reset it.</p>
          </div>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="My Payslips"
        subtitle="Download your payslips for any month"
        actions={
          unlocked ? (
            <button
              onClick={() => { sessionStorage.removeItem(SESSION_KEY); setUnlocked(false); setPwInput('') }}
              className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-700 border border-slate-200 px-3 py-1.5 rounded-lg"
            >
              <Lock size={12} /> Lock
            </button>
          ) : undefined
        }
      />

      {noPasswordSet && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-800">
          No payslip password set. Go to <strong>My Settings</strong> to set one and protect your salary figures.
        </div>
      )}

      <div className="flex gap-2">
        {years.map((y: any) => (
          <button key={y} onClick={() => setYear(Number(y))}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              year === Number(y) ? 'bg-brand-600 text-white' : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
            }`}>
            {y}
          </button>
        ))}
      </div>

      <Card>
        {loadingPayslips ? <Skeleton className="h-64 m-4" /> : !filtered.length ? (
          <EmptyState icon={<FileText size={22} />} title="No payslips found"
            description="Payslips appear here once generated by HR after each payroll cycle." />
        ) : (
          <Table>
            <thead>
              <tr className="border-b border-slate-100">
                <Th>Month</Th><Th className="text-right">Gross</Th><Th className="text-right">Deductions</Th>
                <Th className="text-right">Net Salary</Th><Th>Status</Th><Th>Download</Th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((ps: any) => {
                const entry = entryMap.get(ps.entryId) as any
                const deductions = entry
                  ? ['pfAmount','esiAmount','ptAmount','tdsAmount','lopAmount','loanDeduction'].reduce((s: number, k: string) => s + Number(entry[k] || 0), 0)
                  : 0
                return (
                  <Tr key={ps.id}>
                    <Td>
                      <p className="font-semibold text-slate-800">{ps.cycle?.payrollMonth}</p>
                      {ps.generatedAt && <p className="text-xs text-slate-400">Generated {format(new Date(ps.generatedAt), 'dd MMM yyyy')}</p>}
                    </Td>
                    <Td className="text-right">{entry ? <Rupee amount={entry.grossSalary} /> : '—'}</Td>
                    <Td className="text-right">{deductions > 0 ? <Rupee amount={deductions} className="text-red-500" /> : '—'}</Td>
                    <Td className="text-right font-bold">{entry ? <Rupee amount={entry.netSalary} /> : '—'}</Td>
                    <Td><StatusBadge status={ps.status} /></Td>
                    <Td>
                      {ps.pdfUrl
                        ? <a href={ps.pdfUrl} target="_blank" rel="noreferrer"
                            className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand-600 hover:text-brand-800 bg-brand-50 hover:bg-brand-100 px-3 py-1.5 rounded-lg transition-colors">
                            <Download size={12} /> Download PDF
                          </a>
                        : <span className="text-xs text-slate-300">Not ready</span>
                      }
                    </Td>
                  </Tr>
                )
              })}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  )
}
