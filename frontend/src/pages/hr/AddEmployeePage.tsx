import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Save, User, Briefcase, DollarSign, CreditCard } from 'lucide-react'
import { employeeApi } from '../../services/api'
import { PageHeader, Button, Card, Alert } from '../../components/ui'
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

export default function AddEmployeePage() {
  const navigate    = useNavigate()
  const queryClient = useQueryClient()

  // Personal / Employment fields
  const [form, setForm] = useState({
    name:           '',
    email:          '',
    mobilePhone:    '',
    employeeCode:   '',
    joiningDate:    '',
    jobTitle:       '',
    department:     '',
    state:          '',
    officeLocation: '',
    panNumber:      '',
    aadhaarNumber:  '',
    pfNumber:       '',
    esiNumber:      '',
    uanNumber:      '',
  })

  // Salary state — driven by SalaryBreakdownForm
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

  const mutation = useMutation({
    mutationFn: (payload: any) => employeeApi.create(payload),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['employees'] })
      navigate(`/hr/employees/${res.data.data.id}`)
    },
    onError: (err: any) => {
      setError(err?.response?.data?.error || 'Failed to create employee')
    },
  })

  function setField(key: string, value: string) {
    setForm(prev => ({ ...prev, [key]: value }))
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    if (!form.name || !form.email || !form.employeeCode || !form.joiningDate) {
      setError('Please fill in all required fields')
      return
    }
    if (salaryInput.annualCtc <= 0) {
      setError('Annual CTC is required')
      return
    }

    mutation.mutate({
      ...form,
      joiningDate: new Date(form.joiningDate).toISOString(),
      annualCtc:          salaryInput.annualCtc,
      hasIncentive:       salaryInput.hasIncentive,
      incentivePercent:   salaryInput.incentivePercent,
      transportMonthly:   salaryInput.transportMonthly,
      fbpMonthly:         salaryInput.fbpMonthly,
      mediclaim:          salaryInput.mediclaim,
      tdsMonthly:         0,
    })
  }

  return (
    <div className="max-w-4xl space-y-5">
      <PageHeader
        title="Add Employee"
        subtitle="Create a new employee record manually"
        actions={
          <Button variant="ghost" icon={<ArrowLeft size={14} />} onClick={() => navigate(-1)}>
            Back
          </Button>
        }
      />

      {error && <Alert type="error" message={error} />}

      <form onSubmit={handleSubmit} className="space-y-5">

        {/* ─── PERSONAL DETAILS ─── */}
        <Card>
          <div className="p-5">
            <SectionHeading icon={User} title="Personal Details" />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="label">Full Name *</label>
                <input className="input" placeholder="e.g. Rahul Sharma"
                  value={form.name} onChange={e => setField('name', e.target.value)} />
              </div>
              <div>
                <label className="label">Email Address *</label>
                <input className="input" type="email" placeholder="rahul@csharptek.com"
                  value={form.email} onChange={e => setField('email', e.target.value)} />
              </div>
              <div>
                <label className="label">Mobile Number</label>
                <input className="input" placeholder="+91 98765 43210"
                  value={form.mobilePhone} onChange={e => setField('mobilePhone', e.target.value)} />
              </div>
            </div>
          </div>
        </Card>

        {/* ─── EMPLOYMENT DETAILS ─── */}
        <Card>
          <div className="p-5">
            <SectionHeading icon={Briefcase} title="Employment Details" />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="label">Employee ID *</label>
                <input className="input" placeholder="e.g. CST-001"
                  value={form.employeeCode} onChange={e => setField('employeeCode', e.target.value)} />
              </div>
              <div>
                <label className="label">Joining Date *</label>
                <input className="input" type="date"
                  value={form.joiningDate} onChange={e => setField('joiningDate', e.target.value)} />
              </div>
              <div>
                <label className="label">Designation</label>
                <input className="input" placeholder="e.g. Senior Developer"
                  value={form.jobTitle} onChange={e => setField('jobTitle', e.target.value)} />
              </div>
              <div>
                <label className="label">Department</label>
                <input className="input" placeholder="e.g. Engineering"
                  value={form.department} onChange={e => setField('department', e.target.value)} />
              </div>
              <div>
                <label className="label">State (for Professional Tax)</label>
                <select className="input" value={form.state} onChange={e => setField('state', e.target.value)}>
                  <option value="">Select state...</option>
                  {STATES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Office Location</label>
                <input className="input" placeholder="e.g. Mumbai, Pune"
                  value={form.officeLocation} onChange={e => setField('officeLocation', e.target.value)} />
              </div>
            </div>
          </div>
        </Card>

        {/* ─── SALARY STRUCTURE ─── */}
        <Card>
          <div className="p-5">
            <SectionHeading icon={DollarSign} title="Salary Structure" />
            <SalaryBreakdownForm
              initialValues={salaryInput}
              onChange={setSalaryInput}
            />
          </div>
        </Card>

        {/* ─── COMPLIANCE DETAILS ─── */}
        <Card>
          <div className="p-5">
            <SectionHeading icon={CreditCard} title="Compliance Details" />
            <p className="text-xs text-slate-400 mb-4">These can be filled later — not required to create the employee record.</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="label">PAN Number</label>
                <input className="input" placeholder="ABCDE1234F"
                  value={form.panNumber} onChange={e => setField('panNumber', e.target.value)} />
              </div>
              <div>
                <label className="label">Aadhaar Number</label>
                <input className="input" placeholder="XXXX XXXX XXXX"
                  value={form.aadhaarNumber} onChange={e => setField('aadhaarNumber', e.target.value)} />
              </div>
              <div>
                <label className="label">PF Number</label>
                <input className="input" placeholder="PF account number"
                  value={form.pfNumber} onChange={e => setField('pfNumber', e.target.value)} />
              </div>
              <div>
                <label className="label">ESI Number</label>
                <input className="input" placeholder="ESI number"
                  value={form.esiNumber} onChange={e => setField('esiNumber', e.target.value)} />
              </div>
              <div>
                <label className="label">UAN Number</label>
                <input className="input" placeholder="Universal account number"
                  value={form.uanNumber} onChange={e => setField('uanNumber', e.target.value)} />
              </div>
            </div>
          </div>
        </Card>

        {/* ─── ACTIONS ─── */}
        <div className="flex justify-end gap-3 pb-6">
          <Button variant="secondary" type="button" onClick={() => navigate(-1)}>Cancel</Button>
          <Button
            type="submit"
            icon={<Save size={14} />}
            loading={mutation.isPending}
          >
            Create Employee
          </Button>
        </div>

      </form>
    </div>
  )
}
