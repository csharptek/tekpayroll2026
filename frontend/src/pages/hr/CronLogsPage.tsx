import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { format, formatDistanceToNow } from 'date-fns'
import { Clock, Play, CheckCircle2, XCircle, AlertTriangle, Loader2, ChevronDown, ChevronRight } from 'lucide-react'
import { cronApi } from '../../services/api'
import { PageHeader, Card, Table, Th, Td, Tr, EmptyState, Skeleton } from '../../components/ui'
import clsx from 'clsx'


const JOB_LABELS: Record<string, string> = {
  'run-payroll':        'Run Payroll',
  'generate-payslips':  'Generate Payslips',
  'sync-entra':         'Entra ID Sync',
  'holiday-greetings':  'Holiday Greetings',
  'rollover-reminder':  'Leave Rollover Reminder',
  'lwd-reminder':       'LWD Reminder',
}

const JOB_SCHEDULES: Record<string, string> = {
  'run-payroll':        '27th of every month, 9:00 AM IST',
  'generate-payslips':  '5th of every month, 8:00 AM IST',
  'sync-entra':         'Daily at 2:00 AM IST',
  'holiday-greetings':  'Daily at 8:00 AM IST',
  'rollover-reminder':  'Daily at 9:00 AM IST (fires only Dec 25)',
  'lwd-reminder':       'Daily at 7:00 AM IST',
}

const STATUS_CONFIG = {
  success: { label: 'Success',  icon: CheckCircle2,  cls: 'text-green-600', badge: 'badge-green'  },
  failed:  { label: 'Failed',   icon: XCircle,       cls: 'text-red-600',   badge: 'badge-red'    },
  partial: { label: 'Partial',  icon: AlertTriangle, cls: 'text-yellow-600',badge: 'badge-yellow' },
  running: { label: 'Running',  icon: Loader2,       cls: 'text-blue-600',  badge: 'badge-blue'   },
}

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status as keyof typeof STATUS_CONFIG]
  if (!cfg) return <span className="badge badge-gray">{status}</span>
  const Icon = cfg.icon
  return (
    <span className={clsx('badge', cfg.badge, 'inline-flex items-center gap-1')}>
      <Icon size={12} className={status === 'running' ? 'animate-spin' : ''} />
      {cfg.label}
    </span>
  )
}

function LogRow({ log }: { log: any }) {
  const [expanded, setExpanded] = useState(false)
  const hasMeta  = log.meta && Object.keys(log.meta).length > 0 && !log.meta.skipped
  const hasError = !!log.errorMessage
  const hasDetail = !!log.message || hasMeta || hasError

  return (
    <>
      <Tr>
        <Td>
          <button
            onClick={() => setExpanded(e => !e)}
            disabled={!hasDetail}
            className="flex items-center gap-1 text-gray-400 hover:text-gray-700 disabled:cursor-default"
          >
            {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
        </Td>
        <Td>
          <span className="font-medium text-gray-800">{JOB_LABELS[log.jobName] || log.jobName}</span>
        </Td>
        <Td><StatusBadge status={log.status} /></Td>
        <Td>
          <span className={clsx('badge', log.triggeredBy === 'manual' ? 'badge-purple' : 'badge-gray')}>
            {log.triggeredBy === 'manual' ? 'Manual' : 'Scheduled'}
          </span>
        </Td>
        <Td>
          <span className="text-sm text-gray-700">{format(new Date(log.startedAt), 'dd MMM yyyy, hh:mm:ss a')}</span>
          <span className="block text-xs text-gray-400">{formatDistanceToNow(new Date(log.startedAt), { addSuffix: true })}</span>
        </Td>
        <Td>
          {log.durationMs != null
            ? <span className="text-sm text-gray-600">{log.durationMs < 1000 ? `${log.durationMs}ms` : `${(log.durationMs / 1000).toFixed(1)}s`}</span>
            : <span className="text-gray-400">—</span>}
        </Td>
      </Tr>
      {expanded && (
        <tr className="bg-gray-50">
          <td colSpan={6} className="px-6 py-3 text-sm space-y-2">
            {log.message && (
              <div><span className="font-medium text-gray-700">Message: </span><span className="text-gray-600">{log.message}</span></div>
            )}
            {hasMeta && (
              <div>
                <span className="font-medium text-gray-700">Details: </span>
                <pre className="text-gray-600 text-xs mt-1 whitespace-pre-wrap">{JSON.stringify(log.meta, null, 2)}</pre>
              </div>
            )}
            {hasError && (
              <div>
                <span className="font-medium text-red-600">Error: </span>
                <pre className="text-red-500 text-xs mt-1 whitespace-pre-wrap">{log.errorMessage}</pre>
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  )
}

const JOBS = Object.keys(JOB_LABELS)

export default function CronLogsPage() {
  const qc = useQueryClient()
  const [jobName, setJobName]     = useState('')
  const [status, setStatus]       = useState('')
  const [page, setPage]           = useState(1)
  const [runningJob, setRunningJob] = useState<string | null>(null)
  const [feedback, setFeedback]     = useState<{ job: string; ok: boolean } | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['cron-logs', jobName, status, page],
    queryFn: () => cronApi.logs({ jobName: jobName || undefined, status: status || undefined, page, limit: 50 }).then(r => r.data),
    refetchInterval: 10_000,
  })

  const logs  = data?.logs  || []
  const total = data?.total || 0
  const totalPages = Math.ceil(total / 50)

  const trigger = useMutation({
    mutationFn: (job: string) => cronApi.triggerManual(job),
    onMutate:  (job) => setRunningJob(job),
    onSuccess: (_, job) => {
      setFeedback({ job, ok: true })
      setTimeout(() => setFeedback(null), 4000)
      qc.invalidateQueries({ queryKey: ['cron-logs'] })
      setRunningJob(null)
    },
    onError: (_, job) => {
      setFeedback({ job, ok: false })
      setTimeout(() => setFeedback(null), 4000)
      setRunningJob(null)
    },
  })

  return (
    <div className="space-y-5">
      <PageHeader title="Cron Jobs" subtitle="Scheduled jobs and manual triggers" />

      {feedback && (
        <div className={clsx('rounded-lg px-4 py-3 text-sm font-medium', feedback.ok ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700')}>
          {feedback.ok ? `✓ ${JOB_LABELS[feedback.job]} triggered successfully` : `✗ ${JOB_LABELS[feedback.job]} failed to trigger`}
        </div>
      )}

      {/* Manual Trigger Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {JOBS.map(job => (
          <Card key={job} className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <p className="font-medium text-gray-800 text-sm">{JOB_LABELS[job]}</p>
                <p className="text-xs text-gray-400 mt-0.5">{JOB_SCHEDULES[job]}</p>
              </div>
              <button
                onClick={() => trigger.mutate(job)}
                disabled={!!runningJob}
                className={clsx('btn btn-sm btn-secondary flex items-center gap-1.5 shrink-0', runningJob === job && 'opacity-75 cursor-not-allowed')}
              >
                {runningJob === job ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
                {runningJob === job ? 'Running…' : 'Run Now'}
              </button>
            </div>
          </Card>
        ))}
      </div>

      {/* Logs Table */}
      <Card>
        <div className="p-4 flex flex-wrap gap-3 border-b border-gray-100">
          <select value={jobName} onChange={e => { setJobName(e.target.value); setPage(1) }} className="input w-52">
            <option value="">All Jobs</option>
            {JOBS.map(j => <option key={j} value={j}>{JOB_LABELS[j]}</option>)}
          </select>
          <select value={status} onChange={e => { setStatus(e.target.value); setPage(1) }} className="input w-40">
            <option value="">All Statuses</option>
            <option value="success">Success</option>
            <option value="failed">Failed</option>
            <option value="partial">Partial</option>
            <option value="running">Running</option>
          </select>
          <span className="ml-auto text-sm text-gray-500 self-center">{total} records</span>
        </div>

        {isLoading ? (
          <div className="p-4 space-y-2">{[...Array(8)].map((_, i) => <Skeleton key={i} className="h-10" />)}</div>
        ) : logs.length === 0 ? (
          <EmptyState icon={Clock} title="No logs yet" description="Logs appear after jobs run" />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th style={{ width: 32 }} />
                <Th>Job</Th>
                <Th>Status</Th>
                <Th>Triggered By</Th>
                <Th>Started At</Th>
                <Th>Duration</Th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log: any) => <LogRow key={log.id} log={log} />)}
            </tbody>
          </Table>
        )}

        {totalPages > 1 && (
          <div className="p-4 flex items-center justify-between border-t border-gray-100">
            <button disabled={page === 1} onClick={() => setPage(p => p - 1)} className="btn btn-secondary btn-sm">Previous</button>
            <span className="text-sm text-gray-500">Page {page} of {totalPages}</span>
            <button disabled={page >= totalPages} onClick={() => setPage(p => p + 1)} className="btn btn-secondary btn-sm">Next</button>
          </div>
        )}
      </Card>
    </div>
  )
}
