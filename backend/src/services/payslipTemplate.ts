import { PayrollEntry, Employee, PayrollCycle, BankDetail } from '@prisma/client'

const COMPANY_LEGAL = 'CLOUDGARNER SOLUTIONS PVT LTD'
const COMPANY_BRAND = 'CSharpTek'

type FullEntry = PayrollEntry & {
  employee: Employee & { bankDetail: BankDetail | null }
  cycle: PayrollCycle
} & { [key: string]: any }

export type PayslipYtd = {
  basic: number
  gross: number      // gross/CTC disbursed
  net: number
  employeePf: number
  employerPf: number
  esi: number
  tds: number
  pt: number
  lop: number
  months: number     // count of months included
}

function fmt(n: number): string {
  return new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)
}

// First name only — strips "Ravi Kumar | Software Engineer | Csharptek" → "Ravi Kumar"
function cleanName(raw: string): string {
  return (raw || '').split('|')[0].trim()
}

// "2026-04" → { mmYyyy: "04-2026", monthLabel: "April 2026" }
function parseMonth(payrollMonth: string): { mmYyyy: string; monthLabel: string } {
  const [yStr, mStr] = payrollMonth.split('-')
  const y = Number(yStr), m = Number(mStr)
  const monthName = new Date(y, m - 1, 1).toLocaleDateString('en-IN', { month: 'long' })
  return { mmYyyy: `${mStr}-${yStr}`, monthLabel: `${monthName} ${y}` }
}

// Mon–Fri count in the given payroll month (display only)
function weekdaysInMonth(payrollMonth: string): number {
  const [yStr, mStr] = payrollMonth.split('-')
  const y = Number(yStr), m = Number(mStr)
  const days = new Date(y, m, 0).getDate()
  let count = 0
  for (let d = 1; d <= days; d++) {
    const dow = new Date(y, m - 1, d).getDay()
    if (dow !== 0 && dow !== 6) count++
  }
  return count
}

export function generatePayslipHTML(entry: FullEntry, leaveBalance?: {
  sick?:    { total: number; used: number; remaining: number }
  casual?:  { total: number; used: number; remaining: number }
  planned?: { total: number; used: number; remaining: number; carryForward: number }
}, reimbLines?: { label: string; amount: number }[], ytd?: PayslipYtd): string {
  const emp    = entry.employee
  const cycle  = entry.cycle
  const bank   = emp.bankDetail

  const basic     = Number(entry.basic)
  const hra       = Number(entry.hra)
  const transport = Number((entry as any).transport || 0)
  const fbp       = Number((entry as any).fbp || 0)
  const hyi       = Number((entry as any).hyi || 0)
  const gross     = Number((entry as any).proratedGross)
  const incentive = Number(entry.incentive)
  const reimb     = Number(entry.reimbursementTotal)
  const pf        = Number(entry.pfAmount)
  const employerPf= Number((entry as any).employerPfAmount || 0)
  const esi       = Number(entry.esiAmount)
  const employerEsi = Number((entry as any).employerEsiAmount || 0)
  const pt        = Number(entry.ptAmount)
  const tds       = Number(entry.tdsAmount)
  const lop       = Number(entry.lopAmount)
  const loan      = Number(entry.loanDeduction)
  const incRec    = Number(entry.incentiveRecovery)
  const net       = Number(entry.netSalary)

  const ratio = entry.isProrated && Number(entry.totalDays) > 0
    ? Number(entry.payableDays) / Number(entry.totalDays)
    : 1
  const r2 = (n: number) => Math.round(n * 100) / 100

  const basicProrated     = r2(basic     * ratio)
  const hraProrated       = r2(hra       * ratio)
  const transportProrated = r2(transport * ratio)
  const fbpProrated       = r2(fbp       * ratio)
  const hyiProrated       = r2(hyi       * ratio)

  const totalEarnings   = gross + incentive + reimb
  const totalDeductions = pf + esi + pt + tds + lop + loan + incRec

  const today = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
  const { mmYyyy, monthLabel } = parseMonth(cycle.payrollMonth)
  const weekdays = weekdaysInMonth(cycle.payrollMonth)

  const isTrainee = Boolean((emp as any).isTrainee)
  const proratedLabel = entry.isProrated ? ` (${entry.payableDays}/${entry.totalDays} days)` : ''

  const earningsRows = isTrainee
    ? [
        { label: `Stipend${proratedLabel}`, amount: gross },
        ...(reimbLines && reimbLines.length
          ? reimbLines.map(l => ({ label: l.label, amount: l.amount }))
          : (reimb > 0 ? [{ label: 'Reimbursements', amount: reimb }] : [])),
      ]
    : [
        { label: `Basic Salary${proratedLabel}`, amount: basicProrated },
        { label: `HRA${proratedLabel}`,          amount: hraProrated },
        ...(transportProrated > 0 ? [{ label: 'Transportation', amount: transportProrated }] : []),
        ...(fbpProrated       > 0 ? [{ label: 'FBP',            amount: fbpProrated       }] : []),
        ...(hyiProrated       > 0 ? [{ label: 'HYI / Special Allowance', amount: hyiProrated }] : []),
        ...(incentive         > 0 ? [{ label: 'Monthly Incentive',       amount: incentive  }] : []),
        ...(reimbLines && reimbLines.length
          ? reimbLines.map(l => ({ label: l.label, amount: l.amount }))
          : (reimb > 0 ? [{ label: 'Reimbursements', amount: reimb }] : [])),
      ]

  const deductionRows = [
    { label: 'Provident Fund — Employee', amount: pf },
    ...(esi  > 0 ? [{ label: 'ESI — Employee',           amount: esi  }] : []),
    ...(pt   > 0 ? [{ label: 'Professional Tax',         amount: pt   }] : []),
    ...(tds  > 0 ? [{ label: 'TDS',                      amount: tds  }] : []),
    ...(lop  > 0 ? [{ label: `Loss of Pay (${Number(entry.lopDays)} days)`, amount: lop }] : []),
    ...(loan > 0 ? [{ label: 'Loan EMI Deduction',       amount: loan }] : []),
    ...(incRec > 0 ? [{ label: 'Incentive Recovery',     amount: incRec }] : []),
  ]

  // Employer contributions (not deducted from employee — shown for transparency)
  const employerRows = [
    ...(employerPf  > 0 ? [{ label: 'Provident Fund — Employer', amount: employerPf  }] : []),
    ...(employerEsi > 0 ? [{ label: 'ESI — Employer',            amount: employerEsi }] : []),
  ]

  const rowHTML = (label: string, amount: number) =>
    `<tr><td>${label}</td><td style="text-align:right">₹ ${fmt(amount)}</td></tr>`

  const ytdRow = (label: string, amount: number) =>
    `<tr><td style="padding:6px 14px;color:#334155;">${label}</td><td style="padding:6px 14px;text-align:right;font-weight:600;color:#1e293b;">₹ ${fmt(amount)}</td></tr>`

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
    .payslip-title { font-size: 12px; color: #555; margin-top: 4px; }
    .payslip-meta { text-align: right; }
    .payslip-meta .period { font-size: 16px; color: #1f4e79; font-weight: 800; }
    .payslip-meta .month { font-size: 11px; color: #475569; font-weight: 600; margin-top: 2px; }
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
    .employer-box h4 { background: #eff6ff; color: #1e40af; border: 1px solid #dbeafe; }
    table.salary-table { width: 100%; border-collapse: collapse; font-size: 10px; border: 1px solid #e2e8f0; border-top: none; }
    table.salary-table td { padding: 5px 10px; border-bottom: 1px solid #f1f5f9; }
    table.salary-table tr:last-child td { border-bottom: none; }
    .total-row td { font-weight: 700; background: #f8fafc; padding: 7px 10px; border-top: 1px solid #e2e8f0 !important; }
    .net-box { background: #1f4e79; color: #fff; border-radius: 8px; padding: 14px 20px; display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; }
    .net-label { font-size: 12px; font-weight: 600; opacity: 0.9; }
    .net-amount { font-size: 24px; font-weight: 800; letter-spacing: -0.5px; }
    .net-words { font-size: 9px; opacity: 0.7; margin-top: 2px; }
    .bank-box { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 10px 12px; margin-bottom: 14px; display: flex; gap: 20px; font-size: 10px; }
    .bank-item .bl { color: #94a3b8; }
    .bank-item .bv { font-weight: 600; margin-top: 1px; }
    .section { margin: 14px 0; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden; }
    .section-title { background: #f8fafc; padding: 8px 14px; font-size: 11px; font-weight: 700; color: #475569; letter-spacing: .05em; text-transform: uppercase; border-bottom: 1px solid #e2e8f0; }
    .footer { border-top: 1px solid #e2e8f0; padding-top: 10px; margin-top: 14px; display: flex; justify-content: space-between; font-size: 9px; color: #94a3b8; }
    @media print { body { padding: 0; } }
  </style>
</head>
<body>

  <!-- Header -->
  <div class="header">
    <div>
      <div class="company-name">${COMPANY_LEGAL}</div>
      <div class="company-brand">(${COMPANY_BRAND})</div>
      <div class="payslip-title">Salary Slip</div>
    </div>
    <div class="payslip-meta">
      <div class="period">${mmYyyy}</div>
      <div class="month">${monthLabel} Salary</div>
    </div>
  </div>

  <!-- Employee & Employment Info -->
  <div class="info-grid">
    <div class="info-box">
      <h4>Employee Details</h4>
      <div class="info-row"><span class="label">Name</span><span class="value">${cleanName(emp.name)}</span></div>
      <div class="info-row"><span class="label">Employee ID</span><span class="value">${emp.employeeCode}</span></div>
      <div class="info-row"><span class="label">Designation</span><span class="value">${emp.jobTitle || '—'}</span></div>
      <div class="info-row"><span class="label">Department</span><span class="value">${emp.department || '—'}</span></div>
      <div class="info-row"><span class="label">PAN</span><span class="value">${emp.panNumber || '—'}</span></div>
      <div class="info-row"><span class="label">PF Number</span><span class="value">${emp.pfNumber || '—'}</span></div>
    </div>
    <div class="info-box">
      <h4>Payroll Details</h4>
      <div class="info-row"><span class="label">Pay Period</span><span class="value">${mmYyyy} (${monthLabel})</span></div>
      <div class="info-row"><span class="label">Working Days (Mon–Fri)</span><span class="value">${weekdays}</span></div>
      <div class="info-row"><span class="label">Payable Days</span><span class="value">${entry.payableDays} / ${entry.totalDays}</span></div>
      <div class="info-row"><span class="label">LOP Days</span><span class="value">${Number(entry.lopDays)}</span></div>
      <div class="info-row"><span class="label">Joining Date</span><span class="value">${new Date(emp.joiningDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</span></div>
    </div>
  </div>

  <!-- Salary Breakdown -->
  <div class="salary-grid">
    <div class="salary-box earnings-box">
      <h4>Earnings</h4>
      <table class="salary-table">
        <tbody>${earningsRows.map(r => rowHTML(r.label, r.amount)).join('')}</tbody>
        <tfoot><tr class="total-row"><td>Total Earnings</td><td style="text-align:right">₹ ${fmt(totalEarnings)}</td></tr></tfoot>
      </table>
    </div>
    <div class="salary-box deductions-box">
      <h4>Deductions</h4>
      <table class="salary-table">
        <tbody>${deductionRows.map(r => rowHTML(r.label, r.amount)).join('')}</tbody>
        <tfoot><tr class="total-row"><td>Total Deductions</td><td style="text-align:right">₹ ${fmt(totalDeductions)}</td></tr></tfoot>
      </table>
    </div>
  </div>

  ${employerRows.length ? `
  <div class="salary-box employer-box" style="margin-bottom:14px;">
    <h4>Employer Contributions (not deducted)</h4>
    <table class="salary-table">
      <tbody>${employerRows.map(r => rowHTML(r.label, r.amount)).join('')}</tbody>
    </table>
  </div>` : ''}

  <!-- Net salary -->
  <div class="net-box">
    <div>
      <div class="net-label">Net Salary Payable</div>
      <div class="net-words">Earnings ₹${fmt(totalEarnings)} − Deductions ₹${fmt(totalDeductions)}</div>
    </div>
    <div class="net-amount">₹ ${fmt(net)}</div>
  </div>

  <!-- Bank Details -->
  ${bank ? `
  <div class="bank-box">
    <div class="bank-item"><div class="bl">Bank Name</div><div class="bv">${bank.bankName}</div></div>
    <div class="bank-item"><div class="bl">Account Number</div><div class="bv">${'•'.repeat(8)}${bank.accountNumber.slice(-4)}</div></div>
    <div class="bank-item"><div class="bl">IFSC Code</div><div class="bv">${bank.ifscCode}</div></div>
    <div class="bank-item"><div class="bl">Account Name</div><div class="bv">${bank.accountName}</div></div>
  </div>` : ''}

  <!-- Leave Balance -->
  ${leaveBalance ? `
  <div class="section">
    <div class="section-title">Leave Balance — ${new Date().getFullYear()}</div>
    <table style="width:100%;border-collapse:collapse;font-size:11px;">
      <thead><tr style="background:#f1f5f9;">
        <th style="padding:6px 14px;text-align:left;color:#64748b;font-weight:600;">Type</th>
        <th style="padding:6px 14px;text-align:center;color:#64748b;font-weight:600;">Allocated</th>
        <th style="padding:6px 14px;text-align:center;color:#64748b;font-weight:600;">Used</th>
        <th style="padding:6px 14px;text-align:center;color:#64748b;font-weight:600;">Remaining</th>
      </tr></thead>
      <tbody>
        ${leaveBalance.sick ? `<tr style="border-top:1px solid #f1f5f9;">
          <td style="padding:6px 14px;color:#334155;">Sick Leave</td>
          <td style="padding:6px 14px;text-align:center;color:#334155;">${leaveBalance.sick.total}</td>
          <td style="padding:6px 14px;text-align:center;color:#ef4444;">${leaveBalance.sick.used}</td>
          <td style="padding:6px 14px;text-align:center;font-weight:600;color:#16a34a;">${leaveBalance.sick.remaining}</td>
        </tr>` : ''}
        ${leaveBalance.casual ? `<tr style="border-top:1px solid #f1f5f9;">
          <td style="padding:6px 14px;color:#334155;">Casual Leave</td>
          <td style="padding:6px 14px;text-align:center;color:#334155;">${leaveBalance.casual.total}</td>
          <td style="padding:6px 14px;text-align:center;color:#ef4444;">${leaveBalance.casual.used}</td>
          <td style="padding:6px 14px;text-align:center;font-weight:600;color:#16a34a;">${leaveBalance.casual.remaining}</td>
        </tr>` : ''}
        ${leaveBalance.planned ? `<tr style="border-top:1px solid #f1f5f9;">
          <td style="padding:6px 14px;color:#334155;">Planned Leave ${leaveBalance.planned.carryForward > 0 ? `<span style="color:#7c3aed;font-size:10px;">(+${leaveBalance.planned.carryForward} C/F)</span>` : ''}</td>
          <td style="padding:6px 14px;text-align:center;color:#334155;">${leaveBalance.planned.total}</td>
          <td style="padding:6px 14px;text-align:center;color:#ef4444;">${leaveBalance.planned.used}</td>
          <td style="padding:6px 14px;text-align:center;font-weight:600;color:#16a34a;">${leaveBalance.planned.remaining}</td>
        </tr>` : ''}
      </tbody>
    </table>
  </div>` : ''}

  <!-- Year to Date (Financial Year) -->
  ${ytd ? `
  <div class="section">
    <div class="section-title">Year to Date — FY ${(() => { const [y,m]=cycle.payrollMonth.split('-').map(Number); const fy = m>=4?y:y-1; return `${fy}–${(fy+1).toString().slice(-2)}` })()} (${ytd.months} ${ytd.months === 1 ? 'month' : 'months'})</div>
    <table style="width:100%;border-collapse:collapse;font-size:10px;">
      <tbody>
        ${ytdRow('Basic Disbursed (YTD)', ytd.basic)}
        ${ytdRow('Gross / CTC Disbursed (YTD)', ytd.gross)}
        ${ytdRow('Net Disbursed (YTD)', ytd.net)}
        ${ytdRow('Provident Fund — Employee (YTD)', ytd.employeePf)}
        ${ytd.employerPf > 0 ? ytdRow('Provident Fund — Employer (YTD)', ytd.employerPf) : ''}
        ${ytd.esi > 0 ? ytdRow('ESI — Employee (YTD)', ytd.esi) : ''}
        ${ytd.pt  > 0 ? ytdRow('Professional Tax (YTD)', ytd.pt) : ''}
        ${ytdRow('TDS Deducted (YTD)', ytd.tds)}
        ${ytd.lop > 0 ? ytdRow('Loss of Pay (YTD)', ytd.lop) : ''}
      </tbody>
    </table>
  </div>` : ''}

  <!-- Footer -->
  <div class="footer">
    <span>This is a computer-generated payslip and does not require a signature. · Generated on ${today}</span>
    <span>${COMPANY_LEGAL} (${COMPANY_BRAND})</span>
  </div>

</body>
</html>`
}
