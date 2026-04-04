import { useState, useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Save, User, Briefcase, DollarSign, CreditCard, AlertTriangle } from 'lucide-react'
import { employeeApi } from '../../services/api'
import { PageHeader, Button, Card, Alert, Skeleton, Rupee } from '../../components/ui'
import SalaryBreakdownForm from '../../components/SalaryBreakdownForm'

const STATES = [
  'Andhra Pradesh','Assam','Bihar','Chandigarh','Chhattisgarh','Delhi',
  'Goa','Gujarat','Haryana','Himachal Pradesh','Jharkhand','Karnataka',
  'Kerala','Madhya Pradesh','Maharashtra','Manipur','Meghalaya','Mizoram',
  'Nagaland','Odisha','Punjab','Rajasthan','Sikkim','Tamil Nadu','Telangana',
  'Tripura','Uttar Pradesh','Uttarakhand','West Bengal',
]

function SectionHeading({ icon: Icon, title }: { icon: any; title: string }) {
  return (
    <div className="flex items-center gap-2 mb-4">
      <div className="w-7 h-7 rounded-lg bg-brand-50 flex items-center justify-center">
        <Icon size={14} className="text-brand-600" />
      </div>
      <h3 className="text-sm font-semibold text-slate-700">{title}</h3>
    </div>
  )
}

export default function EditEmployeePage() {
  const { id }  = useParams<{ id: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const { data: employee, isLoading } = useQuery({
    queryKey: ['employee', id],
    queryFn: () => employeeApi.get(id!).then(r => r.data.data),
    enabled: !!id,
  })

  // ── Personal / Employment fields ───────────────────────────────────────────
  const [form, setForm] = useState({
    name: '', email: '', mobilePhone: '', jobTitle: '', department: '',
    state: '', officeLocation: '', joiningDate: '',
    resignationDate: '', lastWorkingDay: '',
    panNumber: '', aadhaarNumber: '', pfNumber: '', esiNumber: '', uanNumber: '',
    revisionReason: '',
  })

  // ── Salary ─────────────────────────────────────────────────────────────────
  const [salaryInput, setSalaryInput] = useState({
    annualCtc:        0,
    basicPercent:     45,
    hraPercent:       35,
    transportMonthly: null as number | null,
    fbpMonthly:       null as number | null,
    mediclaim:        0,
    hasIncentive:     false,
    incentivePercent: 12,
  })

  const [error, setError] = useState('')

  // ── Populate from employee data ─────────────────────────────────────────────
  useEffect(() => {
    if (!employee) return
    setForm({
      name:            employee.name || '',
      email:           employee.email || '',
      mobilePhone:     employee.mobilePhone || '',
      jobTitle:        employee.jobTitle || '',
      department:      employee.department || '',
      state:           employee.state || '',
      officeLocation:  employee.officeLocation || '',
      joiningDate:     employee.joiningDate?.slice(0, 10) || '',
      resignationDate: employee.resignationDate?.slice(0, 10) || '',
      lastWorkingDay:  employee.lastWorkingDay?.slice(0, 10) || '',
      panNumber:       employee.panNumber || '',
      aadhaarNumber:   employee.aadhaarNumber || '',
      pfNumber:        employee.pfNumber || '',
      esiNumber:       employee.esiNumber || '',
      uanNumber:       employee.uanNumber || '',
      revisionReason:  '',
    })
    setSalaryInput({
      annualCtc:        Number(employee.annualCtc) || 0,
      basicPercent:     Number(employee.basicPercent) || 45,
      hraPercent:       Number(employee.hraPercent) || 35,
      transportMonthly: employee.transportMonthly != null ? Number(employee.transportMonthly) : null,
      fbpMonthly:       employee.fbpMonthly != null ? Number(employee.fbpMonthly) : null,
      mediclaim:        Number(employee.mediclaim) || 0,
      hasIncentive:     Boolean(employee.hasIncentive),
      incentivePercent: Number(employee.incentivePercent) || 12,
    })
  }, [employee])

  const mutation = useMutation({
    mutationFn: (payload: any) => employeeApi.update(id!, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['employee', id] })
      queryClient.invalidateQueries({ queryKey: ['employees'] })
      navigate(`/hr/employees/${id}`)
    },
    onError: (err: any) => {
      setError(err?.response?.data?.error || err?.response?.data?.message || 'Failed to save changes')
    },
  })

  function setField(key: string, value: string) {
    setForm(prev => ({ ...prev, [key]: value }))
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (salaryInput.annualCtc <= 0) { setError('Annual CTC is required'); return }

    mutation.mutate({
      ...form,
      joiningDate:      form.joiningDate ? new Date(form.joiningDate).toISOString() : undefined,
      resignationDate:  form.resignationDate ? new Date(form.resignationDate).toISOString() : undefined,
      lastWorkingDay:   form.lastWorkingDay ? new Date(form.lastWorkingDay).toISOString() : undefined,
      annualCtc:          salaryInput.annualCtc,
      hasIncentive:       salaryInput.hasIncentive,
      incentivePercent:   salaryInput.incentivePercent,
      transportMonthly:   salaryInput.transportMonthly,
      fbpMonthly:         salaryInput.fbpMonthly,
      mediclaim:          salaryInput.mediclaim,
      revisionReason:     form.revisionReason,
    })
  }

  if (isLoading) return <div className="space-y-4"><Skeleton className="h-10 w-48" /><Skeleton className="h-64 rounded-xl" /></div>
  if (!employee) return <Alert type="error" message="Employee not found." />

  const isSynced   = !!employee.entraId
  const ctcChanged = employee && salaryInput.annualCtc > 0 && salaryInput.annualCtc !== Number(employee.annualCtc)

  return (
    <div className="space-y-5 max-w-4xl">
      <PageHeader
        title={`Edit — ${employee.name}`}
        subtitle={employee.employeeCode}
        actions={
          <Button variant="ghost" icon={<ArrowLeft size={14} />} onClick={() => navigate(`/hr/employees/${id}`)}>
            Back
          </Button>
        }
      />

      {isSynced && (
        <Alert type="info" title="M365 Synced Employee"
          message="Name and email are synced from Microsoft 365. Update them in Entra ID admin portal." />
      )}

      {error && <Alert type="error" message={error} />}

      <form onSubmit={handleSubmit} className="space-y-5">

        {/* ── PERSONAL ─────────────────────────────────────────── */}
        <Card>
          <div className="p-5">
            <SectionHeading icon={User} title="Personal Details" />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="label">Full Name *</label>
                <input className="input" value={form.name} disabled={isSynced}
                  onChange={e => setField('name', e.target.value)} />
              </div>
              <div>
                <label className="label">Email *</label>
                <input className="input" type="email" value={form.email} disabled={isSynced}
                  onChange={e => setField('email', e.target.value)} />
              </div>
              <div>
                <label className="label">Mobile</label>
                <input className="input" placeholder="+91 98765 43210" value={form.mobilePhone}
                  onChange={e => setField('mobilePhone', e.target.value)} />
              </div>
            </div>
          </div>
        </Card>

        {/* ── EMPLOYMENT ───────────────────────────────────────── */}
        <Card>
          <div className="p-5">
            <SectionHeading icon={Briefcase} title="Employment Details" />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="label">Designation</label>
                <input className="input" value={form.jobTitle}
                  onChange={e => setField('jobTitle', e.target.value)} />
              </div>
              <div>
                <label className="label">Department</label>
                <input className="input" value={form.department}
                  onChange={e => setField('department', e.target.value)} />
              </div>
              <div>
                <label className="label">Joining Date *</label>
                <input className="input" type="date" value={form.joiningDate}
                  onChange={e => setField('joiningDate', e.target.value)} />
              </div>
              <div>
                <label className="label">State (for PT)</label>
                <select className="input" value={form.state} onChange={e => setField('state', e.target.value)}>
                  <option value="">Select state…</option>
                  {STATES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Office Location</label>
                <input className="input" value={form.officeLocation}
                  onChange={e => setField('officeLocation', e.target.value)} />
              </div>
            </div>
          </div>
        </Card>

        {/* ── RESIGNATION ──────────────────────────────────────── */}
        <Card>
          <div className="p-5">
            <SectionHeading icon={AlertTriangle} title="Resignation (if applicable)" />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="label">Resignation Date</label>
                <input className="input" type="date" value={form.resignationDate}
                  onChange={e => setField('resignationDate', e.target.value)} />
              </div>
              <div>
                <label className="label">Last Working Day</label>
                <input className="input" type="date" value={form.lastWorkingDay}
                  onChange={e => setField('lastWorkingDay', e.target.value)} />
              </div>
            </div>
            {form.resignationDate && (
              <div className="mt-3 p-3 bg-amber-50 rounded-xl border border-amber-100 text-xs text-amber-700">
                Setting a resignation date will change employee status to <strong>ON NOTICE</strong>.
              </div>
            )}
          </div>
        </Card>

        {/* ── SALARY ───────────────────────────────────────────── */}
        <Card>
          <div className="p-5">
            <SectionHeading icon={DollarSign} title="Salary Structure" />

            {ctcChanged && (
              <div className="mb-4 p-3 bg-blue-50 rounded-xl border border-blue-100 text-xs text-blue-700 flex items-start gap-2">
                <AlertTriangle size={13} className="flex-shrink-0 mt-0.5" />
                <span>
                  CTC changing from <Rupee amount={employee.annualCtc} className="font-semibold" /> to{' '}
                  <Rupee amount={salaryInput.annualCtc} className="font-semibold" />.
                  This will be logged as a salary revision effective April 2026.
                </span>
              </div>
            )}

            <SalaryBreakdownForm
              initialValues={salaryInput}
              onChange={setSalaryInput}
            />

            {ctcChanged && (
              <div className="mt-4">
                <label className="label">Revision Reason</label>
                <input className="input" placeholder="e.g. Annual appraisal April 2026"
                  value={form.revisionReason}
                  onChange={e => setField('revisionReason', e.target.value)} />
              </div>
            )}
          </div>
        </Card>

        {/* ── COMPLIANCE ───────────────────────────────────────── */}
        <Card>
          <div className="p-5">
            <SectionHeading icon={CreditCard} title="Compliance Details" />
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {[
                { label: 'PAN', key: 'panNumber', placeholder: 'ABCDE1234F' },
                { label: 'Aadhaar', key: 'aadhaarNumber', placeholder: 'XXXX XXXX XXXX' },
                { label: 'PF Number', key: 'pfNumber', placeholder: 'PF account number' },
                { label: 'ESI Number', key: 'esiNumber', placeholder: 'ESI number' },
                { label: 'UAN', key: 'uanNumber', placeholder: 'Universal account number' },
              ].map(({ label, key, placeholder }) => (
                <div key={key}>
                  <label className="label">{label}</label>
                  <input className="input" placeholder={placeholder}
                    value={(form as any)[key]}
                    onChange={e => setField(key, e.target.value)} />
                </div>
              ))}
            </div>
          </div>
        </Card>

        <div className="flex justify-end gap-3 pb-6">
          <Button variant="secondary" type="button" onClick={() => navigate(`/hr/employees/${id}`)}>
            Cancel
          </Button>
          <Button type="submit" loading={mutation.isPending} icon={<Save size={14} />}>
            Save Changes
          </Button>
        </div>

      </form>
    </div>
  )
}
