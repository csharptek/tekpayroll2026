// ─── PAYROLL PRE-RUN CHECK (read-only) ───────────────────────────────────────
// Shows who the manual run and the auto run (cron, 27th) would pick, who is
// excluded and why, and data problems to fix before payroll runs.
// Writes nothing.

import { prisma } from '../utils/prisma'
import { getPayrollEligibleEmployees } from './payrollEligibility'
import { getSalaryInputForDate } from './payrollEngine'

export type Severity = 'error' | 'warning' | 'info'

export interface PrecheckIssue { severity: Severity; message: string }

export interface PrecheckPick {
  id:            string
  name:          string
  employeeCode:  string
  department:    string | null
  status:        string
  isTrainee:     boolean
  estGross:      number | null
  inManual:      boolean
  inAuto:        boolean
  skipReason:    string | null
  issues:        PrecheckIssue[]
}

export interface PrecheckExcluded {
  id:           string
  name:         string
  employeeCode: string
  status:       string
  reason:       string
}

export interface PrecheckResult {
  payrollMonth: string
  cycle: { exists: boolean; status: string | null; cycleStart: string; cycleEnd: string }
  picks:    PrecheckPick[]
  excluded: PrecheckExcluded[]
  counts: {
    manual: number
    auto: number
    autoOnly: number
    excluded: number
    errors: number
    warnings: number
    estGrossManual: number
  }
}

const d10 = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString().slice(0, 10) : '')
const clean = (n: string) => String(n || '').split('|')[0].trim()

export function defaultPrecheckMonth(now = new Date()): string {
  // Cycle runs 26th → 25th; on/after the 28th, look at next month's payroll
  const d = new Date(now.getFullYear(), now.getMonth() + (now.getDate() >= 28 ? 1 : 0), 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export async function buildPayrollPrecheck(payrollMonth: string): Promise<PrecheckResult> {
  if (!/^\d{4}-\d{2}$/.test(payrollMonth)) throw new Error('Invalid month (YYYY-MM)')
  const [y, m] = payrollMonth.split('-').map(n => parseInt(n))

  const cycle = await prisma.payrollCycle.findFirst({ where: { payrollMonth } })
  // Same dates the cron uses when it creates a cycle
  const cycleStart = cycle?.cycleStart ?? new Date(y, m - 2, 26)
  const cycleEnd   = cycle?.cycleEnd   ?? new Date(y, m - 1, 25)
  const endOfDay   = new Date(cycleEnd); endOfDay.setHours(23, 59, 59, 999)

  const [eligible, skips] = await Promise.all([
    getPayrollEligibleEmployees(cycleStart),
    prisma.payrollSkip.findMany({ where: { payrollMonth }, select: { employeeId: true, reason: true } }),
  ])
  const skipMap  = new Map(skips.map(s => [s.employeeId, s.reason || 'Skipped']))
  const respectCfg = await prisma.systemConfig.findUnique({ where: { key: 'AUTO_RUN_RESPECT_SKIPS' } })
  const autoRespectsSkips = (respectCfg?.value ?? 'true') !== 'false'
  const eligIds  = eligible.map(e => e.id)

  const [details, pendingLeaves, pendingReimbs, revisions] = await Promise.all([
    prisma.employee.findMany({
      where: { id: { in: eligIds } },
      select: {
        id: true, uanNumber: true, esiNumber: true, panNumber: true,
        bankDetail:   { select: { accountNumber: true, ifscCode: true } },
        bankAccounts: { select: { accountNumber: true, ifscCode: true } },
        governmentId: { select: { uanNumber: true, esicNumber: true, panNumber: true } },
      },
    }),
    prisma.leaveApplication.findMany({
      where: { employeeId: { in: eligIds }, status: 'PENDING', fromDate: { lte: endOfDay }, toDate: { gte: cycleStart } },
      select: { employeeId: true },
    }),
    prisma.reimbursement.findMany({
      where: { employeeId: { in: eligIds }, status: 'PENDING' },
      select: { employeeId: true },
    }),
    prisma.salaryRevision.findMany({
      where: { employeeId: { in: eligIds }, effectiveFrom: { gte: cycleStart, lte: endOfDay } },
      select: { employeeId: true, effectiveFrom: true },
      orderBy: { effectiveFrom: 'desc' },
    }),
  ])
  const detailMap = new Map(details.map(d => [d.id, d as any]))
  const countBy = (rows: { employeeId: string }[]) => {
    const mp = new Map<string, number>()
    rows.forEach(r => mp.set(r.employeeId, (mp.get(r.employeeId) || 0) + 1))
    return mp
  }
  const leaveCnt = countBy(pendingLeaves)
  const reimbCnt = countBy(pendingReimbs)
  const revMap   = new Map<string, Date>()
  revisions.forEach(r => { if (!revMap.has(r.employeeId)) revMap.set(r.employeeId, r.effectiveFrom) })

  const picks: PrecheckPick[] = []
  for (const e of eligible as any[]) {
    const issues: PrecheckIssue[] = []
    const det = detailMap.get(e.id) || {}
    const skipReason = skipMap.get(e.id) || null

    // Salary setup
    let estGross: number | null = null
    let esiApplies = false
    if (e.isTrainee) {
      estGross = Number(e.stipendMonthly || 0) || null
      if (!estGross) issues.push({ severity: 'error', message: 'Trainee stipend not set' })
    } else {
      try {
        const input: any = await getSalaryInputForDate(e.id, cycleStart)
        if (!input?.annualCtc || Number(input.annualCtc) <= 0) {
          issues.push({ severity: 'error', message: 'No salary set up — run will fail for this employee' })
        } else {
          estGross   = input.prebuiltSalary ? Number(input.prebuiltSalary.grandTotalMonthly) : null
          esiApplies = Boolean(input.prebuiltSalary && Number(input.prebuiltSalary.employeeEsiMonthly) > 0)
          if (!input.prebuiltSalary) issues.push({ severity: 'warning', message: 'No salary snapshot — run Migrate Salary Snapshots' })
        }
      } catch (err: any) {
        issues.push({ severity: 'error', message: `Salary error: ${err?.message || 'unknown'}` })
      }
    }

    if (e.joiningDate && new Date(e.joiningDate) > endOfDay) {
      issues.push({ severity: 'error', message: `Joins ${d10(e.joiningDate)} — after cycle end` })
    } else if (e.joiningDate && new Date(e.joiningDate) >= new Date(cycleStart)) {
      issues.push({ severity: 'info', message: `New joiner (${d10(e.joiningDate)}) — prorated` })
    }
    if (e.lastWorkingDay && new Date(e.lastWorkingDay) <= endOfDay) {
      issues.push({ severity: 'info', message: `Last working day ${d10(e.lastWorkingDay)} — prorated` })
    }
    if (e.status === 'ON_NOTICE' && !skipReason) {
      issues.push({ severity: 'info', message: 'On notice — paid monthly (no skip set)' })
    }

    const hasBank = (det.bankAccounts || []).some((b: any) => b.accountNumber && b.ifscCode)
      || (det.bankDetail?.accountNumber && det.bankDetail?.ifscCode)
    const gid = det.governmentId || {}
    const uan = String(gid.uanNumber || det.uanNumber || '').trim()
    const pan = String(gid.panNumber || det.panNumber || '').trim()
    const esic = String(gid.esicNumber || det.esiNumber || '').trim()
    if (!hasBank) issues.push({ severity: 'warning', message: 'Bank details missing' })
    if (!e.isTrainee) {
      if (!uan) issues.push({ severity: 'warning', message: 'UAN missing' })
      if (!pan) issues.push({ severity: 'warning', message: 'PAN missing' })
      if (esiApplies && !esic) issues.push({ severity: 'warning', message: 'ESIC number missing' })
    }
    const lc = leaveCnt.get(e.id); if (lc) issues.push({ severity: 'warning', message: `${lc} pending leave request(s) in cycle` })
    const rc = reimbCnt.get(e.id); if (rc) issues.push({ severity: 'warning', message: `${rc} pending reimbursement(s)` })
    const rv = revMap.get(e.id);   if (rv) issues.push({ severity: 'info', message: `Salary revision effective ${d10(rv)}` })

    if (skipReason) {
      issues.unshift(autoRespectsSkips
        ? { severity: 'info',    message: `Skipped (${skipReason}) — not paid` }
        : { severity: 'warning', message: `Skipped (${skipReason}) — manual run excludes, auto run (27th) still pays` })
    }

    picks.push({
      id: e.id, name: clean(e.name), employeeCode: e.employeeCode, department: e.department,
      status: e.status, isTrainee: Boolean(e.isTrainee), estGross,
      inManual: !skipReason, inAuto: autoRespectsSkips ? !skipReason : true, skipReason, issues,
    })
  }

  // Excluded: active/on-notice not eligible + anyone leaving within the cycle
  const others = await prisma.employee.findMany({
    where: {
      id: { notIn: eligIds },
      OR: [
        { status: { in: ['ACTIVE', 'ON_NOTICE'] } },
        { lastWorkingDay: { gte: cycleStart, lte: endOfDay } },
      ],
    },
    select: {
      id: true, name: true, employeeCode: true, status: true, lastWorkingDay: true, pfZeroWage: true,
      excludeFromPayroll: true, excludeFromPayrollReason: true,
      fnfWizardSession: { select: { status: true } },
      fnfSettlement:    { select: { status: true } },
    },
    orderBy: { name: 'asc' },
  })
  const excluded: PrecheckExcluded[] = others.map((o: any) => {
    let reason = `Status ${o.status}`
    if (o.excludeFromPayroll) reason = `Excluded from payroll${o.excludeFromPayrollReason ? ` — ${o.excludeFromPayrollReason}` : ''}`
    else if (o.pfZeroWage) reason = 'Unpaid leave — PF reported with 0 wages'
    else if (o.fnfWizardSession?.status === 'COMPLETED' || ['APPROVED', 'SETTLED'].includes(o.fnfSettlement?.status)) reason = 'Final settlement done'
    else if (o.lastWorkingDay && new Date(o.lastWorkingDay) < new Date(cycleStart)) reason = `Left before cycle (${d10(o.lastWorkingDay)})`
    else if (!['ACTIVE', 'ON_NOTICE'].includes(o.status) && o.lastWorkingDay) reason = `${o.status} — left ${d10(o.lastWorkingDay)} (salary via F&F)`
    return { id: o.id, name: clean(o.name), employeeCode: o.employeeCode, status: o.status, reason }
  })

  const sevCount = (s: Severity) => picks.reduce((n, p) => n + (p.inManual ? p.issues.filter(i => i.severity === s).length : 0), 0)
  picks.sort((a, b) =>
    Number(b.issues.some(i => i.severity === 'error')) - Number(a.issues.some(i => i.severity === 'error')) ||
    Number(!b.inManual) - Number(!a.inManual) ||
    a.name.localeCompare(b.name))

  return {
    payrollMonth,
    cycle: { exists: !!cycle, status: cycle?.status ?? null, cycleStart: d10(cycleStart), cycleEnd: d10(cycleEnd) },
    picks,
    excluded,
    counts: {
      manual:   picks.filter(p => p.inManual).length,
      auto:     picks.filter(p => p.inAuto).length,
      autoOnly: picks.filter(p => p.inAuto && !p.inManual).length,
      excluded: excluded.length,
      errors:   sevCount('error'),
      warnings: sevCount('warning'),
      estGrossManual: Math.round(picks.filter(p => p.inManual).reduce((s, p) => s + (p.estGross || 0), 0)),
    },
  }
}

// ─── Email ───────────────────────────────────────────────────────────────────

const esc = (s: string) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export function precheckEmailHtml(r: PrecheckResult, appUrl: string): string {
  const inr = (n: number) => '₹' + Math.round(n).toLocaleString('en-IN')
  const row = (cells: string[]) => `<tr>${cells.map(c => `<td style="padding:4px 8px;border-bottom:1px solid #eee;font-size:12px">${c}</td>`).join('')}</tr>`
  const table = (head: string[], rows: string[]) => rows.length
    ? `<table style="border-collapse:collapse;width:100%;margin:6px 0 16px">${row(head.map(h => `<b>${h}</b>`))}${rows.join('')}</table>`
    : '<p style="font-size:12px;color:#888">None</p>'

  const errRows  = r.picks.filter(p => p.inManual).flatMap(p => p.issues.filter(i => i.severity === 'error').map(i => row([esc(p.name), esc(p.employeeCode), esc(i.message)])))
  const autoOnly = r.picks.filter(p => !p.inManual).map(p => row([esc(p.name), esc(p.employeeCode), esc(p.skipReason || '')]))
  const warnRows = r.picks.filter(p => p.inManual).flatMap(p => p.issues.filter(i => i.severity === 'warning').map(i => row([esc(p.name), esc(p.employeeCode), esc(i.message)])))
  const infoRows = r.picks.filter(p => p.inManual).flatMap(p => p.issues.filter(i => i.severity === 'info').map(i => row([esc(p.name), esc(p.employeeCode), esc(i.message)])))
  const exclRows = r.excluded.map(x => row([esc(x.name), esc(x.employeeCode), esc(x.reason)]))

  return `<div style="font-family:Segoe UI,Arial,sans-serif;max-width:760px">
  <h2 style="margin:0 0 4px">Payroll pre-run check — ${r.payrollMonth}</h2>
  <p style="font-size:12px;color:#666;margin:0 0 12px">Cycle ${r.cycle.cycleStart} → ${r.cycle.cycleEnd} · ${r.cycle.exists ? `Status ${r.cycle.status}` : 'Cycle not created yet'} · Auto run on the 27th</p>
  <p style="font-size:13px">
    <b>Manual run pays:</b> ${r.counts.manual} · <b>Auto run pays:</b> ${r.counts.auto} · <b>Excluded:</b> ${r.counts.excluded}<br/>
    <b>Errors:</b> ${r.counts.errors} · <b>Warnings:</b> ${r.counts.warnings} · <b>Est. gross:</b> ${inr(r.counts.estGrossManual)}
  </p>
  <h3 style="color:#b91c1c;font-size:14px">Errors — fix before run</h3>${table(['Employee', 'Code', 'Issue'], errRows)}
  <h3 style="color:#b45309;font-size:14px">Skipped — auto run (27th) would still pay</h3>${table(['Employee', 'Code', 'Skip reason'], autoOnly)}
  <h3 style="color:#b45309;font-size:14px">Warnings</h3>${table(['Employee', 'Code', 'Issue'], warnRows)}
  <h3 style="color:#1d4ed8;font-size:14px">For info</h3>${table(['Employee', 'Code', 'Note'], infoRows)}
  <h3 style="color:#475569;font-size:14px">Excluded</h3>${table(['Employee', 'Code', 'Reason'], exclRows)}
  <p style="font-size:12px"><a href="${appUrl}/hr/payroll/pre-check?month=${r.payrollMonth}">Open pre-run check</a></p>
</div>`
}

export async function sendPayrollPrecheckEmail(payrollMonth: string): Promise<{ sentTo: string[]; result: PrecheckResult }> {
  const result = await buildPayrollPrecheck(payrollMonth)
  const admins = await prisma.employee.findMany({
    where: { role: 'SUPER_ADMIN', status: { in: ['ACTIVE', 'ON_NOTICE'] } },
    select: { email: true },
  })
  const to = admins.map(a => a.email).filter(e => e && !e.includes('+trainee@'))
  if (!to.length) return { sentTo: [], result }
  const appUrl = (process.env.FRONTEND_URL || 'https://tekpayroll2026.vercel.app').replace(/\/$/, '')
  const { sendEmailWithCc } = await import('./emailService')
  const subject = `${result.counts.errors ? '⚠️ ' : ''}Payroll pre-run check — ${payrollMonth} (${result.counts.manual} to pay, ${result.counts.errors} errors)`
  await sendEmailWithCc(to, [], subject, precheckEmailHtml(result, appUrl))
  return { sentTo: to, result }
}
