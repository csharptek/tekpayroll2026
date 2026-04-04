import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Save, Shield, Calendar, DollarSign } from 'lucide-react'
import { configApi } from '../../services/api'
import { PageHeader, Button, Card, Alert, Skeleton, Input, Table, Th, Td, Tr } from '../../components/ui'

function Section({ icon: Icon, title, children }: any) {
  return (
    <Card>
      <div className="p-5">
        <div className="flex items-center gap-2 mb-5">
          <div className="w-7 h-7 rounded-lg bg-brand-50 flex items-center justify-center">
            <Icon size={14} className="text-brand-600" />
          </div>
          <h3 className="text-sm font-semibold text-slate-700">{title}</h3>
        </div>
        {children}
      </div>
    </Card>
  )
}

export default function ConfigPage() {
  const qc = useQueryClient()
  const [saved, setSaved] = useState(false)
  const [configValues, setConfigValues] = useState<Record<string, string>>({})
  const [ptSlabs, setPtSlabs] = useState<any[]>([])
  const [newSlab, setNewSlab] = useState({ state: '', minSalary: '', maxSalary: '', ptAmount: '' })

  const { data: config, isLoading: loadingConfig } = useQuery({
    queryKey: ['system-config'],
    queryFn: () => configApi.get().then((r: any) => r.data.data),
  })

  const { data: slabs, isLoading: loadingSlabs } = useQuery({
    queryKey: ['pt-slabs'],
    queryFn: () => configApi.ptSlabs().then((r: any) => r.data.data),
  })

  // React Query v5 — use useEffect instead of onSuccess
  useEffect(() => {
    if (config) setConfigValues(config)
  }, [config])

  useEffect(() => {
    if (slabs) setPtSlabs(slabs)
  }, [slabs])

  const saveMut = useMutation({
    mutationFn: () => configApi.update(configValues),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['system-config'] })
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    },
  })

  const defaultConfigs = [
    { key: 'PF_CAP',          label: 'PF Cap (₹)',          default: '1800',  hint: 'Maximum PF deduction per month' },
    { key: 'ESI_THRESHOLD',   label: 'ESI Threshold (₹)',   default: '21000', hint: 'ESI applies if gross ≤ this amount' },
    { key: 'CYCLE_START_DAY', label: 'Cycle Start Day',      default: '26',    hint: 'Day of previous month cycle starts' },
    { key: 'CYCLE_END_DAY',   label: 'Cycle End Day',        default: '25',    hint: 'Day of current month cycle ends' },
    { key: 'PAYROLL_RUN_DAY', label: 'Payroll Calc Day',     default: '27',    hint: 'Day payroll engine runs each month' },
    { key: 'PAYSLIP_GEN_DAY', label: 'Payslip Release Day',  default: '5',     hint: 'Day payslips are generated & sent' },
  ]

  function getValue(key: string, dflt: string) {
    return configValues[key] ?? (config as any)?.[key] ?? dflt
  }

  return (
    <div className="space-y-5 max-w-4xl">
      <PageHeader title="Configuration" subtitle="Payroll rules, deduction caps and cycle settings"
        actions={<Button icon={<Save size={14} />} loading={saveMut.isPending} onClick={() => saveMut.mutate()}>Save Changes</Button>}
      />

      {saved && <Alert type="success" message="Configuration saved successfully." />}

      <Section icon={DollarSign} title="Deduction Rules">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {defaultConfigs.slice(0, 2).map(({ key, label, default: dflt, hint }) => (
            <div key={key} className="flex flex-col gap-1">
              <label className="label">{label}</label>
              <input type="number" className="input" value={getValue(key, dflt)}
                onChange={e => setConfigValues((p: any) => ({ ...p, [key]: e.target.value }))} />
              <p className="text-xs text-slate-400">{hint}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section icon={Calendar} title="Payroll Cycle Dates">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {defaultConfigs.slice(2).map(({ key, label, default: dflt, hint }) => (
            <div key={key} className="flex flex-col gap-1">
              <label className="label">{label}</label>
              <input type="number" className="input" min="1" max="31" value={getValue(key, dflt)}
                onChange={e => setConfigValues((p: any) => ({ ...p, [key]: e.target.value }))} />
              <p className="text-xs text-slate-400">{hint}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section icon={Shield} title="Professional Tax Slabs">
        <p className="text-xs text-slate-400 mb-4">Configure state-wise PT slabs.</p>
        {loadingSlabs ? <Skeleton className="h-40" /> : (
          <div className="space-y-3">
            <Table>
              <thead><tr className="border-b border-slate-100">
                <Th>State</Th><Th className="text-right">Min Salary</Th><Th className="text-right">Max Salary</Th><Th className="text-right">PT Amount</Th>
              </tr></thead>
              <tbody>
                {((slabs || ptSlabs) as any[]).map((slab: any) => (
                  <Tr key={slab.id}>
                    <Td className="font-medium">{slab.state}</Td>
                    <Td className="text-right rupee">₹{Number(slab.minSalary).toLocaleString('en-IN')}</Td>
                    <Td className="text-right rupee">{slab.maxSalary ? `₹${Number(slab.maxSalary).toLocaleString('en-IN')}` : 'No limit'}</Td>
                    <Td className="text-right rupee font-semibold">₹{Number(slab.ptAmount).toLocaleString('en-IN')}</Td>
                  </Tr>
                ))}
                {!((slabs || ptSlabs) as any[])?.length && (
                  <tr><td colSpan={4} className="text-center py-6 text-sm text-slate-400">No PT slabs configured yet</td></tr>
                )}
              </tbody>
            </Table>
            <div className="bg-slate-50 rounded-xl p-4 border border-slate-100">
              <p className="text-xs font-semibold text-slate-600 mb-3">Add PT Slab</p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <Input placeholder="State" value={newSlab.state} onChange={e => setNewSlab(p => ({ ...p, state: e.target.value }))} />
                <Input type="number" placeholder="Min Salary" value={newSlab.minSalary} onChange={e => setNewSlab(p => ({ ...p, minSalary: e.target.value }))} />
                <Input type="number" placeholder="Max Salary" value={newSlab.maxSalary} onChange={e => setNewSlab(p => ({ ...p, maxSalary: e.target.value }))} />
                <Input type="number" placeholder="PT Amount (₹)" value={newSlab.ptAmount} onChange={e => setNewSlab(p => ({ ...p, ptAmount: e.target.value }))} />
              </div>
              <div className="mt-3 flex justify-end">
                <Button size="sm" disabled={!newSlab.state || !newSlab.ptAmount}
                  onClick={() => { setPtSlabs(p => [...p, { id: Date.now(), ...newSlab }]); setNewSlab({ state: '', minSalary: '', maxSalary: '', ptAmount: '' }) }}>
                  Add Slab
                </Button>
              </div>
            </div>
          </div>
        )}
      </Section>

      <div className="flex justify-end pb-6">
        <Button icon={<Save size={14} />} loading={saveMut.isPending} onClick={() => saveMut.mutate()}>Save All Changes</Button>
      </div>
    </div>
  )
}
