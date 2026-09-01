import { useState, useEffect, useRef } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { format } from 'date-fns'
import {
  Play, Loader2, CheckCircle, XCircle, AlertCircle,
  CreditCard, FileText, RefreshCw, CalendarDays, Terminal, Database, Package,
  FileCode2, Eye, ArrowRightLeft, UserMinus, ShieldAlert
} from 'lucide-react'
import { cronApi, documentsApi, leaveApi } from '../../services/api'
import { PageHeader, Card } from '../../components/ui'
import clsx from 'clsx'

const JOBS = [
  {
    key: 'run-payroll',
    label: 'Run Payroll',
    description: 'Calculate payroll for all active employees',
    icon: CreditCard,
    color: 'blue',
  },
  {
    key: 'generate-payslips',
    label: 'Generate Payslips',
    description: 'Generate & email payslips for previous month',
    icon: FileText,
    color: 'purple',
  },
  {
    key: 'sync-entra',
    label: 'Entra ID Sync',
    description: 'Delta sync employees from Azure Entra ID',
    icon: RefreshCw,
    color: 'green',
  },
  {
    key: 'holiday-greetings',
    label: 'Holiday Greetings',
    description: "Send greeting emails for today's public holiday",
    icon: CalendarDays,
    color: 'amber',
  },
  {
    key: 'migrate-salary-snapshots',
    label: 'Save Salary Structures',
    description: 'Compute & store salary breakup for all active employees. Run once after any bulk CTC update.',
    icon: Database,
    color: 'teal',
  },
  {
    key: 'seed-asset-categories',
    label: 'Seed Asset Categories',
    description: 'Create standard asset categories & sub-categories. Idempotent — safe to re-run.',
    icon: Package,
    color: 'indigo',
  },
  {
    key: 'backfill-notice-skips',
    label: 'Backfill Notice Period Payroll Skips',
    description: 'Creates missing PayrollSkip records for all current ON_NOTICE employees. Run once to ensure salary-on-hold works for existing resignations.',
    icon: UserMinus,
    color: 'rose',
  },
]

const COLOR_MAP: Record<string, string> = {
  blue:   'border-blue-200 bg-blue-50 text-blue-700',
  purple: 'border-purple-200 bg-purple-50 text-purple-700',
  green:  'border-green-200 bg-green-50 text-green-700',
  amber:  'border-amber-200 bg-amber-50 text-amber-700',
  teal:   'border-teal-200 bg-teal-50 text-teal-700',
  indigo: 'border-indigo-200 bg-indigo-50 text-indigo-700',
  rose:   'border-rose-200 bg-rose-50 text-rose-700',
}

const ICON_COLOR: Record<string, string> = {
  blue:   'text-blue-500',
  purple: 'text-purple-500',
  green:  'text-green-500',
  amber:  'text-amber-500',
  teal:   'text-teal-500',
  indigo: 'text-indigo-500',
}

type RunState = {
  status: 'idle' | 'running' | 'success' | 'partial' | 'failed'
  startedAt?: Date
  completedAt?: Date
  message?: string
  errorMessage?: string
  meta?: Record<string, any>
  pollCount: number
}

const DEFAULT_STATE: RunState = { status: 'idle', pollCount: 0 }

export default function RunTasksPage() {
  const [states, setStates] = useState<Record<string, RunState>>(
    Object.fromEntries(JOBS.map(j => [j.key, { ...DEFAULT_STATE }]))
  )

  const pollers = useRef<Record<string, ReturnType<typeof setInterval>>>({})

  function updateState(key: string, patch: Partial<RunState>) {
    setStates(prev => ({ ...prev, [key]: { ...prev[key], ...patch } }))
  }

  function stopPoller(key: string) {
    if (pollers.current[key]) {
      clearInterval(pollers.current[key])
      delete pollers.current[key]
    }
  }

  async function pollLogs(key: string, startedAt: Date) {
    try {
      const res = await cronApi.logs({ jobName: key, limit: 1 })
      const log = res.data?.logs?.[0]
      if (!log) return

      const logStarted = new Date(log.startedAt)
      // Only care about logs started after this run
      if (logStarted < startedAt) return

      setStates(prev => ({
        ...prev,
        [key]: {
          ...prev[key],
          pollCount: prev[key].pollCount + 1,
          message: log.message,
          errorMessage: log.errorMessage,
          meta: log.meta,
          completedAt: log.completedAt ? new Date(log.completedAt) : undefined,
        },
      }))

      if (['success', 'partial', 'failed'].includes(log.status)) {
        updateState(key, { status: log.status as any })
        stopPoller(key)
      }
    } catch {
      // ignore poll errors
    }
  }

  const trigger = useMutation({
    mutationFn: ({ key }: { key: string }) => cronApi.triggerManual(key),
    onMutate: ({ key }) => {
      stopPoller(key)
      updateState(key, { status: 'running', startedAt: new Date(), completedAt: undefined, message: undefined, errorMessage: undefined, meta: undefined, pollCount: 0 })
    },
    onSuccess: (data: any, { key }) => {
      // For salary migration — direct response, no cron log
      if (key === 'migrate-salary-snapshots') {
        const d = data?.data?.data
        if (d) {
          const msg = `Done: ${d.success} saved, ${d.failed} failed out of ${d.total} employees.`
          updateState(key, {
            status: d.failed === 0 ? 'success' : 'partial',
            completedAt: new Date(),
            message: msg,
            meta: { total: d.total, success: d.success, failed: d.failed },
          })
          return
        }
      }
      // For seed asset categories — direct response, no cron log
      if (key === 'seed-asset-categories') {
        const d = data?.data?.data
        if (d) {
          const msg = `Categories: ${d.catCreated} created, ${d.catSkipped} existed. Sub-categories: ${d.subCreated} created, ${d.subSkipped} existed.`
          updateState(key, {
            status: 'success',
            completedAt: new Date(),
            message: msg,
            meta: { catCreated: d.catCreated, catSkipped: d.catSkipped, subCreated: d.subCreated, subSkipped: d.subSkipped },
          })
          return
        }
      }

      if (key === 'backfill-notice-skips') {
        const d = data?.data?.data
        if (d) {
          const msg = `${d.totalEmployees} ON_NOTICE employees found. ${d.totalSkipsCreated} payroll skip records created.`
          updateState(key, { status: 'success', completedAt: new Date(), message: msg })
          return
        }
      }
      // Job done — do one final poll
      pollLogs(key, states[key].startedAt || new Date())
    },
    onError: (_, { key }) => {
      updateState(key, { status: 'failed', errorMessage: 'Failed to trigger task' })
      stopPoller(key)
    },
  })

  function handleRun(key: string) {
    const startedAt = new Date()
    stopPoller(key)
    updateState(key, { status: 'running', startedAt, completedAt: undefined, message: undefined, errorMessage: undefined, meta: undefined, pollCount: 0 })

    // Direct-response tasks: no cron log polling
    const DIRECT = ['migrate-salary-snapshots', 'seed-asset-categories', 'backfill-notice-skips']
    if (!DIRECT.includes(key)) {
      pollers.current[key] = setInterval(() => pollLogs(key, startedAt), 2000)
    }

    trigger.mutate({ key })
  }

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      Object.keys(pollers.current).forEach(stopPoller)
    }
  }, [])

  return (
    <div className="space-y-6">
      <PageHeader
        title="Run Tasks"
        subtitle="Manually trigger background jobs"
      />

      <div className="grid grid-cols-1 gap-4">
        {JOBS.map(job => {
          const state = states[job.key]
          const Icon = job.icon
          const isRunning = state.status === 'running'
          const durationSec = state.startedAt && state.completedAt
            ? Math.round((state.completedAt.getTime() - state.startedAt.getTime()) / 1000)
            : null

          return (
            <Card key={job.key}>
              <div className="p-4 flex gap-4">
                {/* Icon */}
                <div className={clsx('mt-0.5 shrink-0', ICON_COLOR[job.color])}>
                  <Icon size={22} />
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="font-semibold text-gray-800">{job.label}</p>
                      <p className="text-sm text-gray-500 mt-0.5">{job.description}</p>
                    </div>
                    <button
                      onClick={() => handleRun(job.key)}
                      disabled={isRunning}
                      className={clsx(
                        'shrink-0 flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors',
                        isRunning
                          ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                          : 'bg-blue-600 hover:bg-blue-700 text-white'
                      )}
                    >
                      {isRunning
                        ? <><Loader2 size={14} className="animate-spin" /> Running...</>
                        : <><Play size={14} /> Run</>
                      }
                    </button>
                  </div>

                  {/* Status area */}
                  {state.status !== 'idle' && (
                    <div className={clsx(
                      'mt-3 rounded-lg border p-3 text-sm space-y-2',
                      state.status === 'running'  ? 'border-blue-200 bg-blue-50' :
                      state.status === 'success'  ? 'border-green-200 bg-green-50' :
                      state.status === 'partial'  ? 'border-amber-200 bg-amber-50' :
                      'border-red-200 bg-red-50'
                    )}>
                      {/* Status row */}
                      <div className="flex items-center gap-2">
                        {state.status === 'running'  && <Loader2 size={14} className="animate-spin text-blue-500" />}
                        {state.status === 'success'  && <CheckCircle size={14} className="text-green-600" />}
                        {state.status === 'partial'  && <AlertCircle size={14} className="text-amber-600" />}
                        {state.status === 'failed'   && <XCircle size={14} className="text-red-600" />}
                        <span className={clsx(
                          'font-medium',
                          state.status === 'running'  ? 'text-blue-700' :
                          state.status === 'success'  ? 'text-green-700' :
                          state.status === 'partial'  ? 'text-amber-700' :
                          'text-red-700'
                        )}>
                          {state.status === 'running' ? 'In progress — please wait...' :
                           state.status === 'success' ? 'Completed successfully' :
                           state.status === 'partial' ? 'Completed with errors' :
                           'Failed'}
                        </span>
                        {durationSec !== null && (
                          <span className="ml-auto text-xs text-gray-500">{durationSec}s</span>
                        )}
                      </div>

                      {/* Started at */}
                      {state.startedAt && (
                        <div className="text-xs text-gray-500">
                          Started: {format(state.startedAt, 'dd MMM yyyy, hh:mm:ss a')}
                        </div>
                      )}

                      {/* Log message */}
                      {state.message && (
                        <div className="flex items-start gap-1.5">
                          <Terminal size={12} className="mt-0.5 shrink-0 text-gray-400" />
                          <p className="text-gray-700">{state.message}</p>
                        </div>
                      )}

                      {/* Meta stats */}
                      {state.meta && Object.keys(state.meta).length > 0 && (
                        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-600">
                          {Object.entries(state.meta)
                            .filter(([, v]) => v !== null && !Array.isArray(v) && typeof v !== 'object')
                            .map(([k, v]) => (
                              <span key={k}>
                                <span className="font-medium">{k}:</span> {String(v)}
                              </span>
                            ))}
                        </div>
                      )}

                      {/* Error */}
                      {state.errorMessage && (
                        <pre className="text-xs text-red-700 bg-red-100 rounded p-2 whitespace-pre-wrap">
                          {state.errorMessage}
                        </pre>
                      )}

                      {/* Polling indicator */}
                      {state.status === 'running' && state.pollCount > 0 && (
                        <p className="text-xs text-gray-400">Checking for updates... ({state.pollCount})</p>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </Card>
          )
        })}
      </div>

      {/* ── HTML → PDF Migration ─────────────────────────────── */}
      <HtmlToPdfMigrationCard />

      {/* ── LOP Correction ─────────────────────────────── */}
      <LopCorrectionCard />
    </div>
  )
}

// ─── HTML → PDF MIGRATION CARD ────────────────────────────────────────────────

type MigrationDoc = {
  id: string
  employeeName: string
  employeeCode: string
  fileName: string
  documentType: string
  fileSize: number
  createdAt: string
}

type MigrationResult = {
  total: number
  success: number
  failed: number
  errors: string[]
}

// ─── LOP REBUILD CARD ───────────────────────────────────────────────────────

type LopAppDiff = { applicationId: string; employeeName: string; employeeCode: string; leaveKind: string; startDate: string; endDate: string; totalDays: number; currentLopDays: number; correctLopDays: number; reason: string }
type LopEntDiff = { employeeName: string; employeeCode: string; leaveKind: string; year: number; current: { usedDays: number; pendingDays: number; lopDays: number }; correct: { usedDays: number; pendingDays: number; lopDays: number } }
type LopCycleDiff = { payrollMonth: string; cycleStatus: string; editable: boolean; employeeName: string; employeeCode: string; currentLopDays: number; correctLopDays: number }
type LopApplyResult = { successCount: number; errorCount: number; skippedCount: number; results: Array<{ type: string; id: string; employeeName?: string; status: string; detail?: string; message?: string }> }

function LopCorrectionCard() {
  const [previewed, setPreviewed] = useState(false)
  const [applying, setApplying] = useState(false)
  const [result, setResult] = useState<LopApplyResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const previewQuery = useQuery({
    queryKey: ['lop-correction-preview'],
    queryFn: () => leaveApi.lopCorrectionPreview(),
    enabled: false,
  })

  const data = (previewQuery.data as any)?.data?.data
  const applications: LopAppDiff[] = data?.applications ?? []
  const entitlementDiffs: LopEntDiff[] = data?.entitlements ?? []
  const cycleDiffs: LopCycleDiff[] = data?.lopEntries ?? []
  const total: number = data?.total ?? 0
  const lockedChanges: number = data?.lockedCycleChanges ?? 0

  async function handlePreview() {
    setError(null); setResult(null)
    await previewQuery.refetch()
    setPreviewed(true)
  }

  async function handleApply() {
    if (!window.confirm(`Rebuild leave balances & LOP?\n\n${applications.length} leave record(s), ${entitlementDiffs.length} balance row(s), ${cycleDiffs.filter(c => c.editable).length} open-cycle LOP entr(ies) will be SET to recomputed values.\n${lockedChanges} locked-cycle difference(s) will be reported only.\n\nThis cannot be undone.`)) return
    setApplying(true); setError(null); setResult(null)
    try {
      const res = await leaveApi.lopCorrectionApply()
      setResult((res as any).data?.data)
      previewQuery.refetch()
    } catch (e: any) {
      setError(e?.response?.data?.message || e?.message || 'Rebuild failed')
    } finally {
      setApplying(false)
    }
  }

  const hasChanges = total > 0 || lockedChanges > 0

  return (
    <Card>
      <div className="p-4 flex gap-4">
        <div className="mt-0.5 shrink-0 text-red-500"><ShieldAlert size={22} /></div>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="font-semibold text-gray-800">Leave Balance & LOP Rebuild</p>
              <p className="text-sm text-gray-500 mt-0.5">
                Recomputes every leave's LOP, all leave balances, and open-cycle payroll LOP entries from scratch. Locked cycles are never modified.
              </p>
            </div>
            <div className="flex gap-2 shrink-0">
              <button onClick={handlePreview} disabled={previewQuery.isFetching}
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border border-gray-300 bg-white hover:bg-gray-50 text-gray-700 transition-colors disabled:opacity-50">
                {previewQuery.isFetching ? <Loader2 size={14} className="animate-spin" /> : <Eye size={14} />}
                Preview
              </button>
              {previewed && total > 0 && (
                <button onClick={handleApply} disabled={applying}
                  className={clsx('flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors',
                    applying ? 'bg-gray-100 text-gray-400 cursor-not-allowed' : 'bg-red-600 hover:bg-red-700 text-white')}>
                  {applying ? <><Loader2 size={14} className="animate-spin" /> Rebuilding...</> : <><ShieldAlert size={14} /> Rebuild {total}</>}
                </button>
              )}
            </div>
          </div>

          {previewed && !previewQuery.isFetching && (
            <div className={clsx('mt-3 rounded-lg border p-3 text-sm space-y-3',
              hasChanges ? 'border-red-200 bg-red-50' : 'border-green-200 bg-green-50')}>
              <div className="flex items-center gap-2">
                {hasChanges ? <AlertCircle size={14} className="text-red-600" /> : <CheckCircle size={14} className="text-green-600" />}
                <span className={clsx('font-medium', hasChanges ? 'text-red-700' : 'text-green-700')}>
                  {hasChanges
                    ? `${applications.length} leave record(s), ${entitlementDiffs.length} balance row(s), ${cycleDiffs.length} cycle LOP entr(ies) differ${lockedChanges > 0 ? ` — ${lockedChanges} in locked cycles (report-only)` : ''}`
                    : 'Everything already consistent — nothing to rebuild'}
                </span>
              </div>

              {applications.length > 0 && (
                <div className="overflow-x-auto">
                  <p className="text-xs font-semibold text-gray-600 mb-1">Leave records</p>
                  <table className="w-full text-xs text-gray-700">
                    <thead><tr className="text-left text-gray-500 border-b border-red-200">
                      <th className="pb-1 pr-3">Employee</th><th className="pb-1 pr-3">Type</th><th className="pb-1 pr-3">Dates</th>
                      <th className="pb-1 pr-3">LOP now</th><th className="pb-1 pr-3">LOP correct</th><th className="pb-1">Reason</th>
                    </tr></thead>
                    <tbody>
                      {applications.map(m => (
                        <tr key={m.applicationId} className="border-b border-red-100 last:border-0">
                          <td className="py-1 pr-3">{m.employeeName} <span className="text-gray-400">({m.employeeCode})</span></td>
                          <td className="py-1 pr-3">{m.leaveKind}</td>
                          <td className="py-1 pr-3">{format(new Date(m.startDate), 'dd MMM')} – {format(new Date(m.endDate), 'dd MMM yy')}</td>
                          <td className="py-1 pr-3">{m.currentLopDays}</td>
                          <td className="py-1 pr-3 font-medium text-red-700">{m.correctLopDays}</td>
                          <td className="py-1">{m.reason}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {entitlementDiffs.length > 0 && (
                <div className="overflow-x-auto">
                  <p className="text-xs font-semibold text-gray-600 mb-1">Balance rows</p>
                  <table className="w-full text-xs text-gray-700">
                    <thead><tr className="text-left text-gray-500 border-b border-red-200">
                      <th className="pb-1 pr-3">Employee</th><th className="pb-1 pr-3">Kind</th><th className="pb-1 pr-3">Year</th>
                      <th className="pb-1 pr-3">Used</th><th className="pb-1 pr-3">Pending</th><th className="pb-1">LOP</th>
                    </tr></thead>
                    <tbody>
                      {entitlementDiffs.map((e, i) => (
                        <tr key={i} className="border-b border-red-100 last:border-0">
                          <td className="py-1 pr-3">{e.employeeName} <span className="text-gray-400">({e.employeeCode})</span></td>
                          <td className="py-1 pr-3">{e.leaveKind}</td>
                          <td className="py-1 pr-3">{e.year}</td>
                          <td className="py-1 pr-3">{e.current.usedDays} → <span className="font-medium text-red-700">{e.correct.usedDays}</span></td>
                          <td className="py-1 pr-3">{e.current.pendingDays} → <span className="font-medium text-red-700">{e.correct.pendingDays}</span></td>
                          <td className="py-1">{e.current.lopDays} → <span className="font-medium text-red-700">{e.correct.lopDays}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {cycleDiffs.length > 0 && (
                <div className="overflow-x-auto">
                  <p className="text-xs font-semibold text-gray-600 mb-1">Payroll cycle LOP entries</p>
                  <table className="w-full text-xs text-gray-700">
                    <thead><tr className="text-left text-gray-500 border-b border-red-200">
                      <th className="pb-1 pr-3">Cycle</th><th className="pb-1 pr-3">Employee</th>
                      <th className="pb-1 pr-3">LOP now</th><th className="pb-1 pr-3">LOP correct</th><th className="pb-1">Action</th>
                    </tr></thead>
                    <tbody>
                      {cycleDiffs.map((c, i) => (
                        <tr key={i} className="border-b border-red-100 last:border-0">
                          <td className="py-1 pr-3">{c.payrollMonth} <span className="text-gray-400">({c.cycleStatus})</span></td>
                          <td className="py-1 pr-3">{c.employeeName} <span className="text-gray-400">({c.employeeCode})</span></td>
                          <td className="py-1 pr-3">{c.currentLopDays}</td>
                          <td className="py-1 pr-3 font-medium text-red-700">{c.correctLopDays}</td>
                          <td className="py-1">{c.editable ? 'Will update' : <span className="text-amber-700 font-medium">Locked — manual</span>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {result && (
            <div className={clsx('mt-3 rounded-lg border p-3 text-sm space-y-2',
              result.errorCount === 0 ? 'border-green-200 bg-green-50' : 'border-amber-200 bg-amber-50')}>
              <div className="flex items-center gap-2">
                {result.errorCount === 0 ? <CheckCircle size={14} className="text-green-600" /> : <AlertCircle size={14} className="text-amber-600" />}
                <span className={clsx('font-medium', result.errorCount === 0 ? 'text-green-700' : 'text-amber-700')}>
                  {result.successCount} updated{result.skippedCount > 0 ? `, ${result.skippedCount} locked-cycle skipped` : ''}{result.errorCount > 0 ? `, ${result.errorCount} failed` : ''}
                </span>
              </div>
              <div className="text-xs text-gray-600 space-y-0.5 max-h-48 overflow-y-auto">
                {result.results.map((r, i) => (
                  <div key={i} className={clsx(r.status === 'error' && 'text-red-700', r.status === 'skipped' && 'text-amber-700')}>
                    [{r.type}] {r.employeeName || r.id}: {r.detail || r.message}
                  </div>
                ))}
              </div>
            </div>
          )}

          {error && (
            <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              <XCircle size={14} className="inline mr-1" />{error}
            </div>
          )}
        </div>
      </div>
    </Card>
  )
}

function HtmlToPdfMigrationCard() {
  const [previewed, setPreviewed] = useState(false)
  const [migrating, setMigrating] = useState(false)
  const [result, setResult] = useState<MigrationResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const previewQuery = useQuery({
    queryKey: ['migrate-html-preview'],
    queryFn: () => documentsApi.migrateHtmlPreview(),
    enabled: false,
  })

  const docs: MigrationDoc[] = (previewQuery.data as any)?.data?.data?.documents ?? []
  const total: number = (previewQuery.data as any)?.data?.data?.total ?? 0

  async function handlePreview() {
    setError(null)
    setResult(null)
    await previewQuery.refetch()
    setPreviewed(true)
  }

  async function handleMigrate() {
    if (!window.confirm(`Convert ${total} HTML document(s) to PDF?\n\nThis cannot be undone. No emails will be sent.`)) return
    setMigrating(true)
    setError(null)
    setResult(null)
    try {
      const res = await documentsApi.migrateHtmlToPdf()
      setResult((res as any).data?.data)
      previewQuery.refetch()
    } catch (e: any) {
      setError(e?.response?.data?.message || e?.message || 'Migration failed')
    } finally {
      setMigrating(false)
    }
  }

  const hasHtml = total > 0

  return (
    <Card>
      <div className="p-4 flex gap-4">
        <div className="mt-0.5 shrink-0 text-orange-500">
          <FileCode2 size={22} />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="font-semibold text-gray-800">Convert HTML Documents to PDF</p>
              <p className="text-sm text-gray-500 mt-0.5">
                Batch convert saved HTML increment letters to PDF. No emails sent.
              </p>
            </div>
            <div className="flex gap-2 shrink-0">
              <button
                onClick={handlePreview}
                disabled={previewQuery.isFetching}
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border border-gray-300 bg-white hover:bg-gray-50 text-gray-700 transition-colors disabled:opacity-50"
              >
                {previewQuery.isFetching
                  ? <Loader2 size={14} className="animate-spin" />
                  : <Eye size={14} />}
                Preview
              </button>
              {previewed && hasHtml && (
                <button
                  onClick={handleMigrate}
                  disabled={migrating}
                  className={clsx(
                    'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors',
                    migrating
                      ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                      : 'bg-orange-600 hover:bg-orange-700 text-white'
                  )}
                >
                  {migrating
                    ? <><Loader2 size={14} className="animate-spin" /> Converting...</>
                    : <><ArrowRightLeft size={14} /> Convert {total}</>}
                </button>
              )}
            </div>
          </div>

          {/* Preview results */}
          {previewed && !previewQuery.isFetching && (
            <div className={clsx(
              'mt-3 rounded-lg border p-3 text-sm space-y-2',
              hasHtml ? 'border-orange-200 bg-orange-50' : 'border-green-200 bg-green-50'
            )}>
              <div className="flex items-center gap-2">
                {hasHtml
                  ? <AlertCircle size={14} className="text-orange-600" />
                  : <CheckCircle size={14} className="text-green-600" />}
                <span className={clsx('font-medium', hasHtml ? 'text-orange-700' : 'text-green-700')}>
                  {hasHtml ? `${total} HTML document(s) found — ready to convert` : 'No HTML documents found'}
                </span>
              </div>

              {hasHtml && docs.length > 0 && (
                <div className="mt-2 overflow-x-auto">
                  <table className="w-full text-xs text-gray-700">
                    <thead>
                      <tr className="text-left text-gray-500 border-b border-orange-200">
                        <th className="pb-1 pr-3">Employee</th>
                        <th className="pb-1 pr-3">Type</th>
                        <th className="pb-1 pr-3">File</th>
                        <th className="pb-1">Date</th>
                      </tr>
                    </thead>
                    <tbody>
                      {docs.map(d => (
                        <tr key={d.id} className="border-b border-orange-100 last:border-0">
                          <td className="py-1 pr-3">{d.employeeName} <span className="text-gray-400">({d.employeeCode})</span></td>
                          <td className="py-1 pr-3">{d.documentType}</td>
                          <td className="py-1 pr-3 font-mono">{d.fileName}</td>
                          <td className="py-1">{format(new Date(d.createdAt), 'dd MMM yyyy')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* Migration result */}
          {result && (
            <div className={clsx(
              'mt-3 rounded-lg border p-3 text-sm space-y-2',
              result.failed === 0 ? 'border-green-200 bg-green-50' : 'border-amber-200 bg-amber-50'
            )}>
              <div className="flex items-center gap-2">
                {result.failed === 0
                  ? <CheckCircle size={14} className="text-green-600" />
                  : <AlertCircle size={14} className="text-amber-600" />}
                <span className={clsx('font-medium', result.failed === 0 ? 'text-green-700' : 'text-amber-700')}>
                  {result.failed === 0
                    ? `All ${result.success} document(s) converted successfully`
                    : `${result.success} converted, ${result.failed} failed`}
                </span>
              </div>
              {result.errors.length > 0 && (
                <div className="text-xs text-red-700 bg-red-100 rounded p-2 space-y-0.5">
                  {result.errors.map((e, i) => <div key={i}>{e}</div>)}
                </div>
              )}
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              <XCircle size={14} className="inline mr-1" />{error}
            </div>
          )}
        </div>
      </div>
    </Card>
  )
}
