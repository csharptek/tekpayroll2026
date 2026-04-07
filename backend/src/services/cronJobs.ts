import { prisma } from '../utils/prisma'
import { generateAndDeliverPayslips } from '../services/payslipService'
import { startCronLog, completeCronLog } from './cronLogger'
import { getSalaryInputForDate } from './payrollEngine'

// ─── HELPER ──────────────────────────────────────────────────────────────────

async function notifyHR(subject: string, body: string) {
  if (process.env.RESEND_API_KEY === 'PLACEHOLDER') {
    console.log(`[NOTIFY] ${subject}\n${body}`)
    return
  }
  try {
    const { Resend } = await import('resend')
    const resend = new Resend(process.env.RESEND_API_KEY)
    await resend.emails.send({
      from: process.env.EMAIL_FROM || 'payroll@csharptek.com',
      to:   process.env.HR_ALERT_EMAIL || process.env.EMAIL_FROM || 'payroll@csharptek.com',
      subject,
      html: `<pre style="font-family:monospace">${body}</pre>`,
    })
  } catch (err: any) {
    console.error('[NOTIFY] Failed to send HR alert:', err)
  }
}

// ─── CRON 1: AUTO-RUN PAYROLL (27th of every month) ─────────────────────────

export async function cronRunPayroll(triggeredBy: 'cron' | 'manual' = 'cron') {
  const now   = new Date()
  const year  = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const payrollMonth = `${year}-${month}`

  console.log(`[CRON] cronRunPayroll — ${payrollMonth}`)

  const log = await startCronLog('run-payroll', triggeredBy)

  try {
    let cycle = await prisma.payrollCycle.findFirst({ where: { payrollMonth } })

    if (!cycle) {
      const cycleStart = new Date(year, now.getMonth() - 1, 26)
      const cycleEnd   = new Date(year, now.getMonth(),     25)
      cycle = await prisma.payrollCycle.create({
        data: {
          payrollMonth,
          cycleStart,
          cycleEnd,
          payrollDate: new Date(year, now.getMonth(), 27),
          payslipDate: new Date(year, now.getMonth() + 1, 5),
          salaryDate:  new Date(year, now.getMonth() + 1, 0),
          status: 'DRAFT',
        },
      })
    }

    if (['LOCKED', 'DISBURSED'].includes(cycle.status)) {
      await completeCronLog(log.id, 'success', log.startedAt, {
        message: `Cycle ${payrollMonth} already ${cycle.status} — skipped`,
        meta: { skipped: true, status: cycle.status },
      })
      return
    }

    const { calculatePayrollForEmployee } = await import('./payrollEngine')
    const employees = await prisma.employee.findMany({
      where: { status: { in: ['ACTIVE', 'ON_NOTICE'] } },
    })

    let totalGross = 0, totalNet = 0, totalPf = 0, totalEsi = 0, errCount = 0
    const errors: string[] = []

    for (const emp of employees) {
      try {
        const lopEntry = await prisma.lopEntry.findUnique({
          where: { cycleId_employeeId: { cycleId: cycle.id, employeeId: emp.id } },
        })
        const reimbs = await prisma.reimbursement.aggregate({
          where: { cycleId: cycle.id, employeeId: emp.id },
          _sum: { amount: true },
        })

        const revisionInput = await getSalaryInputForDate(emp.id, cycle.cycleStart)

        const salaryInput = revisionInput
        const calc = await calculatePayrollForEmployee({
          employeeId:      emp.id,
          salaryInput,
          state:           emp.state || '',
          joiningDate:     emp.joiningDate,
          lastWorkingDay:  emp.lastWorkingDay,
          resignationDate: emp.resignationDate,
          cycleStart:      cycle.cycleStart,
          cycleEnd:        cycle.cycleEnd,
          payrollMonth:    cycle.payrollMonth,
          lopDays:         lopEntry?.lopDays || 0,
          tdsMonthly:      revisionInput.tdsMonthly,
          employeeStatus:  emp.status,
          reimbursements:  Number(reimbs._sum.amount || 0),
        })

        await prisma.payrollEntry.upsert({
          where: { cycleId_employeeId: { cycleId: cycle.id, employeeId: emp.id } },
          create: {
            cycleId: cycle.id, employeeId: emp.id,
            annualCtc: calc.salary.annualCtc, monthlyCtc: calc.salary.grandTotalMonthly,
            basic: calc.salary.basicMonthly, hra: calc.salary.hraMonthly,
            transport: calc.salary.transportMonthly, fbp: calc.salary.fbpMonthly,
            hyi: calc.salary.hyiMonthly,
            grossSalary: calc.salary.grandTotalMonthly,
            totalDays: calc.proration.totalDays, payableDays: calc.proration.payableDays,
            isProrated: calc.proration.isProrated, proratedGross: calc.proration.proratedGross,
            incentive: 0, reimbursementTotal: calc.reimbursements,
            lopDays: lopEntry?.lopDays || 0, lopAmount: calc.deductions.lop,
            pfAmount: calc.deductions.pf, esiAmount: calc.deductions.esi,
            ptAmount: calc.deductions.pt, tdsAmount: calc.deductions.tds,
            incentiveRecovery: calc.deductions.incentiveRecovery,
            loanDeduction: calc.deductions.loanDeduction,
            netSalary: calc.netSalary, status: 'CALCULATED',
          },
          update: {
            basic: calc.salary.basicMonthly, hra: calc.salary.hraMonthly,
            transport: calc.salary.transportMonthly, fbp: calc.salary.fbpMonthly,
            hyi: calc.salary.hyiMonthly, grossSalary: calc.salary.grandTotalMonthly,
            totalDays: calc.proration.totalDays, payableDays: calc.proration.payableDays,
            proratedGross: calc.proration.proratedGross, incentive: 0,
            reimbursementTotal: calc.reimbursements, lopDays: lopEntry?.lopDays || 0,
            lopAmount: calc.deductions.lop, pfAmount: calc.deductions.pf,
            esiAmount: calc.deductions.esi, ptAmount: calc.deductions.pt,
            tdsAmount: calc.deductions.tds, incentiveRecovery: calc.deductions.incentiveRecovery,
            loanDeduction: calc.deductions.loanDeduction, netSalary: calc.netSalary,
            status: 'CALCULATED',
          },
        })

        totalGross += calc.salary.grandTotalMonthly
        totalNet   += calc.netSalary
        totalPf    += calc.deductions.pf
        totalEsi   += calc.deductions.esi
      } catch (err: any) {
        errCount++
        errors.push(`${emp.name}: ${err.message}`)
        console.error(`[CRON] Failed for ${emp.name}:`, err.message)
      }
    }

    await prisma.payrollCycle.update({
      where: { id: cycle.id },
      data: {
        status: 'CALCULATED', runAt: new Date(), runBy: 'cron',
        totalGross, totalNet, totalPf, totalEsi,
        employeeCount: employees.length,
      },
    })

    const status = errCount > 0 ? 'partial' : 'success'
    const msg = `Payroll run complete for ${payrollMonth}. Employees: ${employees.length}, Total Net: ₹${totalNet.toFixed(2)}, Errors: ${errCount}`

    await completeCronLog(log.id, status, log.startedAt, {
      message: msg,
      errorMessage: errors.length ? errors.join('\n') : undefined,
      meta: { payrollMonth, employees: employees.length, totalGross, totalNet, totalPf, totalEsi, errors: errCount },
    })

    console.log(`[CRON] ${msg}`)
    await notifyHR(
      errCount > 0 ? `⚠️ Payroll Calculated (with errors) — ${payrollMonth}` : `✅ Payroll Calculated — ${payrollMonth}`,
      msg
    )
  } catch (err: any) {
    const msg = `Payroll cron FAILED for ${payrollMonth}: ${err.message}`
    await completeCronLog(log.id, 'failed', log.startedAt, { errorMessage: msg })
    console.error(`[CRON] ${msg}`)
    await notifyHR(`❌ Payroll Cron Failed — ${payrollMonth}`, msg)
    throw err
  }
}

// ─── CRON 2: AUTO-GENERATE PAYSLIPS (5th of every month) ────────────────────

export async function cronGeneratePayslips(triggeredBy: 'cron' | 'manual' = 'cron') {
  const now   = new Date()
  const date  = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  const payrollMonth = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`

  console.log(`[CRON] cronGeneratePayslips — ${payrollMonth}`)

  const log = await startCronLog('generate-payslips', triggeredBy)

  try {
    const cycle = await prisma.payrollCycle.findFirst({
      where: { payrollMonth, status: { in: ['CALCULATED', 'LOCKED', 'DISBURSED'] } },
    })

    if (!cycle) {
      await completeCronLog(log.id, 'success', log.startedAt, {
        message: `No calculated cycle found for ${payrollMonth} — skipped`,
        meta: { payrollMonth, skipped: true },
      })
      return
    }

    const result = await generateAndDeliverPayslips(cycle.id)
    const status = result.failed > 0 ? 'partial' : 'success'
    const msg = `Payslip generation for ${payrollMonth}. Success: ${result.success}, Failed: ${result.failed}`

    await completeCronLog(log.id, status, log.startedAt, {
      message: msg,
      errorMessage: result.errors.length ? result.errors.map((e: any) => `${e.name}: ${e.error}`).join('\n') : undefined,
      meta: { payrollMonth, success: result.success, failed: result.failed },
    })

    console.log(`[CRON] ${msg}`)
    await notifyHR(
      result.failed > 0 ? `⚠️ Payslips Generated (with errors) — ${payrollMonth}` : `✅ Payslips Generated & Emailed — ${payrollMonth}`,
      msg
    )
  } catch (err: any) {
    const msg = `Payslip cron FAILED for ${payrollMonth}: ${err.message}`
    await completeCronLog(log.id, 'failed', log.startedAt, { errorMessage: msg })
    console.error(`[CRON] ${msg}`)
    await notifyHR(`❌ Payslip Cron Failed — ${payrollMonth}`, msg)
    throw err
  }
}

// ─── CRON 3: DAILY ENTRA ID DELTA SYNC ──────────────────────────────────────

export async function cronSyncEntraId(triggeredBy: 'cron' | 'manual' = 'cron') {
  console.log('[CRON] cronSyncEntraId — delta sync')

  const log = await startCronLog('sync-entra', triggeredBy)
  const startedAt = new Date()

  try {
    const { syncEntraUsers } = await import('./graphSyncService')
    const result = await syncEntraUsers()

    await prisma.syncLog.create({
      data: {
        syncType:           'DELTA',
        status:             result.errors.length > 0 ? 'partial' : 'success',
        recordsAdded:       result.added,
        recordsUpdated:     result.updated,
        recordsDeactivated: result.deactivated,
        recordsSkipped:     result.skipped,
        startedAt,
        completedAt:        new Date(),
      },
    })

    const msg = `Entra sync complete. Added: ${result.added}, Updated: ${result.updated}, Deactivated: ${result.deactivated}, Skipped: ${result.skipped}`

    await completeCronLog(log.id, result.errors.length > 0 ? 'partial' : 'success', log.startedAt, {
      message: msg,
      errorMessage: result.errors.length ? result.errors.join('\n') : undefined,
      meta: { added: result.added, updated: result.updated, deactivated: result.deactivated, skipped: result.skipped },
    })

    console.log(`[CRON] ${msg}`)
  } catch (err: any) {
    await prisma.syncLog.create({
      data: {
        syncType:     'DELTA',
        status:       'failed',
        errorMessage: err.message,
        startedAt,
        completedAt:  new Date(),
      },
    })
    await completeCronLog(log.id, 'failed', log.startedAt, { errorMessage: err.message })
    throw err
  }
}

// ─── CRON 4: PUBLIC HOLIDAY GREETING EMAILS ──────────────────────────────────

export async function cronSendHolidayGreetings(triggeredBy: 'cron' | 'manual' = 'cron') {
  const log = await startCronLog('holiday-greetings', triggeredBy)

  try {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const tomorrow = new Date(today)
    tomorrow.setDate(tomorrow.getDate() + 1)

    const holiday = await prisma.publicHoliday.findFirst({
      where: { date: { gte: today, lt: tomorrow }, greetingSent: false },
    })

    if (!holiday) {
      await completeCronLog(log.id, 'success', log.startedAt, {
        message: 'No holiday today — skipped',
        meta: { skipped: true },
      })
      return
    }

    const employees = await prisma.employee.findMany({
      where: { status: 'ACTIVE' },
      select: { name: true, email: true },
    })

    const { Resend } = await import('resend')
    const resend = new Resend(process.env.RESEND_API_KEY)
    const message = holiday.greetingMessage || `Wishing you a wonderful ${holiday.name}!`
    let sent = 0, failed = 0
    const errors: string[] = []

    for (const emp of employees) {
      try {
        await resend.emails.send({
          from:    'TEKONE <noreply@csharptek.com>',
          to:      emp.email,
          subject: `🎉 ${holiday.name} — Holiday Greetings`,
          html:    `<p>Dear ${emp.name},</p><p>${message}</p><p>Enjoy your holiday!</p><p>— CSharpTek HR Team</p>`,
        })
        sent++
      } catch (err: any) {
        failed++
        errors.push(`${emp.email}: ${err.message}`)
      }
    }

    await prisma.publicHoliday.update({ where: { id: holiday.id }, data: { greetingSent: true } })

    await completeCronLog(log.id, failed > 0 ? 'partial' : 'success', log.startedAt, {
      message: `Holiday greetings for ${holiday.name}. Sent: ${sent}, Failed: ${failed}`,
      errorMessage: errors.length ? errors.join('\n') : undefined,
      meta: { holiday: holiday.name, sent, failed },
    })

    console.log(`[CRON] Holiday greetings sent for ${holiday.name} to ${employees.length} employees`)
  } catch (err: any) {
    await completeCronLog(log.id, 'failed', log.startedAt, { errorMessage: err.message })
    throw err
  }
}

// ─── CRON 5: LEAVE ROLLOVER REMINDER (Dec 25) ────────────────────────────────

export async function cronLeaveRolloverReminder(triggeredBy: 'cron' | 'manual' = 'cron') {
  const log = await startCronLog('rollover-reminder', triggeredBy)

  try {
    const today = new Date()

    if (today.getMonth() !== 11 || today.getDate() !== 25) {
      await completeCronLog(log.id, 'success', log.startedAt, {
        message: 'Not Dec 25 — skipped',
        meta: { skipped: true },
      })
      return
    }

    const { Resend } = await import('resend')
    const resend = new Resend(process.env.RESEND_API_KEY)

    const hrUsers = await prisma.employee.findMany({
      where: { role: { in: ['HR', 'SUPER_ADMIN'] }, status: 'ACTIVE' },
      select: { name: true, email: true },
    })

    const year = today.getFullYear()
    let sent = 0, failed = 0
    const errors: string[] = []

    for (const hr of hrUsers) {
      try {
        await resend.emails.send({
          from:    'TEKONE <noreply@csharptek.com>',
          to:      hr.email,
          subject: `⚠️ Leave Rollover Reminder — Window opens Dec 28`,
          html:    `<p>Dear ${hr.name},</p>
            <p>This is a reminder that the <strong>Leave Year-End Rollover</strong> window for ${year} opens on <strong>December 28</strong> and closes on <strong>January 5, ${year + 1}</strong>.</p>
            <p>Please log in to TEKONE and trigger the rollover before the window closes.</p>
            <p>— TEKONE System</p>`,
        })
        sent++
      } catch (err: any) {
        failed++
        errors.push(`${hr.email}: ${err.message}`)
      }
    }

    await completeCronLog(log.id, failed > 0 ? 'partial' : 'success', log.startedAt, {
      message: `Rollover reminder sent to ${sent} HR/admin users`,
      errorMessage: errors.length ? errors.join('\n') : undefined,
      meta: { sent, failed },
    })

    console.log(`[CRON] Rollover reminder sent to ${hrUsers.length} HR/admin users`)
  } catch (err: any) {
    await completeCronLog(log.id, 'failed', log.startedAt, { errorMessage: err.message })
    throw err
  }
}

// ─── CRON 6: LWD REMINDER (Daily) ────────────────────────────────────────────

export async function cronLwdReminder(triggeredBy: 'cron' | 'manual' = 'cron') {
  const log = await startCronLog('lwd-reminder', triggeredBy)

  try {
    const today = new Date(); today.setHours(0, 0, 0, 0)
    const in7   = new Date(today); in7.setDate(in7.getDate() + 7)
    const in8   = new Date(today); in8.setDate(in8.getDate() + 8)

    const employees = await prisma.employee.findMany({
      where: {
        status: 'ON_NOTICE',
        OR: [
          { lastWorkingDay: { gte: in7, lt: in8 } },
          { expectedLwd:    { gte: in7, lt: in8 } },
        ],
      },
    })

    if (!employees.length) {
      await completeCronLog(log.id, 'success', log.startedAt, {
        message: 'No employees with LWD in 7 days — skipped',
        meta: { skipped: true, count: 0 },
      })
      return
    }

    const { sendLwdReminderToHR } = await import('./emailService')
    const hrUsers = await prisma.employee.findMany({
      where: { role: { in: ['HR', 'SUPER_ADMIN'] }, status: 'ACTIVE' },
      select: { email: true },
    })
    const hrEmails = hrUsers.map(h => h.email)

    for (const emp of employees) {
      const lwd = emp.lastWorkingDay || emp.expectedLwd!
      const lwdDate = new Date(lwd); lwdDate.setHours(0, 0, 0, 0)
      const daysRemaining = Math.round((lwdDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
      const lwdStr = lwd.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
      await sendLwdReminderToHR(hrEmails, emp.name, emp.employeeCode, lwdStr, daysRemaining)
    }

    await completeCronLog(log.id, 'success', log.startedAt, {
      message: `LWD reminders sent for ${employees.length} employees`,
      meta: { count: employees.length, employees: employees.map(e => e.name) },
    })

    console.log(`[CRON] LWD reminders sent for ${employees.length} employees`)
  } catch (err: any) {
    await completeCronLog(log.id, 'failed', log.startedAt, { errorMessage: err.message })
    throw err
  }
}
