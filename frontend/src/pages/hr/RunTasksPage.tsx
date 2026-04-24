import { useState, useEffect, useRef } from 'react'
import { useMutation } from '@tanstack/react-query'
import { format } from 'date-fns'
import {
  Play, Loader2, CheckCircle, XCircle, AlertCircle,
  CreditCard, FileText, RefreshCw, CalendarDays, Terminal, Database, Package
} from 'lucide-react'
import { cronApi } from '../../services/api'
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
]

const COLOR_MAP: Record<string, string> = {
  blue:   'border-blue-200 bg-blue-50 text-blue-700',
  purple: 'border-purple-200 bg-purple-50 text-purple-700',
  green:  'border-green-200 bg-green-50 text-green-700',
  amber:  'border-amber-200 bg-amber-50 text-amber-700',
  teal:   'border-teal-200 bg-teal-50 text-teal-700',
  indigo: 'border-indigo-200 bg-indigo-50 text-indigo-700',
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
    const DIRECT = ['migrate-salary-snapshots', 'seed-asset-categories']
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
    </div>
  )
}
