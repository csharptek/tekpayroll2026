import { PrismaClient, EmployeeStatus, UserRole } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  console.log('\n🌱 Seeding TEKONE database...\n')

  // ── COMPANY ────────────────────────────────────────────────────────────────
  const company = await prisma.company.upsert({
    where: { id: 'csharptek-main' },
    update: { name: 'CSharpTek' },
    create: { id: 'csharptek-main', name: 'CSharpTek' },
  })
  console.log(`✅ Company: ${company.name}`)

  // ── SYSTEM CONFIG ──────────────────────────────────────────────────────────
  const configs = [
    { key: 'PF_CAP',           value: '1800',  description: 'Maximum PF deduction per month (₹)' },
    { key: 'ESI_THRESHOLD',    value: '21000', description: 'ESI applies if gross ≤ this (₹)' },
    { key: 'CYCLE_START_DAY',  value: '26',    description: 'Payroll cycle start day of previous month' },
    { key: 'CYCLE_END_DAY',    value: '25',    description: 'Payroll cycle end day of current month' },
    { key: 'PAYROLL_RUN_DAY',  value: '27',    description: 'Payroll engine runs on this day' },
    { key: 'PAYSLIP_GEN_DAY',  value: '5',     description: 'Payslips generated and sent on this day' },
  ]
  for (const c of configs) {
    await prisma.systemConfig.upsert({
      where:  { key: c.key },
      update: { value: c.value },
      create: c,
    })
  }
  console.log(`✅ System config: ${configs.length} entries`)

  // ── PT SLABS ───────────────────────────────────────────────────────────────
  // Delete and recreate to avoid duplicates
  await prisma.ptSlab.deleteMany({})
  const ptSlabs = [
    { state: 'Maharashtra', minSalary: 0,     maxSalary: 7500,  ptAmount: 0 },
    { state: 'Maharashtra', minSalary: 7501,  maxSalary: 10000, ptAmount: 175 },
    { state: 'Maharashtra', minSalary: 10001, maxSalary: null,  ptAmount: 200 },
    { state: 'Karnataka',   minSalary: 0,     maxSalary: 15000, ptAmount: 0 },
    { state: 'Karnataka',   minSalary: 15001, maxSalary: null,  ptAmount: 200 },
    { state: 'Delhi',       minSalary: 0,     maxSalary: null,  ptAmount: 0 },
    { state: 'Tamil Nadu',  minSalary: 0,     maxSalary: 21000, ptAmount: 135 },
    { state: 'Tamil Nadu',  minSalary: 21001, maxSalary: null,  ptAmount: 135 },
    { state: 'Telangana',   minSalary: 0,     maxSalary: 15000, ptAmount: 0 },
    { state: 'Telangana',   minSalary: 15001, maxSalary: null,  ptAmount: 200 },
  ]
  await prisma.ptSlab.createMany({ data: ptSlabs as any })
  console.log(`✅ PT slabs: ${ptSlabs.length} entries across 5 states`)

  // ── EMPLOYEES ──────────────────────────────────────────────────────────────
  const employeeData = [
    { code: 'CST-001', name: 'Bhanu Prakash',  email: 'bhanu@csharptek.com',   role: UserRole.SUPER_ADMIN, dept: 'Engineering', title: 'CTO',                  state: 'Maharashtra', ctc: 1800000, incentive: 180000, joining: '2020-01-15' },
    { code: 'CST-002', name: 'Priya Sharma',   email: 'priya@csharptek.com',   role: UserRole.HR,          dept: 'HR',          title: 'HR Manager',           state: 'Maharashtra', ctc: 720000,  incentive: 60000,  joining: '2021-03-01' },
    { code: 'CST-003', name: 'Rahul Verma',    email: 'rahul@csharptek.com',   role: UserRole.MANAGEMENT,  dept: 'Engineering', title: 'Engineering Manager',  state: 'Karnataka',   ctc: 1200000, incentive: 120000, joining: '2021-06-15' },
    { code: 'CST-004', name: 'Anjali Mehta',   email: 'anjali@csharptek.com',  role: UserRole.EMPLOYEE,    dept: 'Engineering', title: 'Senior Developer',     state: 'Maharashtra', ctc: 900000,  incentive: 72000,  joining: '2022-01-10' },
    { code: 'CST-005', name: 'Karthik Rajan',  email: 'karthik@csharptek.com', role: UserRole.EMPLOYEE,    dept: 'Engineering', title: 'Backend Developer',    state: 'Karnataka',   ctc: 720000,  incentive: 48000,  joining: '2022-04-01' },
    { code: 'CST-006', name: 'Deepa Nair',     email: 'deepa@csharptek.com',   role: UserRole.EMPLOYEE,    dept: 'Design',      title: 'UI/UX Designer',       state: 'Kerala',      ctc: 660000,  incentive: 36000,  joining: '2022-07-15' },
    { code: 'CST-007', name: 'Sanjay Gupta',   email: 'sanjay@csharptek.com',  role: UserRole.EMPLOYEE,    dept: 'Product',     title: 'Product Manager',      state: 'Delhi',       ctc: 960000,  incentive: 96000,  joining: '2022-09-01' },
    { code: 'CST-008', name: 'Meera Krishnan', email: 'meera@csharptek.com',   role: UserRole.EMPLOYEE,    dept: 'Engineering', title: 'Frontend Developer',   state: 'Tamil Nadu',  ctc: 720000,  incentive: 48000,  joining: '2023-01-15' },
    { code: 'CST-009', name: 'Arjun Patel',    email: 'arjun@csharptek.com',   role: UserRole.EMPLOYEE,    dept: 'Sales',       title: 'Business Developer',   state: 'Gujarat',     ctc: 600000,  incentive: 120000, joining: '2023-03-01' },
    { code: 'CST-010', name: 'Sneha Reddy',    email: 'sneha@csharptek.com',   role: UserRole.EMPLOYEE,    dept: 'Engineering', title: 'QA Engineer',          state: 'Telangana',   ctc: 600000,  incentive: 36000,  joining: '2023-06-01' },
  ]

  const employees: any[] = []
  for (const e of employeeData) {
    const emp = await prisma.employee.upsert({
      where:  { employeeCode: e.code },
      update: { name: e.name, email: e.email },
      create: {
        companyId:       company.id,
        employeeCode:    e.code,
        name:            e.name,
        email:           e.email,
        role:            e.role,
        department:      e.dept,
        jobTitle:        e.title,
        state:           e.state,
        joiningDate:     new Date(e.joining),
        annualCtc:        e.ctc,
        hasIncentive:     true,
        incentivePercent: 12,
        status:           EmployeeStatus.ACTIVE,
        panNumber:       `PAN${e.code.replace('-', '')}F`,
        pfNumber:        `PF${e.code.replace('-', '')}`,
      },
    })
    employees.push(emp)
  }
  console.log(`✅ Employees: ${employees.length} created`)

  // ── BANK DETAILS ───────────────────────────────────────────────────────────
  const banks = ['HDFC Bank', 'ICICI Bank', 'SBI', 'Axis Bank', 'Kotak Bank']
  const ifscs  = ['HDFC0001234', 'ICIC0001234', 'SBIN0001234', 'UTIB0001234', 'KKBK0001234']
  for (let i = 0; i < employees.length; i++) {
    await prisma.bankDetail.upsert({
      where:  { employeeId: employees[i].id },
      update: {},
      create: {
        employeeId:    employees[i].id,
        bankName:      banks[i % banks.length],
        accountNumber: `50100${100000 + i * 12345}`,
        ifscCode:      ifscs[i % ifscs.length],
        accountName:   employees[i].name,
      },
    })
  }
  console.log(`✅ Bank details: ${employees.length} created`)

  // ── PAYROLL CYCLE ──────────────────────────────────────────────────────────
  const now   = new Date()
  const year  = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const payrollMonth = `${year}-${month}`

  await prisma.payrollCycle.upsert({
    where:  { id: 'cycle-current' },
    update: {},
    create: {
      id:           'cycle-current',
      payrollMonth,
      cycleStart:   new Date(year, now.getMonth() - 1, 26),
      cycleEnd:     new Date(year, now.getMonth(), 25),
      payrollDate:  new Date(year, now.getMonth(), 27),
      payslipDate:  new Date(year, now.getMonth() + 1, 5),
      salaryDate:   new Date(year, now.getMonth() + 1, 0),
      status:       'DRAFT',
    },
  })
  console.log(`✅ Payroll cycle: ${payrollMonth}`)

  // ── SAMPLE LOAN ────────────────────────────────────────────────────────────
  const existingLoan = await prisma.loan.findFirst({ where: { employeeId: employees[3].id } })
  if (!existingLoan) {
    await prisma.loan.create({
      data: {
        employeeId:        employees[3].id,
        principalAmount:   100000,
        disbursedOn:       new Date('2024-10-01'),
        tenureMonths:      12,
        emiAmount:         9000,
        outstandingBalance: 45000,
        totalRepaid:       55000,
        purpose:           'Medical emergency',
        status:            'ACTIVE',
        approvedBy:        employees[1].id,
        approvedByName:    employees[1].name,
      },
    })
    console.log(`✅ Sample loan created for ${employees[3].name}`)
  } else {
    console.log(`✅ Sample loan already exists`)
  }

  // ── LEAVE TYPES ────────────────────────────────────────────────────────────
  const leaveTypes = [
    { name: 'Casual Leave',  annualQuota: 12, carryForward: false, isPaid: true },
    { name: 'Sick Leave',    annualQuota: 6,  carryForward: false, isPaid: true },
    { name: 'Earned Leave',  annualQuota: 15, carryForward: true,  maxCarryDays: 30, isPaid: true },
  ]
  for (const lt of leaveTypes) {
    const existing = await prisma.leaveType.findFirst({ where: { name: lt.name } })
    if (!existing) {
      await prisma.leaveType.create({ data: lt })
    }
  }
  console.log(`✅ Leave types: ${leaveTypes.length} created`)

  console.log('\n🎉 Seed complete! TEKONE is ready.\n')
  console.log('Dev login roles:')
  console.log('  SUPER_ADMIN → bhanu@csharptek.com')
  console.log('  HR          → priya@csharptek.com')
  console.log('  MANAGEMENT  → rahul@csharptek.com')
  console.log('  EMPLOYEE    → anjali@csharptek.com\n')
}

main()
  .catch(e => {
    console.error('❌ Seed failed:', e.message)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
