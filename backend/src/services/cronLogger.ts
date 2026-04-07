import { prisma } from '../utils/prisma'

export type CronJobName =
  | 'run-payroll'
  | 'generate-payslips'
  | 'sync-entra'
  | 'holiday-greetings'
  | 'rollover-reminder'
  | 'lwd-reminder'

export async function startCronLog(jobName: CronJobName, triggeredBy: 'cron' | 'manual' = 'cron') {
  return prisma.cronLog.create({
    data: { jobName, triggeredBy, status: 'running', startedAt: new Date() },
  })
}

export async function completeCronLog(
  id: string,
  status: 'success' | 'failed' | 'partial',
  startedAt: Date,
  opts?: { message?: string; errorMessage?: string; meta?: object }
) {
  const completedAt = new Date()
  return prisma.cronLog.update({
    where: { id },
    data: {
      status,
      completedAt,
      durationMs: completedAt.getTime() - startedAt.getTime(),
      message: opts?.message,
      errorMessage: opts?.errorMessage,
      meta: opts?.meta as any,
    },
  })
}
