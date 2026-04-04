import { PayrollEntry, Employee, PayrollCycle, BankDetail } from '@prisma/client'

type FullEntry = PayrollEntry & {
  employee: Employee & { bankDetail: BankDetail | null }
  cycle: PayrollCycle
} & { [key: string]: any }

function fmt(n: number): string {
  return new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)
}

export function generatePayslipHTML(entry: FullEntry): string {
  const emp    = entry.employee
  const cycle  = entry.cycle
  const bank   = emp.bankDetail

  const monthly   = Number(entry.monthlyCtc)
  const basic     = Number(entry.basic)
  const hra       = Number(entry.hra)
  const transport  = Number((entry as any).transport || 0)
  const fbp       = Number((entry as any).fbp || 0)
  const hyi       = Number((entry as any).hyi || 0)
  const gross     = Number((entry as any).proratedGross)
  const incentive = Number(entry.incentive)
  const reimb     = Number(entry.reimbursementTotal)
  const pf        = Number(entry.pfAmount)
  const esi       = Number(entry.esiAmount)
  const pt        = Number(entry.ptAmount)
  const tds       = Number(entry.tdsAmount)
  const lop       = Number(entry.lopAmount)
  const loan      = Number(entry.loanDeduction)
  const incRec    = Number(entry.incentiveRecovery)
  const net       = Number(entry.netSalary)

  const totalEarnings  = gross + incentive + reimb
  const totalDeductions = pf + esi + pt + tds + lop + loan + incRec

  const today = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })

  const earningsRows = [
    { label: `Basic Salary${entry.isProrated ? ` (${entry.payableDays}/${entry.totalDays} days)` : ''}`, amount: gross },
    { label: 'Transportation', amount: transport },
    { label: 'FBP', amount: fbp },
    { label: 'HYI / Special Allowance', amount: hyi },
    ...(incentive > 0 ? [{ label: 'Monthly Incentive', amount: incentive }] : []),
    ...(reimb > 0     ? [{ label: 'Reimbursements',    amount: reimb     }] : []),
  ]

  const deductionRows = [
    { label: 'Provident Fund (PF)', amount: pf },
    ...(esi  > 0 ? [{ label: 'ESI',                    amount: esi  }] : []),
    ...(pt   > 0 ? [{ label: 'Professional Tax',        amount: pt   }] : []),
    ...(tds  > 0 ? [{ label: 'TDS',                    amount: tds  }] : []),
    ...(lop  > 0 ? [{ label: `Loss of Pay (${entry.lopDays} days)`, amount: lop }] : []),
    ...(loan > 0 ? [{ label: 'Loan EMI Deduction',     amount: loan }] : []),
    ...(incRec > 0 ? [{ label: 'Incentive Recovery',   amount: incRec }] : []),
  ]

  const rowHTML = (label: string, amount: number) =>
    `<tr><td>${label}</td><td style="text-align:right">₹ ${fmt(amount)}</td></tr>`

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Segoe UI', Arial, sans-serif;
      font-size: 11px;
      color: #1a1a1a;
      background: #fff;
      padding: 24px;
    }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      padding-bottom: 16px;
      border-bottom: 2px solid #1f4e79;
      margin-bottom: 16px;
    }
    .company-name {
      font-size: 22px;
      font-weight: 800;
      color: #1f4e79;
      letter-spacing: -0.5px;
    }
    .payslip-title {
      font-size: 13px;
      color: #555;
      margin-top: 2px;
    }
    .payslip-meta {
      text-align: right;
      font-size: 10px;
      color: #666;
    }
    .payslip-meta strong {
      display: block;
      font-size: 14px;
      color: #1f4e79;
      font-weight: 700;
      margin-bottom: 2px;
    }
    .info-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
      margin-bottom: 16px;
    }
    .info-box {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 6px;
      padding: 10px 12px;
    }
    .info-box h4 {
      font-size: 9px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: #94a3b8;
      font-weight: 700;
      margin-bottom: 6px;
    }
    .info-row {
      display: flex;
      justify-content: space-between;
      padding: 2px 0;
      font-size: 10px;
    }
    .info-row .label { color: #64748b; }
    .info-row .value { font-weight: 600; color: #1e293b; }
    .salary-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
      margin-bottom: 14px;
    }
    .salary-box h4 {
      font-size: 9px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      font-weight: 700;
      padding: 6px 10px;
      border-radius: 5px 5px 0 0;
    }
    .earnings-box h4  { background: #ecfdf5; color: #065f46; border: 1px solid #d1fae5; }
    .deductions-box h4 { background: #fef2f2; color: #991b1b; border: 1px solid #fee2e2; }
    table.salary-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 10px;
      border: 1px solid #e2e8f0;
      border-top: none;
    }
    table.salary-table td {
      padding: 5px 10px;
      border-bottom: 1px solid #f1f5f9;
    }
    table.salary-table tr:last-child td { border-bottom: none; }
    .total-row td {
      font-weight: 700;
      background: #f8fafc;
      padding: 7px 10px;
      border-top: 1px solid #e2e8f0 !important;
    }
    .net-box {
      background: #1f4e79;
      color: #fff;
      border-radius: 8px;
      padding: 14px 20px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 14px;
    }
    .net-label { font-size: 12px; font-weight: 600; opacity: 0.9; }
    .net-amount { font-size: 24px; font-weight: 800; letter-spacing: -0.5px; }
    .net-words { font-size: 9px; opacity: 0.7; margin-top: 2px; }
    .bank-box {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 6px;
      padding: 10px 12px;
      margin-bottom: 14px;
      display: flex;
      gap: 20px;
      font-size: 10px;
    }
    .bank-item .bl { color: #94a3b8; }
    .bank-item .bv { font-weight: 600; margin-top: 1px; }
    .footer {
      border-top: 1px solid #e2e8f0;
      padding-top: 10px;
      display: flex;
      justify-content: space-between;
      font-size: 9px;
      color: #94a3b8;
    }
    @media print {
      body { padding: 0; }
    }
  </style>
</head>
<body>

  <!-- Header -->
  <div class="header">
    <div>
      <div class="company-name">CSharpTek</div>
      <div class="payslip-title">Salary Slip</div>
    </div>
    <div class="payslip-meta">
      <strong>${cycle.payrollMonth}</strong>
      Generated on ${today}
    </div>
  </div>

  <!-- Employee & Employment Info -->
  <div class="info-grid">
    <div class="info-box">
      <h4>Employee Details</h4>
      <div class="info-row"><span class="label">Name</span><span class="value">${emp.name}</span></div>
      <div class="info-row"><span class="label">Employee ID</span><span class="value">${emp.employeeCode}</span></div>
      <div class="info-row"><span class="label">Designation</span><span class="value">${emp.jobTitle || '—'}</span></div>
      <div class="info-row"><span class="label">Department</span><span class="value">${emp.department || '—'}</span></div>
      <div class="info-row"><span class="label">PAN</span><span class="value">${emp.panNumber || '—'}</span></div>
      <div class="info-row"><span class="label">PF Number</span><span class="value">${emp.pfNumber || '—'}</span></div>
    </div>
    <div class="info-box">
      <h4>Payroll Details</h4>
      <div class="info-row"><span class="label">Pay Period</span><span class="value">${cycle.payrollMonth}</span></div>
      <div class="info-row"><span class="label">Working Days</span><span class="value">${entry.payableDays} / ${entry.totalDays}</span></div>
      <div class="info-row"><span class="label">LOP Days</span><span class="value">${entry.lopDays}</span></div>
      <div class="info-row"><span class="label">Monthly CTC</span><span class="value">₹ ${fmt(monthly)}</span></div>
      <div class="info-row"><span class="label">Annual CTC</span><span class="value">₹ ${fmt(Number(entry.annualCtc))}</span></div>
      <div class="info-row"><span class="label">Joining Date</span><span class="value">${new Date(emp.joiningDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</span></div>
    </div>
  </div>

  <!-- Salary Breakdown -->
  <div class="salary-grid">
    <!-- Earnings -->
    <div class="salary-box earnings-box">
      <h4>Earnings</h4>
      <table class="salary-table">
        <tbody>
          ${earningsRows.map(r => rowHTML(r.label, r.amount)).join('')}
        </tbody>
        <tfoot>
          <tr class="total-row">
            <td>Total Earnings</td>
            <td style="text-align:right">₹ ${fmt(totalEarnings)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
    <!-- Deductions -->
    <div class="salary-box deductions-box">
      <h4>Deductions</h4>
      <table class="salary-table">
        <tbody>
          ${deductionRows.map(r => rowHTML(r.label, r.amount)).join('')}
        </tbody>
        <tfoot>
          <tr class="total-row">
            <td>Total Deductions</td>
            <td style="text-align:right">₹ ${fmt(totalDeductions)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  </div>

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

  <!-- Footer -->
  <div class="footer">
    <span>This is a computer-generated payslip and does not require a signature.</span>
    <span>CSharpTek · ${today}</span>
  </div>

</body>
</html>`
}
