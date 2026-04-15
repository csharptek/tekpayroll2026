import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useParams, useNavigate } from 'react-router-dom'
import {
  ArrowLeft, User, Briefcase, DollarSign, Phone, GraduationCap,
  Building2, CreditCard, FileText, LogOut, UserMinus, X, UserCheck, Eye, EyeOff,
} from 'lucide-react'
import { employeeApi, exitApi } from '../../services/api'
import { PageHeader, Button, Alert, Skeleton, StatusBadge } from '../../components/ui'
import { useAuthStore } from '../../store/authStore'
import PersonalTab    from '../../components/employee-profile/PersonalTab'
import EmploymentTab  from '../../components/employee-profile/EmploymentTab'
import SalaryTab      from '../../components/employee-profile/SalaryTab'
import ContactsTab    from '../../components/employee-profile/ContactsTab'
import EducationTab   from '../../components/employee-profile/EducationTab'
import ExperienceTab  from '../../components/employee-profile/ExperienceTab'
import BankTab        from '../../components/employee-profile/BankTab'
import DocumentsTab   from '../../components/employee-profile/DocumentsTab'
import ExitTab        from '../../components/employee-profile/ExitTab'
import { DatePicker } from '../../components/DatePicker'

const TABS = [
  { key: 'personal',   label: 'Personal',   icon: User },
  { key: 'employment', label: 'Employment', icon: Briefcase },
  { key: 'salary',     label: 'Salary',     icon: DollarSign },
  { key: 'contacts',   label: 'Contacts',   icon: Phone },
  { key: 'education',  label: 'Education',  icon: GraduationCap },
  { key: 'experience', label: 'Experience', icon: Building2 },
  { key: 'bank',       label: 'Bank',       icon: CreditCard },
  { key: 'documents',  label: 'Documents',  icon: FileText },
  { key: 'exit',       label: 'Exit',       icon: LogOut },
]

const EXIT_TYPES = ['RESIGNED', 'TERMINATED', 'ABSCONDED'] as const

function InitiateExitModal({ empId, empName, onClose, onDone }: {
  empId: string; empName: string; onClose: () => void; onDone: () => void
}) {
  const [exitType, setExitType] = useState<string>('RESIGNED')
  const [reason, setReason]     = useState('')
  const [resDate, setResDate]   = useState(new Date().toISOString().slice(0, 10))
  const [error, setError]       = useState('')

  const mut = useMutation({
    mutationFn: () => exitApi.initiate(empId, {
      exitType,
      reason,
      resignationDate: new Date(resDate).toISOString(),
    }),
    onSuccess: () => { onDone(); onClose() },
    onError:   (e: any) => setError(e?.response?.data?.error || 'Failed to initiate exit'),
  })

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
          <div className="flex items-center gap-2">
            <UserMinus size={16} className="text-red-500" />
            <h3 className="text-sm font-semibold text-slate-800">Initiate Exit — {empName}</h3>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={16} /></button>
        </div>

        <div className="p-5 space-y-4">
          {error && <Alert type="error" message={error} />}

          <div>
            <label className="label">Exit Type <span className="text-red-500">*</span></label>
            <select className="input" value={exitType} onChange={e => setExitType(e.target.value)}>
              {EXIT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>

          <div>
            <label className="label">Resignation / Exit Date <span className="text-red-500">*</span></label>
            <DatePicker value={resDate} onChange={v => setResDate(v)} />
          </div>

          <div>
            <label className="label">Reason / Internal Notes <span className="text-red-500">*</span></label>
            <textarea className="input resize-none" rows={3}
              placeholder="Internal reason for this exit..."
              value={reason} onChange={e => setReason(e.target.value)} />
          </div>

          <div className="bg-amber-50 border border-amber-100 rounded-xl p-3 text-xs text-amber-700">
            Employee status will change to <strong>ON NOTICE</strong>. Expected LWD will be calculated from notice period config. An email will be sent to the employee.
          </div>
        </div>

        <div className="flex justify-end gap-2 px-5 py-4 border-t border-slate-100">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            variant="danger"
            loading={mut.isPending}
            disabled={!reason.trim() || !resDate}
            onClick={() => { setError(''); mut.mutate() }}
          >
            Initiate Exit
          </Button>
        </div>
      </div>
    </div>
  )
}

function ConvertToEmployeeModal({ trainee, onClose, onDone }: {
  trainee: any; onClose: () => void; onDone: (newId: string) => void
}) {
  const [endDate, setEndDate] = useState(new Date().toISOString().slice(0, 10))
  const [error, setError]     = useState('')

  const mut = useMutation({
    mutationFn: () => employeeApi.convertToEmployee(trainee.id, endDate),
    onSuccess:  (r: any) => { onDone(r.data.data.newEmployeeId) },
    onError:    (e: any) => setError(e?.response?.data?.error || 'Conversion failed'),
  })

  const joiningDate = endDate
    ? new Date(new Date(endDate).getTime() + 86400000).toISOString().slice(0, 10)
    : ''

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
          <div className="flex items-center gap-2">
            <UserCheck size={16} className="text-emerald-500" />
            <h3 className="text-sm font-semibold text-slate-800">Convert to Employee — {trainee.name}</h3>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={16} /></button>
        </div>

        <div className="p-5 space-y-4">
          {error && <Alert type="error" message={error} />}

          <div>
            <label className="label">Trainee End Date <span className="text-red-500">*</span></label>
            <DatePicker value={endDate} onChange={v => setEndDate(v)} />
            <p className="text-xs text-slate-400 mt-1">Employee joining date will be set to {joiningDate || '—'}</p>
          </div>

          <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 text-xs text-blue-700 space-y-1">
            <p>• New employee record created with auto-generated C#TEK code</p>
            <p>• Profile data (name, email, department, job title) will be inherited</p>
            <p>• Leave balance calculated from joining date</p>
            <p>• Salary must be set separately after conversion</p>
            <p>• Trainee record will be deactivated</p>
          </div>
        </div>

        <div className="flex justify-end gap-2 px-5 py-4 border-t border-slate-100">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            loading={mut.isPending}
            disabled={!endDate}
            onClick={() => { setError(''); mut.mutate() }}
          >
            Convert to Employee
          </Button>
        </div>
      </div>
    </div>
  )
}

export default function EmployeeDetailPage() {
  const { id }      = useParams<{ id: string }>()
  const navigate    = useNavigate()
  const qc          = useQueryClient()
  const { user }    = useAuthStore()
  const [tab, setTab]           = useState('personal')
  const [showExitModal, setShowExitModal]       = useState(false)
  const [showConvertModal, setShowConvertModal] = useState(false)
  const [showCtc, setShowCtc]   = useState(false)

  const isSuperAdmin = user?.role === 'SUPER_ADMIN'
  const isHR         = user?.role === 'HR' || user?.role === 'SUPER_ADMIN'

  const { data: emp, isLoading, error } = useQuery({
    queryKey: ['employee-full', id],
    queryFn:  () => employeeApi.getFull(id!).then(r => r.data.data),
    enabled:  !!id,
  })

  if (isLoading) return (
    <div className="space-y-4">
      <Skeleton className="h-12 w-64" />
      <Skeleton className="h-64 rounded-2xl" />
    </div>
  )
  if (error || !emp) return <Alert type="error" message="Employee not found." />

  const showExit  = emp.status === 'ON_NOTICE' || emp.status === 'SEPARATED'
  const canInitiateExit  = isHR && emp.status === 'ACTIVE'
  const canConvert       = isHR && emp.isTrainee && emp.status === 'ACTIVE' && !emp.convertedToEmployeeId

  const visibleTabs = TABS.filter(t =>
    (t.key !== 'exit' || showExit) &&
    (t.key !== 'salary' || isSuperAdmin)
  )

  const refetch = () => qc.invalidateQueries({ queryKey: ['employee-full', id] })

  return (
    <div className="space-y-5 max-w-5xl">
      {showConvertModal && (
        <ConvertToEmployeeModal
          trainee={emp}
          onClose={() => setShowConvertModal(false)}
          onDone={(newId) => { setShowConvertModal(false); navigate(`/hr/employees/${newId}`) }}
        />
      )}
      {showExitModal && (
        <InitiateExitModal
          empId={emp.id}
          empName={emp.name}
          onClose={() => setShowExitModal(false)}
          onDone={() => { refetch(); setTab('exit') }}
        />
      )}

      <PageHeader
        title={emp.name}
        subtitle={
          <span className="flex items-center gap-2 flex-wrap">
            <span>{emp.employeeCode} · {emp.jobTitle || 'No title'} · {emp.department || 'No dept'}</span>
            {emp.isTrainee && emp.convertedToEmployeeId && (
              <span className="text-xs bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full">
                Converted → Employee
              </span>
            )}
            {!emp.isTrainee && emp.convertedFromTraineeId && (
              <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">
                Converted from Trainee
              </span>
            )}
          </span>
        }
        actions={
          <div className="flex items-center gap-3">
            <StatusBadge status={emp.status} />
            {canConvert && (
              <Button
                icon={<UserCheck size={14} />}
                variant="primary"
                onClick={() => setShowConvertModal(true)}
              >
                Convert to Employee
              </Button>
            )}
            {canInitiateExit && (
              <Button
                icon={<UserMinus size={14} />}
                variant="secondary"
                onClick={() => setShowExitModal(true)}
              >
                Initiate Exit
              </Button>
            )}
            <Button variant="ghost" icon={<ArrowLeft size={14} />}
              onClick={() => navigate('/hr/employees')}>Back</Button>
          </div>
        }
      />

      {/* Quick profile card */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 flex items-center gap-5">
        <div className="w-20 h-20 rounded-2xl bg-brand-100 flex items-center justify-center flex-shrink-0 overflow-hidden">
          {emp.profile?.profilePhotoUrl
            ? <img src={emp.profile.profilePhotoUrl} alt={emp.name} className="w-full h-full object-cover" />
            : <span className="text-3xl font-display font-bold text-brand-600">{emp.name?.charAt(0)?.toUpperCase()}</span>
          }
        </div>
        <div className="flex-1 grid grid-cols-2 sm:grid-cols-5 gap-4">
          <div>
            <p className="text-xs text-slate-400 mb-0.5">Employee ID</p>
            <p className="text-sm text-slate-800 font-mono font-semibold">{emp.employeeCode}</p>
          </div>
          <div>
            <p className="text-xs text-slate-400 mb-0.5">Email</p>
            <p className="text-sm text-slate-700 font-medium truncate">{emp.email}</p>
          </div>
          <div>
            <p className="text-xs text-slate-400 mb-0.5">Joined</p>
            <p className="text-sm text-slate-700 font-medium">
              {emp.joiningDate ? new Date(emp.joiningDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}
            </p>
          </div>
          {isSuperAdmin && (
            <div>
              <p className="text-xs text-slate-400 mb-0.5">Annual CTC</p>
              <div className="flex items-center gap-1.5">
                <p className="text-sm font-medium">
                  {Number(emp.annualCtc) > 0
                    ? showCtc
                      ? <span className="text-slate-700">₹{Number(emp.annualCtc).toLocaleString('en-IN')}</span>
                      : <span className="text-slate-400">₹ ••••••</span>
                    : <span className="text-amber-500">Not set</span>}
                </p>
                {Number(emp.annualCtc) > 0 && (
                  <button onClick={() => setShowCtc(v => !v)} className="text-slate-400 hover:text-slate-700 transition-colors">
                    {showCtc ? <EyeOff size={13} /> : <Eye size={13} />}
                  </button>
                )}
              </div>
            </div>
          )}
          <div>
            <p className="text-xs text-slate-400 mb-0.5">Employment</p>
            <p className="text-sm text-slate-700 font-medium">
              {emp.employmentDetail?.employmentType?.replace('_', ' ') || 'Full Time'}
            </p>
          </div>
        </div>
      </div>

      {/* Tabbed sections */}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        <div className="border-b border-slate-200 overflow-x-auto">
          <div className="flex min-w-max">
            {visibleTabs.map(t => {
              const Icon = t.icon
              const active = tab === t.key
              return (
                <button key={t.key} onClick={() => setTab(t.key)}
                  className={`flex items-center gap-2 px-4 py-3.5 text-sm font-medium border-b-2 transition-all whitespace-nowrap ${
                    active
                      ? 'border-brand-600 text-brand-700 bg-brand-50/50'
                      : 'border-transparent text-slate-500 hover:text-slate-700 hover:bg-slate-50'
                  }`}>
                  <Icon size={14} />{t.label}
                </button>
              )
            })}
          </div>
        </div>
        <div className="p-6">
          {tab === 'personal'   && <PersonalTab   emp={emp} isHR={isHR} onSaved={refetch} />}
          {tab === 'employment' && <EmploymentTab  emp={emp} isHR={isHR} onSaved={refetch} />}
          {tab === 'salary'     && <SalaryTab      emp={emp} isHR={isHR} onSaved={refetch} />}
          {tab === 'contacts'   && <ContactsTab    emp={emp} isHR={isHR} onSaved={refetch} />}
          {tab === 'education'  && <EducationTab   emp={emp} isHR={isHR} onSaved={refetch} />}
          {tab === 'experience' && <ExperienceTab  emp={emp} isHR={isHR} onSaved={refetch} />}
          {tab === 'bank'       && <BankTab        emp={emp} isHR={isHR} onSaved={refetch} />}
          {tab === 'documents'  && <DocumentsTab   emp={emp} isHR={isHR} onSaved={refetch} />}
          {tab === 'exit'       && (
            <ExitTab
              emp={emp}
              isHR={isHR}
              isSuperAdmin={isSuperAdmin}
              onSaved={refetch}
            />
          )}
        </div>
      </div>
    </div>
  )
}
