import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Save, User, Briefcase, DollarSign, CreditCard } from 'lucide-react'
import { employeeApi } from '../../services/api'
import { PageHeader, Button, Input, Card, Alert, Divider } from '../../components/ui'

const STATES = ['Andhra Pradesh','Arunachal Pradesh','Assam','Bihar','Chhattisgarh','Goa','Gujarat','Haryana','Himachal Pradesh','Jharkhand','Karnataka','Kerala','Madhya Pradesh','Maharashtra','Manipur','Meghalaya','Mizoram','Nagaland','Odisha','Punjab','Rajasthan','Sikkim','Tamil Nadu','Telangana','Tripura','Uttar Pradesh','Uttarakhand','West Bengal','Delhi','Jammu & Kashmir','Ladakh']

const schema = z.object({
  employeeCode:    z.string().min(1, 'Employee ID is required'),
  name:            z.string().min(2, 'Full name is required'),
  email:           z.string().email('Valid email required'),
  joiningDate:     z.string().min(1, 'Joining date is required'),
  department:      z.string().optional(),
  jobTitle:        z.string().optional(),
  mobilePhone:     z.string().optional(),
  state:           z.string().optional(),
  officeLocation:  z.string().optional(),
  annualCtc:       z.coerce.number().positive('CTC must be greater than 0'),
  annualIncentive: z.coerce.number().min(0).default(0),
  panNumber:       z.string().optional(),
  aadhaarNumber:   z.string().optional(),
  pfNumber:        z.string().optional(),
  esiNumber:       z.string().optional(),
  uanNumber:       z.string().optional(),
})

type FormData = z.infer<typeof schema>

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
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const { register, handleSubmit, watch, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { annualIncentive: 0 },
  })

  const mutation = useMutation({
    mutationFn: (data: FormData) => employeeApi.create(data),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['employees'] })
      navigate(`/hr/employees/${res.data.data.id}`)
    },
  })

  const annualCtc = watch('annualCtc') || 0
  const monthlyCtc   = annualCtc / 12
  const basic        = monthlyCtc * 0.40
  const hra          = basic * 0.80
  const allowances   = monthlyCtc - basic - hra

  function fmt(n: number) {
    return isNaN(n) ? '—' : `₹${Math.round(n).toLocaleString('en-IN')}`
  }

  return (
    <div className="space-y-5 max-w-4xl">
      <PageHeader
        title="Add Employee"
        subtitle="Create a new employee record manually"
        actions={
          <Button variant="ghost" icon={<ArrowLeft size={14} />} onClick={() => navigate('/hr/employees')}>
            Back
          </Button>
        }
      />

      {mutation.isError && (
        <Alert type="error" message={(mutation.error as any)?.response?.data?.error || 'Failed to create employee'} />
      )}

      <form onSubmit={handleSubmit((data) => mutation.mutate(data))} className="space-y-5">

        {/* Personal Details */}
        <Card>
          <div className="p-5">
            <SectionHeading icon={User} title="Personal Details" />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Input
                label="Full Name *"
                placeholder="e.g. Rahul Sharma"
                error={errors.name?.message}
                {...register('name')}
              />
              <Input
                label="Email Address *"
                type="email"
                placeholder="rahul@csharptek.com"
                error={errors.email?.message}
                {...register('email')}
              />
              <Input
                label="Mobile Number"
                placeholder="+91 98765 43210"
                {...register('mobilePhone')}
              />
            </div>
          </div>
        </Card>

        {/* Employment Details */}
        <Card>
          <div className="p-5">
            <SectionHeading icon={Briefcase} title="Employment Details" />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Input
                label="Employee ID *"
                placeholder="e.g. CST-001"
                error={errors.employeeCode?.message}
                {...register('employeeCode')}
              />
              <Input
                label="Joining Date *"
                type="date"
                error={errors.joiningDate?.message}
                {...register('joiningDate')}
              />
              <Input
                label="Designation"
                placeholder="e.g. Senior Developer"
                {...register('jobTitle')}
              />
              <Input
                label="Department"
                placeholder="e.g. Engineering"
                {...register('department')}
              />
              <div className="flex flex-col gap-1">
                <label className="label">State (for Professional Tax)</label>
                <select className="input" {...register('state')}>
                  <option value="">Select state…</option>
                  {STATES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <Input
                label="Office Location"
                placeholder="e.g. Mumbai, Pune"
                {...register('officeLocation')}
              />
            </div>
          </div>
        </Card>

        {/* Salary Structure */}
        <Card>
          <div className="p-5">
            <SectionHeading icon={DollarSign} title="Salary Structure" />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-5">
              <Input
                label="Annual CTC (₹) *"
                type="number"
                placeholder="e.g. 600000"
                error={errors.annualCtc?.message}
                {...register('annualCtc')}
              />
              <Input
                label="Annual Incentive (₹)"
                type="number"
                placeholder="e.g. 60000"
                {...register('annualIncentive')}
              />
            </div>

            {/* Computed preview */}
            {annualCtc > 0 && (
              <div className="bg-brand-50 rounded-xl p-4 border border-brand-100">
                <p className="text-xs font-semibold text-brand-700 mb-3 uppercase tracking-wide">
                  Computed Monthly Breakdown
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {[
                    { label: 'Monthly CTC', value: fmt(monthlyCtc) },
                    { label: 'Basic (40%)', value: fmt(basic) },
                    { label: 'HRA (80% of Basic)', value: fmt(hra) },
                    { label: 'Allowances', value: fmt(allowances) },
                  ].map(({ label, value }) => (
                    <div key={label} className="bg-white rounded-lg p-2.5 border border-brand-100">
                      <p className="text-[10px] text-slate-500 mb-0.5">{label}</p>
                      <p className="text-sm font-bold text-brand-700 rupee">{value}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </Card>

        {/* Compliance */}
        <Card>
          <div className="p-5">
            <SectionHeading icon={CreditCard} title="Compliance Details" />
            <p className="text-xs text-slate-400 mb-4">These can be filled later — not required to create the employee record.</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <Input label="PAN Number" placeholder="ABCDE1234F" {...register('panNumber')} />
              <Input label="Aadhaar Number" placeholder="XXXX XXXX XXXX" {...register('aadhaarNumber')} />
              <Input label="PF Number" placeholder="PF account number" {...register('pfNumber')} />
              <Input label="ESI Number" placeholder="ESI number" {...register('esiNumber')} />
              <Input label="UAN Number" placeholder="Universal account number" {...register('uanNumber')} />
            </div>
          </div>
        </Card>

        {/* Actions */}
        <div className="flex justify-end gap-3 pt-2 pb-6">
          <Button variant="secondary" type="button" onClick={() => navigate('/hr/employees')}>
            Cancel
          </Button>
          <Button type="submit" loading={mutation.isPending} icon={<Save size={14} />}>
            Create Employee
          </Button>
        </div>
      </form>
    </div>
  )
}
