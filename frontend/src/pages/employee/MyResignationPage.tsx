import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, LogOut, Clock, CheckCircle2, RotateCcw, Calendar } from 'lucide-react'
import { exitApi } from '../../services/api'
import { useAuthStore } from '../../store/authStore'
import { PageHeader, Button, Alert, Card } from '../../components/ui'

function DaysRemaining({ expectedLwd }: { expectedLwd: string }) {
  const lwd  = new Date(expectedLwd)
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const diff  = Math.ceil((lwd.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
  const color = diff <= 7 ? 'text-red-600' : diff <= 30 ? 'text-amber-600' : 'text-emerald-600'
  return (
    <div className="flex items-center gap-2">
      <Clock size={14} className={color} />
      <span className={`text-sm font-semibold ${color}`}>
        {diff > 0 ? `${diff} days remaining` : 'Last working day reached'}
      </span>
    </div>
  )
}

export default function MyResignationPage() {
  const { user } = useAuthStore()
  const qc = useQueryClient()

  const [showForm, setShowForm]     = useState(false)
  const [reason, setReason]         = useState('')
  const [requests, setRequests]     = useState('')
  const [confirm, setConfirm]       = useState(false)
  const [error, setError]           = useState('')

  const { data, isLoading } = useQuery({
    queryKey: ['my-exit', user?.id],
    queryFn:  () => exitApi.get(user!.id).then(r => r.data.data),
    enabled:  !!user?.id,
  })

  const resignMut = useMutation({
    mutationFn: () => exitApi.resign(user!.id, { reason, requests }),
    onSuccess:  () => { qc.invalidateQueries({ queryKey: ['my-exit'] }); setShowForm(false) },
    onError:    (e: any) => setError(e?.response?.data?.error || 'Failed to submit resignation'),
  })

  const withdrawMut = useMutation({
    mutationFn: () => exitApi.withdraw(user!.id),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ['my-exit', 'auth-user'] }),
    onError:    (e: any) => setError(e?.response?.data?.error || 'Failed to withdraw'),
  })

  if (isLoading) return <div className="p-8 text-slate-400 text-sm">Loading...</div>

  const isOnNotice  = data?.status === 'ON_NOTICE'
  const isSeparated = data?.status === 'SEPARATED'
  const canWithdraw = isOnNotice && data?.withdrawalEnabled && !data?.withdrawnAt

  return (
    <div className="space-y-5 max-w-2xl">
      <PageHeader title="My Resignation" subtitle="Manage your resignation and notice period" />

      {error && <Alert type="error" message={error} />}

      {/* Not on notice — show initiate button */}
      {!isOnNotice && !isSeparated && (
        <Card>
          <div className="p-6">
            {!showForm ? (
              <div className="text-center space-y-4 py-4">
                <div className="w-12 h-12 rounded-full bg-red-50 flex items-center justify-center mx-auto">
                  <LogOut size={20} className="text-red-500" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-700">Initiate Resignation</p>
                  <p className="text-xs text-slate-400 mt-1">Once submitted, your resignation cannot be withdrawn unless HR enables it.</p>
                </div>
                <Button variant="danger" onClick={() => { setShowForm(true); setError('') }}>
                  Initiate Resignation
                </Button>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center gap-3 p-3 bg-amber-50 border border-amber-100 rounded-xl">
                  <AlertTriangle size={15} className="text-amber-500 flex-shrink-0" />
                  <p className="text-xs text-amber-700">
                    Your resignation will be <strong>auto-approved immediately</strong> and your status will change to On Notice. This action cannot be undone unless HR enables withdrawal.
                  </p>
                </div>

                <div>
                  <label className="label">Reason for Resignation <span className="text-red-500">*</span></label>
                  <textarea
                    className="input resize-none"
                    rows={4}
                    placeholder="Please provide a detailed reason for your resignation..."
                    value={reason}
                    onChange={e => setReason(e.target.value)}
                  />
                  <p className="text-xs text-slate-400 mt-1">{reason.length} characters (minimum 10)</p>
                </div>

                <div>
                  <label className="label">Any Requests / Notes (optional)</label>
                  <textarea
                    className="input resize-none"
                    rows={3}
                    placeholder="Any specific requests, e.g. regarding notice period, handover, etc."
                    value={requests}
                    onChange={e => setRequests(e.target.value)}
                  />
                </div>

                <label className="flex items-start gap-2 cursor-pointer">
                  <input type="checkbox" className="mt-0.5 w-4 h-4 rounded"
                    checked={confirm} onChange={e => setConfirm(e.target.checked)} />
                  <span className="text-xs text-slate-600">
                    I understand that submitting this resignation is final and will immediately change my employment status to On Notice.
                  </span>
                </label>

                <div className="flex gap-2 justify-end">
                  <Button variant="ghost" onClick={() => { setShowForm(false); setError('') }}>Cancel</Button>
                  <Button
                    variant="danger"
                    loading={resignMut.isPending}
                    disabled={!confirm || reason.length < 10}
                    onClick={() => { setError(''); resignMut.mutate() }}
                  >
                    Submit Resignation
                  </Button>
                </div>
              </div>
            )}
          </div>
        </Card>
      )}

      {/* On notice — show status card */}
      {isOnNotice && data && (
        <>
          <Card>
            <div className="p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                  <span className="text-sm font-semibold text-amber-700">On Notice Period</span>
                </div>
                {data.expectedLwd && <DaysRemaining expectedLwd={data.expectedLwd} />}
              </div>

              <div className="grid grid-cols-2 gap-4 pt-2 border-t border-slate-100">
                <div>
                  <p className="text-xs text-slate-400 mb-1">Resignation Date</p>
                  <p className="text-sm font-medium text-slate-700">
                    {data.resignationDate
                      ? new Date(data.resignationDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
                      : '—'}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-slate-400 mb-1">Expected Last Working Day</p>
                  <p className="text-sm font-medium text-slate-700">
                    {data.expectedLwd
                      ? new Date(data.expectedLwd).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
                      : '—'}
                  </p>
                </div>
                {data.lastWorkingDay && (
                  <div>
                    <p className="text-xs text-slate-400 mb-1">Confirmed Last Working Day</p>
                    <p className="text-sm font-medium text-emerald-700">
                      {new Date(data.lastWorkingDay).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                    </p>
                  </div>
                )}
                <div>
                  <p className="text-xs text-slate-400 mb-1">Notice Period</p>
                  <p className="text-sm font-medium text-slate-700">{data.noticePeriodDays ?? 90} days</p>
                </div>
                <div>
                  <p className="text-xs text-slate-400 mb-1">Exit Type</p>
                  <p className="text-sm font-medium text-slate-700">{data.exitType || 'Resigned'}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-400 mb-1">Initiated By</p>
                  <p className="text-sm font-medium text-slate-700">{data.resignationInitiatedBy === 'SELF' ? 'Self' : 'HR / Admin'}</p>
                </div>
              </div>

              {data.resignationReason && (
                <div className="pt-3 border-t border-slate-100">
                  <p className="text-xs text-slate-400 mb-1">Reason Submitted</p>
                  <p className="text-sm text-slate-600 whitespace-pre-wrap">{data.resignationReason}</p>
                </div>
              )}

              {data.resignationRequests && (
                <div>
                  <p className="text-xs text-slate-400 mb-1">Your Requests</p>
                  <p className="text-sm text-slate-600 whitespace-pre-wrap">{data.resignationRequests}</p>
                </div>
              )}
            </div>
          </Card>

          {/* Notice period leave info */}
          <Card>
            <div className="p-5">
              <div className="flex items-start gap-3 p-3 bg-red-50 border border-red-100 rounded-xl">
                <AlertTriangle size={15} className="text-red-500 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-red-700">Leave Policy During Notice Period</p>
                  <p className="text-xs text-red-600 mt-1">
                    You have <strong>0 paid leaves</strong> available during your notice period. Any leave you apply for will be marked as <strong>Loss of Pay (LOP)</strong>. Super Admin may convert LOP to paid on a case-by-case basis.
                  </p>
                </div>
              </div>
            </div>
          </Card>

          {/* Withdrawal */}
          {canWithdraw && (
            <Card>
              <div className="p-5">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-semibold text-slate-700">Withdraw Resignation</p>
                    <p className="text-xs text-slate-400 mt-0.5">Your administrator has enabled the option to withdraw your resignation.</p>
                  </div>
                  <Button
                    variant="secondary"
                    icon={<RotateCcw size={14} />}
                    loading={withdrawMut.isPending}
                    onClick={() => { setError(''); withdrawMut.mutate() }}
                  >
                    Withdraw
                  </Button>
                </div>
              </div>
            </Card>
          )}
        </>
      )}

      {/* Separated */}
      {isSeparated && (
        <Card>
          <div className="p-6 text-center space-y-3">
            <CheckCircle2 size={32} className="text-slate-400 mx-auto" />
            <p className="text-sm font-semibold text-slate-600">Employment Separated</p>
            <p className="text-xs text-slate-400">
              Your employment was formally separated on{' '}
              {data?.lastWorkingDay
                ? new Date(data.lastWorkingDay).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
                : '—'}.
            </p>
          </div>
        </Card>
      )}

      {/* History */}
      {data?.resignationHistory?.length > 0 && (
        <Card>
          <div className="p-5">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Activity Log</p>
            <div className="space-y-3">
              {data.resignationHistory.map((h: any) => (
                <div key={h.id} className="flex items-start gap-3">
                  <div className="w-1.5 h-1.5 rounded-full bg-slate-300 mt-2 flex-shrink-0" />
                  <div>
                    <p className="text-xs font-medium text-slate-700">{h.action.replace(/_/g, ' ')}</p>
                    <p className="text-xs text-slate-400">
                      {h.performedByName} · {new Date(h.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                    </p>
                    {h.notes && <p className="text-xs text-slate-500 mt-0.5">{h.notes}</p>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </Card>
      )}
    </div>
  )
}
