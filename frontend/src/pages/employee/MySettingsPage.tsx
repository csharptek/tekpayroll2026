import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Shield, Eye, EyeOff, CheckCircle, AlertCircle } from 'lucide-react'
import { payslipApi } from '../../services/api'
import { PageHeader, Card } from '../../components/ui'

const inp = 'w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400'

function PwInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  const [show, setShow] = useState(false)
  return (
    <div className="relative">
      <input
        type={show ? 'text' : 'password'}
        className={`${inp} pr-10`}
        placeholder={placeholder}
        value={value}
        onChange={e => onChange(e.target.value)}
      />
      <button type="button" onClick={() => setShow(p => !p)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">
        {show ? <EyeOff size={16} /> : <Eye size={16} />}
      </button>
    </div>
  )
}

export default function MySettingsPage() {
  const qc = useQueryClient()
  const [oldPw, setOldPw] = useState('')
  const [newPw, setNewPw] = useState('')
  const [confirmPw, setConfirmPw] = useState('')
  const [status, setStatus] = useState<{ type: 'success' | 'error'; msg: string } | null>(null)

  const { data: pwStatus, isLoading } = useQuery({
    queryKey: ['payslip-password-status'],
    queryFn: () => payslipApi.passwordStatus().then(r => r.data.data),
  })

  const { mutate: setPassword, isLoading: saving } = useMutation({
    mutationFn: () => payslipApi.setPassword({
      ...(pwStatus?.hasPassword && !pwStatus?.resetAllowed ? { oldPassword: oldPw } : {}),
      newPassword: newPw,
    }),
    onSuccess: () => {
      setStatus({ type: 'success', msg: 'Password saved successfully.' })
      setOldPw(''); setNewPw(''); setConfirmPw('')
      qc.invalidateQueries({ queryKey: ['payslip-password-status'] })
    },
    onError: (e: any) => {
      setStatus({ type: 'error', msg: e?.response?.data?.error || 'Failed to save password' })
    },
  })

  const requiresOld = pwStatus?.hasPassword && !pwStatus?.resetAllowed

  const handleSubmit = () => {
    setStatus(null)
    if (newPw.length < 4) { setStatus({ type: 'error', msg: 'Password must be at least 4 characters' }); return }
    if (newPw !== confirmPw) { setStatus({ type: 'error', msg: 'Passwords do not match' }); return }
    if (requiresOld && !oldPw) { setStatus({ type: 'error', msg: 'Enter your current password' }); return }
    setPassword()
  }

  return (
    <div className="space-y-5 max-w-lg">
      <PageHeader title="My Settings" subtitle="Manage your account preferences" />

      <Card>
        <div className="p-5 space-y-5">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-blue-50 rounded-xl flex items-center justify-center">
              <Shield size={18} className="text-blue-600" />
            </div>
            <div>
              <p className="font-semibold text-slate-800 text-sm">Payslip Password</p>
              <p className="text-xs text-slate-500">
                {pwStatus?.hasPassword ? 'Password is set. Change it below.' : 'No password set. Set one to protect your salary figures.'}
              </p>
            </div>
            {pwStatus?.hasPassword && (
              <span className="ml-auto text-xs bg-green-50 text-green-700 border border-green-200 px-2 py-0.5 rounded-full font-medium">Active</span>
            )}
          </div>

          {pwStatus?.resetAllowed && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-800">
              Your admin has allowed you to set a new password without entering the old one.
            </div>
          )}

          {isLoading ? null : (
            <div className="space-y-3">
              {requiresOld && (
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Current Password</label>
                  <PwInput value={oldPw} onChange={setOldPw} placeholder="Enter current password" />
                </div>
              )}
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  {pwStatus?.hasPassword ? 'New Password' : 'Set Password'}
                </label>
                <PwInput value={newPw} onChange={setNewPw} placeholder="At least 4 characters" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Confirm Password</label>
                <PwInput value={confirmPw} onChange={setConfirmPw} placeholder="Repeat password" />
              </div>

              {status && (
                <div className={`flex items-center gap-2 text-xs p-3 rounded-lg ${status.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                  {status.type === 'success' ? <CheckCircle size={14} /> : <AlertCircle size={14} />}
                  {status.msg}
                </div>
              )}

              <button
                onClick={handleSubmit}
                disabled={saving || !newPw || !confirmPw}
                className="w-full py-2.5 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-40"
              >
                {saving ? 'Saving…' : pwStatus?.hasPassword ? 'Change Password' : 'Set Password'}
              </button>
            </div>
          )}

          <p className="text-xs text-slate-400 border-t border-slate-100 pt-3">
            If you forget your password, contact your admin to enable a reset.
          </p>
        </div>
      </Card>
    </div>
  )
}
