import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Save, User, Briefcase, DollarSign, CreditCard } from 'lucide-react'
import { employeeApi } from '../../services/api'
import { PageHeader, Button, Card, Alert } from '../../components/ui'
import { DatePicker } from '../../components/DatePicker'
import SalaryCalculatorForm, { SalaryOutput } from '../../components/SalaryCalculatorForm'

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

  // Employee type controls ID prefix
  const [employeeType, setEmployeeType] = useState<'EMPLOYEE' | 'TRAINEE'>('EMPLOYEE')
  const [codeLoading, setCodeLoading]   = useState(false)

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

  // Auto-fetch next code when employeeType changes
  async function handleTypeChange(type: 'EMPLOYEE' | 'TRAINEE') {
    setEmployeeType(type)
    setCodeLoading(true)
    try {
      const res = await employeeApi.nextCode(type)
      setForm(prev => ({ ...prev, employeeCode: res.data.data.nextCode }))
    } catch {
      // silently fail — HR can type manually
    } finally {
      setCodeLoading(false)
    }
  }

  // Fetch initial next code on mount
  useState(() => { handleTypeChange('EMPLOYEE') })

  // Salary state — driven by SalaryCalculatorForm
  const [salaryInput, setSalaryInput] = useState<SalaryOutput>({
    annualCtc:        0,
    basicPercent:     45,
    hraPercent:       35,
    transportMonthly: null,
    fbpMonthly:       null,
    mediclaim:        0,
    hasIncentive:     false,
    incentivePercent: 12,
  })
  const [stipendMonthly, setStipendMonthly] = useState<string>('')

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

    if (!form.mobilePhone || form.mobilePhone.trim().length < 10) {
      setError('Valid mobile number is required')
      return
    }

    const isTrainee = employeeType === 'TRAINEE'

    if (isTrainee) {
      const stipend = parseFloat(stipendMonthly)
      if (!stipendMonthly || isNaN(stipend) || stipend <= 0) {
        setError('Monthly stipend is required for trainees')
        return
      }
      mutation.mutate({
        ...form,
        isTrainee: true,
        joiningDate: new Date(form.joiningDate).toISOString(),
        stipendMonthly: stipend,
        annualCtc: 0,
        tdsMonthly: 0,
      })
    } else {
      if (salaryInput.annualCtc <= 0) {
        setError('Annual CTC is required')
        return
      }
      mutation.mutate({
        ...form,
        isTrainee: false,
        joiningDate: new Date(form.joiningDate).toISOString(),
        annualCtc:          salaryInput.annualCtc,
        basicPercent:       salaryInput.basicPercent,
        hraPercent:         salaryInput.hraPercent,
        hasIncentive:       salaryInput.hasIncentive,
        incentivePercent:   salaryInput.incentivePercent,
        transportMonthly:   salaryInput.transportMonthly,
        fbpMonthly:         salaryInput.fbpMonthly,
        mediclaim:          salaryInput.mediclaim,
        tdsMonthly:         0,
      })
    }
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
                <label className="label">Mobile Number *</label>
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
              <div className="sm:col-span-2">
                <label className="label">Employee Type *</label>
                <div className="flex gap-3 mt-1">
                  {(['EMPLOYEE', 'TRAINEE'] as const).map(t => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => handleTypeChange(t)}
                      className={`flex-1 py-2.5 px-4 rounded-xl border text-sm font-medium transition-all ${
                        employeeType === t
                          ? 'border-brand-600 bg-brand-50 text-brand-700'
                          : 'border-slate-200 text-slate-500 hover:border-slate-300'
                      }`}
                    >
                      {t === 'EMPLOYEE' ? '👤 Employee' : '🎓 Trainee'}
                      <span className="ml-2 text-xs font-mono opacity-60">
                        {t === 'EMPLOYEE' ? 'C#TEK###' : 'C#TEKT####'}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="label">Employee ID *</label>
                <div className="relative">
                  <input className="input font-mono" placeholder="Auto-generated"
                    value={form.employeeCode}
                    onChange={e => setField('employeeCode', e.target.value)} />
                  {codeLoading && (
                    <span className="absolute right-3 top-2.5 text-xs text-slate-400">Loading...</span>
                  )}
                </div>
                <p className="text-xs text-slate-400 mt-1">Auto-filled — edit only if needed</p>
              </div>
              <div>
                <label className="label">Joining Date *</label>
                <DatePicker value={form.joiningDate} onChange={v => setField('joiningDate', v)} />
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
            <SectionHeading icon={DollarSign} title={employeeType === 'TRAINEE' ? 'Stipend' : 'Salary Structure'} />
            {employeeType === 'TRAINEE' ? (
              <div className="max-w-xs">
                <label className="label">Monthly Stipend (₹) *</label>
                <input
                  className="input"
                  type="number"
                  placeholder="e.g. 15000"
                  value={stipendMonthly}
                  onChange={e => setStipendMonthly(e.target.value)}
                />
                <p className="text-xs text-slate-400 mt-1">No ESI / PF / PT. LOP applies.</p>
              </div>
            ) : (
              <SalaryCalculatorForm onChange={setSalaryInput} showInstructions={true} />
            )}
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
