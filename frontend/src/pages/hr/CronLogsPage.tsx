import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { format, formatDistanceStrict } from 'date-fns'
import { Clock, Play, CheckCircle, XCircle, AlertCircle, Loader2, RefreshCw } from 'lucide-react'
import { cronApi } from '../../services/api'
import { PageHeader, Card, Table, Th, Td, Tr, EmptyState, Skeleton } from '../../components/ui'
import clsx from 'clsx'
import toast from 'react-hot-toast'

const JOB_LABELS: Record<string, string> = {
  'run-payroll':        'Run Payroll',
  'generate-payslips':  'Generate Payslips',
  'sync-entra':         'Entra ID Sync',
  'holiday-greetings':  'Holiday Greetings',
  'rollover-reminder':  'Rollover Reminder',
  'lwd-reminder':       'LWD Reminder',
}

const JOB_NAMES = Object.keys(JOB_LABELS)

const STATUS_CONFIG: Record<string, { icon: any; className: string; label: string }> = {
  running: { icon: Loader2,       className: 'text-blue-600',   label: 'Running'  },
  success: { icon: CheckCircle,   className: 'text-green-600',  label: 'Success'  },
  partial: { icon: AlertCircle,   className: 'text-amber-600',  label: 'Partial'  },
  failed:  { icon: XCircle,       className: 'text-red-600',    label: 'Failed'   },
}

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.failed
  const Icon = cfg.icon
  return (
    <span className={clsx('flex items-center gap-1 text-sm font-medium', cfg.className)}>
      <Icon size={14} className={status === 'running' ? 'animate-spin' : ''} />
      {cfg.label}
    </span>
  )
}

function duration(log: any) {
  if (log.durationMs != null) {
    const s = Math.round(log.durationMs / 1000)
    return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`
  }
  if (!log.completedAt) return '—'
  return formatDistanceStrict(new Date(log.completedAt), new Date(log.startedAt))
}

export default function CronLogsPage() {
  const qc = useQueryClient()
  const [jobFilter, setJobFilter]       = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [page, setPage]                 = useState(1)
  const [expandedId, setExpandedId]     = useState<string | null>(null)

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['cron-logs', page, jobFilter, statusFilter],
    queryFn:  () => cronApi.logs({ page, limit: 50, ...(jobFilter && { jobName: jobFilter }), ...(statusFilter && { status: statusFilter }) }).then(r => r.data),
    refetchInterval: 15000,
  })

  const logs  = data?.logs  || []
  const total = data?.total || 0
  const pages = Math.ceil(total / 50)

  const trigger = useMutation({
    mutationFn: (job: string) => cronApi.triggerManual(job),
    onSuccess: (_d, job) => {
      toast.success(`${JOB_LABELS[job]} triggered`)
      qc.invalidateQueries({ queryKey: ['cron-logs'] })
    },
    onError: (_e, job) => toast.error(`Failed to trigger ${JOB_LABELS[job]}`),
  })

  return (
    <div className="space-y-5">
      <PageHeader
        title="Cron Jobs"
        subtitle="Scheduled jobs and execution logs"
        icon={Clock}
        action={
          <button onClick={() => refetch()} className="btn-secondary flex items-center gap-2">
            <RefreshCw size={14} /> Refresh
          </button>
        }
      />

      {/* Manual Trigger Cards */}
      <Card>
        <div className="p-4 border-b">
          <p className="text-sm font-medium text-gray-700">Manual Triggers</p>
          <p className="text-xs text-gray-500 mt-0.5">Run any job immediately</p>
        </div>
        <div className="p-4 grid grid-cols-2 md:grid-cols-3 gap-3">
          {JOB_NAMES.map(job => (
            <button
              key={job}
              onClick={() => trigger.mutate(job)}
              disabled={trigger.isPending && trigger.variables === job}
              className="flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-200 hover:border-blue-300 hover:bg-blue-50 text-sm text-gray-700 disabled:opacity-50 transition-colors"
            >
              {trigger.isPending && trigger.variables === job
                ? <Loader2 size={14} className="animate-spin text-blue-500" />
                : <Play size={14} className="text-blue-500" />
              }
              {JOB_LABELS[job]}
            </button>
          ))}
        </div>
      </Card>

      {/* Filters */}
      <div className="flex gap-3">
        <select
          value={jobFilter}
          onChange={e => { setJobFilter(e.target.value); setPage(1) }}
          className="input-field w-52"
        >
          <option value="">All Jobs</option>
          {JOB_NAMES.map(j => <option key={j} value={j}>{JOB_LABELS[j]}</option>)}
        </select>

        <select
          value={statusFilter}
          onChange={e => { setStatusFilter(e.target.value); setPage(1) }}
          className="input-field w-40"
        >
          <option value="">All Statuses</option>
          <option value="success">Success</option>
          <option value="partial">Partial</option>
          <option value="failed">Failed</option>
          <option value="running">Running</option>
        </select>

        <span className="ml-auto text-sm text-gray-500 self-center">{total} records</span>
      </div>

      {/* Logs Table */}
      <Card>
        {isLoading ? (
          <div className="p-4 space-y-3">{[...Array(8)].map((_, i) => <Skeleton key={i} className="h-10" />)}</div>
        ) : logs.length === 0 ? (
          <EmptyState icon={Clock} title="No logs found" />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Job</Th>
                <Th>Status</Th>
                <Th>Triggered By</Th>
                <Th>Started</Th>
                <Th>Duration</Th>
                <Th>Details</Th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log: any) => (
                <>
                  <Tr key={log.id}>
                    <Td className="font-medium text-gray-800">{JOB_LABELS[log.jobName] || log.jobName}</Td>
                    <Td><StatusBadge status={log.status} /></Td>
                    <Td>
                      <span className={clsx('badge', log.triggeredBy === 'manual' ? 'badge-purple' : 'badge-gray')}>
                        {log.triggeredBy === 'manual' ? 'Manual' : 'Cron'}
                      </span>
                    </Td>
                    <Td className="text-gray-600 text-sm">
                      {format(new Date(log.startedAt), 'dd MMM yyyy, hh:mm a')}
                    </Td>
                    <Td className="text-gray-600 text-sm">{duration(log)}</Td>
                    <Td>
                      <button
                        onClick={() => setExpandedId(expandedId === log.id ? null : log.id)}
                        className="text-xs text-blue-600 hover:underline"
                      >
                        {expandedId === log.id ? 'Hide' : 'View'}
                      </button>
                    </Td>
                  </Tr>
                  {expandedId === log.id && (
                    <tr key={`${log.id}-detail`} className="bg-gray-50">
                      <td colSpan={6} className="px-4 py-3 text-sm">
                        {log.message && (
                          <p className="text-gray-700 mb-1"><span className="font-medium">Message: </span>{log.message}</p>
                        )}
                        {log.meta && (
                          <div className="mb-1">
                            <span className="font-medium text-gray-700">Details: </span>
                            <span className="text-gray-600">
                              {Object.entries(log.meta)
                                .filter(([, v]) => v !== null && v !== undefined && !Array.isArray(v))
                                .map(([k, v]) => `${k}: ${v}`)
                                .join(' · ')}
                            </span>
                          </div>
                        )}
                        {log.errorMessage && (
                          <pre className="text-red-700 bg-red-50 rounded p-2 text-xs whitespace-pre-wrap mt-1">
                            {log.errorMessage}
                          </pre>
                        )}
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      {/* Pagination */}
      {pages > 1 && (
        <div className="flex justify-center gap-2">
          <button disabled={page === 1} onClick={() => setPage(p => p - 1)} className="btn-secondary">Prev</button>
          <span className="self-center text-sm text-gray-600">Page {page} of {pages}</span>
          <button disabled={page === pages} onClick={() => setPage(p => p + 1)} className="btn-secondary">Next</button>
        </div>
      )}
    </div>
  )
}
