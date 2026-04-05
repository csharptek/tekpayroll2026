import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Edit2, User, Briefcase, DollarSign, Phone, GraduationCap, Building2, CreditCard, FileText, LogOut } from 'lucide-react'
import { employeeApi } from '../../services/api'
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

export default function EmployeeDetailPage() {
  const { id }      = useParams<{ id: string }>()
  const navigate    = useNavigate()
  const qc          = useQueryClient()
  const { user }    = useAuthStore()
  const [tab, setTab] = useState('personal')
  const isSuperAdmin = user?.role === 'SUPER_ADMIN'
  const isHR = user?.role === 'HR' || user?.role === 'SUPER_ADMIN'

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

  const showExit   = emp.status === 'ON_NOTICE' || emp.status === 'SEPARATED'
  // HR cannot see salary/CTC — only SUPER_ADMIN
  const visibleTabs = TABS.filter(t =>
    (t.key !== 'exit' || showExit) &&
    (t.key !== 'salary' || isSuperAdmin)
  )
  const refetch    = () => qc.invalidateQueries({ queryKey: ['employee-full', id] })

  return (
    <div className="space-y-5 max-w-5xl">
      <PageHeader
        title={emp.name}
        subtitle={`${emp.employeeCode} · ${emp.jobTitle || 'No title'} · ${emp.department || 'No dept'}`}
        actions={
          <div className="flex items-center gap-3">
            <StatusBadge status={emp.status} />
            {isHR && (
              <Button icon={<Edit2 size={14}/>} variant="secondary"
                onClick={() => navigate(`/hr/employees/${id}/edit`)}>
                Edit Basic Info
              </Button>
            )}
            <Button variant="ghost" icon={<ArrowLeft size={14}/>}
              onClick={() => navigate('/hr/employees')}>Back</Button>
          </div>
        }
      />

      {/* Quick profile card */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 flex items-center gap-5">
        <div className="w-20 h-20 rounded-2xl bg-brand-100 flex items-center justify-center flex-shrink-0 overflow-hidden">
          {emp.profile?.profilePhotoUrl
            ? <img src={emp.profile.profilePhotoUrl} alt={emp.name} className="w-full h-full object-cover"/>
            : <span className="text-3xl font-display font-bold text-brand-600">{emp.name?.charAt(0)?.toUpperCase()}</span>
          }
        </div>
        <div className="flex-1 grid grid-cols-2 sm:grid-cols-5 gap-4">
          <div>
            <p className="text-xs text-slate-400 mb-0.5">Employee ID</p>
            <p className="text-sm text-slate-800 font-mono font-semibold">{emp.employeeCode}</p>
          </div>
          <div><p className="text-xs text-slate-400 mb-0.5">Email</p><p className="text-sm text-slate-700 font-medium truncate">{emp.email}</p></div>
          <div>
            <p className="text-xs text-slate-400 mb-0.5">Joined</p>
            <p className="text-sm text-slate-700 font-medium">
              {emp.joiningDate ? new Date(emp.joiningDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}
            </p>
          </div>
          <div>
            <p className="text-xs text-slate-400 mb-0.5">Annual CTC</p>
            <p className="text-sm font-medium">
              {Number(emp.annualCtc) > 0
                ? <span className="text-slate-700">₹{Number(emp.annualCtc).toLocaleString('en-IN')}</span>
                : <span className="text-amber-500">Not set</span>}
            </p>
          </div>
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
                  <Icon size={14}/>{t.label}
                </button>
              )
            })}
          </div>
        </div>
        <div className="p-6">
          {tab === 'personal'   && <PersonalTab   emp={emp} isHR={isHR} onSaved={refetch}/>}
          {tab === 'employment' && <EmploymentTab  emp={emp} isHR={isHR} onSaved={refetch}/>}
          {tab === 'salary'     && <SalaryTab      emp={emp} isHR={isHR} onSaved={refetch}/>}
          {tab === 'contacts'   && <ContactsTab    emp={emp} isHR={isHR} onSaved={refetch}/>}
          {tab === 'education'  && <EducationTab   emp={emp} isHR={isHR} onSaved={refetch}/>}
          {tab === 'experience' && <ExperienceTab  emp={emp} isHR={isHR} onSaved={refetch}/>}
          {tab === 'bank'       && <BankTab        emp={emp} isHR={isHR} onSaved={refetch}/>}
          {tab === 'documents'  && <DocumentsTab   emp={emp} isHR={isHR} onSaved={refetch}/>}
          {tab === 'exit'       && <ExitTab        emp={emp} isHR={isHR} onSaved={refetch}/>}
        </div>
      </div>
    </div>
  )
}
