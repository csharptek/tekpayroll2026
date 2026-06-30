import { FnfCalculation } from './fnfService'

const COMPANY_LEGAL = 'CLOUDGARNER SOLUTIONS PVT LTD'
const COMPANY_BRAND = 'CSharpTek'

function fmt(n: number): string {
  return new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)
}

function cleanName(raw: string): string {
  return (raw || '').split('|')[0].trim()
}

function fmtDate(d: Date | string): string {
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

export function generateFnfStatementHTML(calc: FnfCalculation, employee: any): string {
  const additions  = calc.breakdown.filter(b => b.type === 'addition')
  const deductions = calc.breakdown.filter(b => b.type === 'deduction')

  const rowHTML = (label: string, amount: number) =>
    `<tr><td>${label}</td><td style="text-align:right">₹ ${fmt(amount)}</td></tr>`

  const today = fmtDate(new Date())
  const netAbs = Math.abs(calc.netPayable)
  const netLabel = calc.isNegative ? 'Recoverable from Employee' : 'Net Payable to Employee'

  const cycleRows = (calc.cycles || []).map(c =>
    `<tr>
      <td>${c.cycleLabel}</td>
      <td style="text-align:right">${c.salaryDays}/${c.totalDays}</td>
      <td style="text-align:right">₹ ${fmt(c.grossMonthly)}</td>
      <td style="text-align:right">₹ ${fmt(c.proratedSalary)}</td>
      <td style="text-align:right">₹ ${fmt(c.pfAmount)}</td>
      <td style="text-align:right">₹ ${fmt(c.esiAmount)}</td>
      <td style="text-align:right">${Number(c.lopDays) > 0 ? `${c.lopDays}d / ₹${fmt(c.lopAmount)}` : '—'}</td>
    </tr>`
  ).join('')

  const hyiRows = (calc.hyiRecoveryDetail || []).map(r =>
    `<tr><td>${r.monthLabel}</td><td style="text-align:right">₹ ${fmt(r.amount)}</td></tr>`
  ).join('')

  const leaveRows = (calc.excessLeaveDetail || []).map(r =>
    `<tr>
      <td style="text-transform:capitalize">${r.leaveKind.toLowerCase()}</td>
      <td style="text-align:right">${r.annualEntitlement}</td>
      <td style="text-align:right">${r.proratedAllowed}</td>
      <td style="text-align:right">${r.usedDays}</td>
      <td style="text-align:right">${r.excessDays > 0 ? r.excessDays : '—'}</td>
      <td style="text-align:right">${r.excessAmount > 0 ? `₹ ${fmt(r.excessAmount)}` : '—'}</td>
    </tr>`
  ).join('')

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 11px; color: #1a1a1a; background: #fff; padding: 24px; }
    .header { display: flex; justify-content: space-between; align-items: flex-start; padding-bottom: 16px; border-bottom: 2px solid #1f4e79; margin-bottom: 16px; }
    .company-name { font-size: 20px; font-weight: 800; color: #1f4e79; letter-spacing: -0.3px; }
    .company-brand { font-size: 11px; color: #64748b; margin-top: 2px; font-weight: 600; }
    .doc-title { font-size: 12px; color: #555; margin-top: 4px; }
    .doc-meta { text-align: right; }
    .doc-meta .date { font-size: 11px; color: #475569; font-weight: 600; }
    .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 16px; }
    .info-box { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 10px 12px; }
    .info-box h4 { font-size: 9px; text-transform: uppercase; letter-spacing: 0.08em; color: #94a3b8; font-weight: 700; margin-bottom: 6px; }
    .info-row { display: flex; justify-content: space-between; padding: 2px 0; font-size: 10px; }
    .info-row .label { color: #64748b; }
    .info-row .value { font-weight: 600; color: #1e293b; }
    .salary-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 14px; }
    .salary-box h4 { font-size: 9px; text-transform: uppercase; letter-spacing: 0.08em; font-weight: 700; padding: 6px 10px; border-radius: 5px 5px 0 0; }
    .earnings-box h4 { background: #ecfdf5; color: #065f46; border: 1px solid #d1fae5; }
    .deductions-box h4 { background: #fef2f2; color: #991b1b; border: 1px solid #fee2e2; }
    table.salary-table { width: 100%; border-collapse: collapse; font-size: 10px; border: 1px solid #e2e8f0; border-top: none; }
    table.salary-table td { padding: 5px 10px; border-bottom: 1px solid #f1f5f9; }
    table.salary-table tr:last-child td { border-bottom: none; }
    .total-row td { font-weight: 700; background: #f8fafc; padding: 7px 10px; border-top: 1px solid #e2e8f0 !important; }
    .net-box { background: #1f4e79; color: #fff; border-radius: 8px; padding: 14px 20px; display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; }
    .net-box.negative { background: #991b1b; }
    .net-label { font-size: 12px; font-weight: 600; opacity: 0.9; }
    .net-amount { font-size: 24px; font-weight: 800; letter-spacing: -0.5px; }
    .section { margin: 14px 0; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden; }
    .section-title { background: #f8fafc; padding: 8px 14px; font-size: 11px; font-weight: 700; color: #475569; letter-spacing: .05em; text-transform: uppercase; border-bottom: 1px solid #e2e8f0; }
    table.detail-table { width: 100%; border-collapse: collapse; font-size: 9.5px; }
    table.detail-table th { text-align: right; padding: 6px 10px; color: #94a3b8; font-weight: 600; border-bottom: 1px solid #e2e8f0; }
    table.detail-table th:first-child { text-align: left; }
    table.detail-table td { padding: 5px 10px; border-bottom: 1px solid #f8fafc; }
    table.detail-table tfoot td { font-weight: 700; border-top: 1px solid #e2e8f0; }
    .footer { border-top: 1px solid #e2e8f0; padding-top: 10px; margin-top: 14px; display: flex; justify-content: space-between; font-size: 9px; color: #94a3b8; }
    .note { font-size: 9px; color: #94a3b8; padding: 8px 14px; }
    @media print { body { padding: 0; } }
  </style>
</head>
<body>

  <div class="header">
    <div>
      <div class="company-name">${COMPANY_LEGAL}</div>
      <div class="company-brand">(${COMPANY_BRAND})</div>
      <div class="doc-title">Full &amp; Final Settlement Statement</div>
    </div>
    <div class="doc-meta">
      <div class="date">Generated ${today}</div>
    </div>
  </div>

  <div class="info-grid">
    <div class="info-box">
      <h4>Employee Details</h4>
      <div class="info-row"><span class="label">Name</span><span class="value">${cleanName(employee.name)}</span></div>
      <div class="info-row"><span class="label">Employee ID</span><span class="value">${employee.employeeCode}</span></div>
      <div class="info-row"><span class="label">Designation</span><span class="value">${employee.jobTitle || '—'}</span></div>
      <div class="info-row"><span class="label">Department</span><span class="value">${employee.department || '—'}</span></div>
    </div>
    <div class="info-box">
      <h4>Separation Details</h4>
      <div class="info-row"><span class="label">Resignation Date</span><span class="value">${fmtDate(calc.resignationDate)}</span></div>
      <div class="info-row"><span class="label">Last Working Day</span><span class="value">${fmtDate(calc.lastWorkingDay)}</span></div>
      <div class="info-row"><span class="label">Notice Period</span><span class="value">${calc.noticePeriodDays} days</span></div>
      <div class="info-row"><span class="label">Months Covered</span><span class="value">${calc.noticePeriodMonths} month(s)</span></div>
    </div>
  </div>

  <p class="note" style="padding:0 0 10px 0;">
    Resignation month salary is paid via the normal monthly payroll, not this F&amp;F statement — earnings below cover only
    ${(calc.cycles || []).map(c => c.cycleLabel).join(', ')}.
  </p>

  <div class="salary-grid">
    <div class="salary-box earnings-box">
      <h4>Earnings</h4>
      <table class="salary-table">
        <tbody>${additions.map(r => rowHTML(r.label, r.amount)).join('')}</tbody>
        <tfoot><tr class="total-row"><td>Total Earnings</td><td style="text-align:right">₹ ${fmt(calc.totalAdditions)}</td></tr></tfoot>
      </table>
    </div>
    <div class="salary-box deductions-box">
      <h4>Deductions</h4>
      <table class="salary-table">
        <tbody>${deductions.length ? deductions.map(r => rowHTML(r.label, r.amount)).join('') : '<tr><td colspan="2">No deductions</td></tr>'}</tbody>
        <tfoot><tr class="total-row"><td>Total Deductions</td><td style="text-align:right">₹ ${fmt(calc.totalDeductions)}</td></tr></tfoot>
      </table>
    </div>
  </div>

  <div class="net-box ${calc.isNegative ? 'negative' : ''}">
    <div class="net-label">${netLabel}</div>
    <div class="net-amount">₹ ${fmt(netAbs)}</div>
  </div>

  ${cycleRows ? `
  <div class="section">
    <div class="section-title">Salary, PF, ESI &amp; LOP by Month</div>
    <table class="detail-table">
      <thead><tr><th>Month</th><th>Days</th><th>Gross</th><th>Prorated</th><th>PF</th><th>ESI</th><th>LOP</th></tr></thead>
      <tbody>${cycleRows}</tbody>
    </table>
  </div>` : ''}

  ${hyiRows ? `
  <div class="section">
    <div class="section-title">HYI Recovery by Month</div>
    <table class="detail-table">
      <thead><tr><th>Month</th><th>HYI Recovered</th></tr></thead>
      <tbody>${hyiRows}</tbody>
      <tfoot><tr><td>Total</td><td style="text-align:right">₹ ${fmt(calc.hyiRecovery)}</td></tr></tfoot>
    </table>
  </div>` : ''}

  ${leaveRows ? `
  <div class="section">
    <div class="section-title">Excess Leave Recovery</div>
    <table class="detail-table">
      <thead><tr><th>Leave</th><th>Annual</th><th>Allowed</th><th>Used</th><th>Excess</th><th>Amount</th></tr></thead>
      <tbody>${leaveRows}</tbody>
    </table>
    <p class="note">Allowed = Annual × months-elapsed (Jan → resignation month) ÷ 12. No encashment for unused leave.</p>
  </div>` : ''}

  <div class="footer">
    <span>This is a system-generated statement and does not require a physical signature.</span>
    <span>${COMPANY_BRAND} Payroll</span>
  </div>

</body>
</html>`
}
