import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Save, User, Briefcase, DollarSign, CreditCard, AlertTriangle } from 'lucide-react'
import { employeeApi } from '../../services/api'
import { PageHeader, Button, Input, Card, Alert, Skeleton, Rupee } from '../../components/ui'

const STATES = ['Andhra Pradesh','Arunachal Pradesh','Assam','Bihar','Chhattisgarh','Goa','Gujarat','Haryana','Himachal Pradesh','Jharkhand','Karnataka','Kerala','Madhya Pradesh','Maharashtra','Manipur','Meghalaya','Mizoram','Nagaland','Odisha','Punjab','Rajasthan','Sikkim','Tamil Nadu','Telangana','Tripura','Uttar Pradesh','Uttarakhand','West Bengal','Delhi','Jammu & Kashmir','Ladakh']

const schema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  jobTitle: z.string().optional(),
  department: z.string().optional(),
  mobilePhone: z.string().optional(),
  state: z.string().optional(),
  officeLocation: z.string().optional(),
  joiningDate: z.string().min(1),
  resignationDate: z.string().optional(),
  lastWorkingDay: z.string().optional(),
  annualCtc: z.coerce.number().positive(),
  annualIncentive: z.coerce.number().min(0),
  revisionReason: z.string().optional(),
  panNumber: z.string().optional(),
  aadhaarNumber: z.string().optional(),
  pfNumber: z.string().optional(),
  esiNumber: z.string().optional(),
  uanNumber: z.string().optional(),
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

export default function EditEmployeePage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const { data: employee, isLoading } = useQuery({
    queryKey: ['employee', id],
    queryFn: () => employeeApi.get(id!).then(r => r.data.data),
    enabled: !!id,
  })

  const { register, handleSubmit, reset, watch, formState: { errors, dirtyFields } } = useForm<FormData>({
    resolver: zodResolver(schema),
  })

  useEffect(() => {
    if (!employee) return
    reset({
      name: employee.name,
      email: employee.email,
      jobTitle: employee.jobTitle || '',
      department: employee.department || '',
      mobilePhone: employee.mobilePhone || '',
      state: employee.state || '',
      officeLocation: employee.officeLocation || '',
      joiningDate: employee.joiningDate?.slice(0, 10) || '',
      resignationDate: employee.resignationDate?.slice(0, 10) || '',
      lastWorkingDay: employee.lastWorkingDay?.slice(0, 10) || '',
      annualCtc: Number(employee.annualCtc),
      annualIncentive: Number(employee.annualIncentive),
      panNumber: employee.panNumber || '',
      aadhaarNumber: employee.aadhaarNumber || '',
      pfNumber: employee.pfNumber || '',
      esiNumber: employee.esiNumber || '',
      uanNumber: employee.uanNumber || '',
    })
  }, [employee, reset])

  const mutation = useMutation({
    mutationFn: (data: FormData) => employeeApi.update(id!, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['employee', id] })
      queryClient.invalidateQueries({ queryKey: ['employees'] })
      navigate(`/hr/employees/${id}`)
    },
  })

  const newCtc = watch('annualCtc')
  const ctcChanged = employee && newCtc && Number(newCtc) !== Number(employee.annualCtc)
  const resignationDate = watch('resignationDate')

  if (isLoading) return <div className="space-y-4"><Skeleton className="h-10 w-48" /><Skeleton className="h-64 rounded-xl" /></div>
  if (!employee) return <Alert type="error" message="Employee not found." />

  // Fields synced from Entra ID are read-only
  const isSynced = !!employee.entraId

  return (
    <div className="space-y-5 max-w-4xl">
      <PageHeader
        title={`Edit — ${employee.name}`}
        subtitle={employee.employeeCode}
        actions={<Button variant="ghost" icon={<ArrowLeft size={14} />} onClick={() => navigate(`/hr/employees/${id}`)}>Back</Button>}
      />

      {isSynced && (
        <Alert type="info" title="M365 Synced Employee"
          message="Name, email and Entra ID fields are synced from Microsoft 365 and cannot be edited here. Update them in the Entra ID admin portal." />
      )}

      {mutation.isError && (
        <Alert type="error" message={(mutation.error as any)?.response?.data?.error || 'Failed to save changes'} />
      )}

      <form onSubmit={handleSubmit(d => mutation.mutate(d))} className="space-y-5">

        {/* Personal */}
        <Card>
          <div className="p-5">
            <SectionHeading icon={User} title="Personal Details" />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Input label="Full Name *" disabled={isSynced} error={errors.name?.message} {...register('name')} />
              <Input label="Email *" type="email" disabled={isSynced} error={errors.email?.message} {...register('email')} />
              <Input label="Mobile" placeholder="+91 98765 43210" {...register('mobilePhone')} />
            </div>
          </div>
        </Card>

        {/* Employment */}
        <Card>
          <div className="p-5">
            <SectionHeading icon={Briefcase} title="Employment Details" />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Input label="Designation" {...register('jobTitle')} />
              <Input label="Department" {...register('department')} />
              <Input label="Joining Date *" type="date" error={errors.joiningDate?.message} {...register('joiningDate')} />
              <div className="flex flex-col gap-1">
                <label className="label">State (for PT)</label>
                <select className="input" {...register('state')}>
                  <option value="">Select state…</option>
                  {STATES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <Input label="Office Location" {...register('officeLocation')} />
            </div>
          </div>
        </Card>

        {/* Resignation */}
        <Card>
          <div className="p-5">
            <SectionHeading icon={AlertTriangle} title="Resignation (if applicable)" />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Input label="Resignation Date" type="date" {...register('resignationDate')} />
              <Input label="Last Working Day" type="date" {...register('lastWorkingDay')} />
            </div>
            {resignationDate && (
              <div className="mt-3 p-3 bg-amber-50 rounded-xl border border-amber-100 text-xs text-amber-700">
                Setting a resignation date will change employee status to <strong>ON NOTICE</strong> and trigger F&F eligibility.
              </div>
            )}
          </div>
        </Card>

        {/* Salary */}
        <Card>
          <div className="p-5">
            <SectionHeading icon={DollarSign} title="Salary" />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
              <Input label="Annual CTC (₹) *" type="number" error={errors.annualCtc?.message} {...register('annualCtc')} />
              <Input label="Annual Incentive (₹)" type="number" {...register('annualIncentive')} />
            </div>

            {ctcChanged && (
              <div className="space-y-3">
                <div className="p-3 bg-blue-50 rounded-xl border border-blue-100 text-xs text-blue-700 flex items-start gap-2">
                  <AlertTriangle size={13} className="flex-shrink-0 mt-0.5" />
                  <span>
                    CTC is changing from <Rupee amount={employee.annualCtc} className="font-semibold" /> to <Rupee amount={newCtc} className="font-semibold" />.
                    This will be logged as a salary revision. Provide a reason below.
                  </span>
                </div>
                <Input label="Revision Reason" placeholder="e.g. Annual appraisal 2025" {...register('revisionReason')} />
              </div>
            )}
          </div>
        </Card>

        {/* Compliance */}
        <Card>
          <div className="p-5">
            <SectionHeading icon={CreditCard} title="Compliance Details" />
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <Input label="PAN" placeholder="ABCDE1234F" {...register('panNumber')} />
              <Input label="Aadhaar" placeholder="XXXX XXXX XXXX" {...register('aadhaarNumber')} />
              <Input label="PF Number" {...register('pfNumber')} />
              <Input label="ESI Number" {...register('esiNumber')} />
              <Input label="UAN" {...register('uanNumber')} />
            </div>
          </div>
        </Card>

        <div className="flex justify-end gap-3 pb-6">
          <Button variant="secondary" type="button" onClick={() => navigate(`/hr/employees/${id}`)}>Cancel</Button>
          <Button type="submit" loading={mutation.isPending} icon={<Save size={14} />}>Save Changes</Button>
        </div>
      </form>
    </div>
  )
}
