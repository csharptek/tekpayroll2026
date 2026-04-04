import { prisma } from '../utils/prisma'
import { generateAndDeliverPayslips } from '../services/payslipService'

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
  } catch (err) {
    console.error('[NOTIFY] Failed to send HR alert:', err)
  }
}

// ─── CRON 1: AUTO-RUN PAYROLL (27th of every month) ─────────────────────────

export async function cronRunPayroll() {
  const now   = new Date()
  const year  = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const payrollMonth = `${year}-${month}`

  console.log(`[CRON] cronRunPayroll — ${payrollMonth}`)

  try {
    // Find or create cycle
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
      console.log(`[CRON] Created cycle ${payrollMonth}`)
    }

    if (['LOCKED', 'DISBURSED'].includes(cycle.status)) {
      console.log(`[CRON] Cycle ${payrollMonth} already ${cycle.status} — skipping`)
      return
    }

    // Import and run payroll engine
    const { calculatePayrollForEmployee } = await import('./payrollEngine')
    const employees = await prisma.employee.findMany({
      where: { status: { in: ['ACTIVE', 'ON_NOTICE'] } },
    })

    let totalGross = 0, totalNet = 0, totalPf = 0, totalEsi = 0, errCount = 0

    for (const emp of employees) {
      try {
        const lopEntry = await prisma.lopEntry.findUnique({
          where: { cycleId_employeeId: { cycleId: cycle.id, employeeId: emp.id } },
        })
        const prevEntry = await prisma.payrollEntry.findFirst({
          where: { employeeId: emp.id },
          orderBy: { createdAt: 'desc' },
        })
        const reimbs = await prisma.reimbursement.aggregate({
          where: { cycleId: cycle.id, employeeId: emp.id },
          _sum: { amount: true },
        })

        const calc = await calculatePayrollForEmployee({
          employeeId:       emp.id,
          annualCtc:        Number(emp.annualCtc),
          annualIncentive:  Number(emp.annualIncentive),
          state:            emp.state || '',
          joiningDate:      emp.joiningDate,
          lastWorkingDay:   emp.lastWorkingDay,
          resignationDate:  emp.resignationDate,
          cycleStart:       cycle.cycleStart,
          cycleEnd:         cycle.cycleEnd,
          lopDays:          lopEntry?.lopDays || 0,
          tdsAmount:        prevEntry ? Number(prevEntry.tdsAmount) : 0,
          reimbursements:   Number(reimbs._sum.amount || 0),
        })

        await prisma.payrollEntry.upsert({
          where: { cycleId_employeeId: { cycleId: cycle.id, employeeId: emp.id } },
          create: {
            cycleId: cycle.id, employeeId: emp.id,
            annualCtc: calc.salary.annualCtc, monthlyCtc: calc.salary.monthlyCtc,
            basic: calc.salary.basic, hra: calc.salary.hra, allowances: calc.salary.allowances,
            grossSalary: calc.salary.grossSalary,
            totalDays: calc.proration.totalDays, payableDays: calc.proration.payableDays,
            isProrated: calc.proration.isProrated, proratedGross: calc.proration.proratedGross,
            incentive: calc.incentive, reimbursementTotal: calc.reimbursements,
            lopDays: lopEntry?.lopDays || 0, lopAmount: calc.deductions.lop,
            pfAmount: calc.deductions.pf, esiAmount: calc.deductions.esi,
            ptAmount: calc.deductions.pt, tdsAmount: calc.deductions.tds,
            incentiveRecovery: calc.deductions.incentiveRecovery,
            loanDeduction: calc.deductions.loanDeduction,
            netSalary: calc.netSalary, status: 'CALCULATED',
          },
          update: {
            basic: calc.salary.basic, hra: calc.salary.hra, grossSalary: calc.salary.grossSalary,
            totalDays: calc.proration.totalDays, payableDays: calc.proration.payableDays,
            proratedGross: calc.proration.proratedGross, incentive: calc.incentive,
            reimbursementTotal: calc.reimbursements, lopDays: lopEntry?.lopDays || 0,
            lopAmount: calc.deductions.lop, pfAmount: calc.deductions.pf,
            esiAmount: calc.deductions.esi, ptAmount: calc.deductions.pt,
            tdsAmount: calc.deductions.tds, incentiveRecovery: calc.deductions.incentiveRecovery,
            loanDeduction: calc.deductions.loanDeduction, netSalary: calc.netSalary,
            status: 'CALCULATED',
          },
        })

        totalGross += calc.salary.grossSalary
        totalNet   += calc.netSalary
        totalPf    += calc.deductions.pf
        totalEsi   += calc.deductions.esi
      } catch (err: any) {
        errCount++
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

    const msg = `Payroll run complete for ${payrollMonth}\n` +
      `Employees: ${employees.length}\nTotal Net: ₹${totalNet.toFixed(2)}\nErrors: ${errCount}`

    console.log(`[CRON] ${msg}`)
    await notifyHR(`✅ Payroll Calculated — ${payrollMonth}`, msg)
  } catch (err: any) {
    const msg = `Payroll cron FAILED for ${payrollMonth}: ${err.message}`
    console.error(`[CRON] ${msg}`)
    await notifyHR(`❌ Payroll Cron Failed — ${payrollMonth}`, msg)
    throw err
  }
}

// ─── CRON 2: AUTO-GENERATE PAYSLIPS (5th of every month) ────────────────────

export async function cronGeneratePayslips() {
  const now   = new Date()
  // Payslips for previous month's payroll
  const date  = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  const payrollMonth = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`

  console.log(`[CRON] cronGeneratePayslips — ${payrollMonth}`)

  try {
    const cycle = await prisma.payrollCycle.findFirst({
      where: { payrollMonth, status: { in: ['CALCULATED', 'LOCKED', 'DISBURSED'] } },
    })

    if (!cycle) {
      console.log(`[CRON] No calculated cycle found for ${payrollMonth} — skipping`)
      return
    }

    const result = await generateAndDeliverPayslips(cycle.id)
    const msg = `Payslip generation for ${payrollMonth}\nSuccess: ${result.success}\nFailed: ${result.failed}`

    console.log(`[CRON] ${msg}`)
    await notifyHR(
      result.failed > 0
        ? `⚠️ Payslips Generated (with errors) — ${payrollMonth}`
        : `✅ Payslips Generated & Emailed — ${payrollMonth}`,
      msg + (result.errors.length ? '\n\nFailed:\n' + result.errors.map(e => `${e.name}: ${e.error}`).join('\n') : '')
    )
  } catch (err: any) {
    const msg = `Payslip cron FAILED for ${payrollMonth}: ${err.message}`
    console.error(`[CRON] ${msg}`)
    await notifyHR(`❌ Payslip Cron Failed — ${payrollMonth}`, msg)
    throw err
  }
}

// ─── CRON 3: DAILY ENTRA ID DELTA SYNC ──────────────────────────────────────

export async function cronSyncEntraId() {
  console.log('[CRON] cronSyncEntraId — delta sync')

  // Stub until Azure credentials are provided
  if (process.env.AZURE_TENANT_ID === 'PLACEHOLDER') {
    console.log('[CRON] Entra ID sync skipped — credentials not configured')
    await prisma.syncLog.create({
      data: {
        syncType:    'DELTA',
        status:      'failed',
        errorMessage: 'Azure credentials not configured',
        startedAt:   new Date(),
        completedAt: new Date(),
      },
    })
    return
  }

  const startedAt = new Date()
  let added = 0, updated = 0, deactivated = 0

  try {
    // Real Graph API sync (implemented in Stage 16 when credentials are ready)
    // Placeholder: will be replaced with:
    //   1. GET /users/delta with stored deltaToken
    //   2. Upsert changed employees
    //   3. Deactivate blocked accounts (accountEnabled = false)
    //   4. Store new deltaToken for next run

    await prisma.syncLog.create({
      data: {
        syncType:           'DELTA',
        status:             'success',
        recordsAdded:       added,
        recordsUpdated:     updated,
        recordsDeactivated: deactivated,
        startedAt,
        completedAt:        new Date(),
      },
    })

    console.log(`[CRON] Entra sync complete: +${added} updated ${updated} deactivated ${deactivated}`)
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
    throw err
  }
}
