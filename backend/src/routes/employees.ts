import { Router } from 'express';
import { authenticate, requireHR, requireSuperAdmin } from '../middleware/auth';
import { prisma } from '../utils/prisma';
import { AppError } from '../middleware/errorHandler';
import { createAuditLog } from '../middleware/audit';
import { AuditAction, EmployeeStatus } from '@prisma/client';
import { z } from 'zod';

export const employeeRouter = Router();
employeeRouter.use(authenticate);

// ─── VALIDATION SCHEMAS ──────────────────────────────────────────────────────

const createEmployeeSchema = z.object({
  employeeCode: z.string().min(1),
  name: z.string().min(1),
  email: z.string().email(),
  jobTitle: z.string().optional(),
  department: z.string().optional(),
  mobilePhone: z.string().optional(),
  state: z.string().optional(),
  joiningDate: z.string().datetime(),
  annualCtc: z.number().positive(),
  hasIncentive: z.boolean().default(false),
  incentivePercent: z.number().min(0).max(100).default(12),
  transportMonthly: z.number().optional(),
  fbpMonthly: z.number().optional(),
  mediclaim: z.number().default(0),
  tdsMonthly: z.number().default(0),
  panNumber: z.string().optional(),
  aadhaarNumber: z.string().optional(),
  pfNumber: z.string().optional(),
  esiNumber: z.string().optional(),
  uanNumber: z.string().optional(),
});

// ─── NEXT EMPLOYEE CODE ───────────────────────────────────────────────────────
// GET /api/employees/next-code?type=EMPLOYEE|TRAINEE

employeeRouter.get('/next-code', requireHR, async (req, res) => {
  const type = (req.query.type as string) === 'TRAINEE' ? 'TRAINEE' : 'EMPLOYEE'
  const prefix = type === 'TRAINEE' ? 'C#TEKT' : 'C#TEK'

  // Find all employee codes matching this prefix, extract numbers, return max+1
  // Note: C#TEK is a substring of C#TEKT — for EMPLOYEE type we must exclude trainee codes
  const allCodes = await prisma.employee.findMany({ select: { employeeCode: true } })
  let maxNum = 0
  for (const emp of allCodes) {
    const code = emp.employeeCode
    if (type === 'EMPLOYEE') {
      // Must start with C#TEK but NOT C#TEKT
      if (!code.startsWith('C#TEK') || code.startsWith('C#TEKT')) continue
      const num = parseInt(code.replace('C#TEK', ''), 10)
      if (!isNaN(num) && num > maxNum) maxNum = num
    } else {
      // Trainee: must start with C#TEKT
      if (!code.startsWith('C#TEKT')) continue
      const num = parseInt(code.replace('C#TEKT', ''), 10)
      if (!isNaN(num) && num > maxNum) maxNum = num
    }
  }

  res.json({ success: true, data: { nextCode: `${prefix}${maxNum + 1}`, type, prefix, lastNum: maxNum } })
})


// ─── GET BIRTHDAYS BY MONTH ──────────────────────────────────────────────────
// Returns employees with birthday in given month (no financial data)
employeeRouter.get('/birthdays/month', async (req, res) => {
  const month = parseInt(req.query.month as string) || new Date().getMonth() + 1
  const profiles = await prisma.employeeProfile.findMany({
    where: { dateOfBirth: { not: null }, employee: { status: 'ACTIVE' } },
    select: {
      dateOfBirth: true,
      employee: { select: { id: true, name: true, department: true, jobTitle: true } },
    },
  })
  const filtered = profiles
    .filter(p => p.dateOfBirth && new Date(p.dateOfBirth).getMonth() + 1 === month)
    .map(p => ({
      id:          p.employee.id,
      name:        p.employee.name,
      department:  p.employee.department,
      jobTitle:    p.employee.jobTitle,
      dateOfBirth: p.dateOfBirth,
    }))
  res.json({ success: true, data: filtered })
})

// ─── GET ALL EMPLOYEES ───────────────────────────────────────────────────────

employeeRouter.get('/', async (req, res) => {
  const { status, department, search, page = '1', limit = '20' } = req.query;

  const where: any = {};
  if (status) where.status = status as EmployeeStatus;
  if (department) where.department = department as string;
  if (search) {
    where.OR = [
      { name: { contains: search as string, mode: 'insensitive' } },
      { email: { contains: search as string, mode: 'insensitive' } },
      { employeeCode: { contains: search as string, mode: 'insensitive' } },
    ];
  }

  const pageNum = parseInt(page as string);
  const limitNum = parseInt(limit as string);

  const [employees, total] = await Promise.all([
    prisma.employee.findMany({
      where,
      include: { bankDetail: { select: { bankName: true, accountNumber: true } } },
      orderBy: { name: 'asc' },
      skip: (pageNum - 1) * limitNum,
      take: limitNum,
    }),
    prisma.employee.count({ where }),
  ]);

  res.json({
    success: true,
    data: employees,
    pagination: { page: pageNum, limit: limitNum, total, pages: Math.ceil(total / limitNum) },
  });
});

// ─── GET SINGLE EMPLOYEE ─────────────────────────────────────────────────────

employeeRouter.get('/:id', async (req, res) => {
  const employee = await prisma.employee.findUnique({
    where: { id: req.params.id },
    include: {
      bankDetail: true,
      salaryRevisions: { orderBy: { effectiveFrom: 'desc' }, take: 10 },
      loans: { where: { status: 'ACTIVE' }, orderBy: { createdAt: 'desc' } },
    },
  });

  if (!employee) throw new AppError('Employee not found', 404, 'NOT_FOUND');

  // Employees can only view their own profile
  if (req.user!.role === 'EMPLOYEE' && req.user!.id !== employee.id) {
    throw new AppError('Access denied', 403, 'FORBIDDEN');
  }

  res.json({ success: true, data: employee });
});

// ─── CREATE EMPLOYEE ─────────────────────────────────────────────────────────

employeeRouter.post('/', requireHR, async (req, res) => {
  const data = createEmployeeSchema.parse(req.body);

  // Get company
  const company = await prisma.company.findFirst();
  if (!company) throw new AppError('Company not configured', 500);

  const employee = await prisma.employee.create({
    data: {
      ...data,
      companyId: company.id,
      joiningDate: new Date(data.joiningDate),
    },
  })

  // Grant pro-rata leaves for the joining year
  try {
    const { grantJoiningLeaves } = await import('../services/leaveService')
    await grantJoiningLeaves(employee.id, employee.joiningDate)
  } catch (err) {
    console.error('[LEAVE] Failed to grant joining leaves:', err)
  };

  await createAuditLog({
    user: req.user!,
    action: AuditAction.CREATE,
    tableName: 'employees',
    recordId: employee.id,
    targetEmployeeId: employee.id,
    newValue: { name: employee.name, email: employee.email, annualCtc: data.annualCtc },
    description: `Created employee ${employee.name} (${employee.employeeCode})`,
  });

  res.status(201).json({ success: true, data: employee });
});

// ─── UPDATE EMPLOYEE ─────────────────────────────────────────────────────────

employeeRouter.put('/:id', requireHR, async (req, res) => {
  const existing = await prisma.employee.findUnique({ where: { id: req.params.id } });
  if (!existing) throw new AppError('Employee not found', 404);

  const {
    employeeCode,
    annualCtc, hasIncentive, incentivePercent, transportMonthly, fbpMonthly,
    mediclaim, tdsMonthly, resignationDate, lastWorkingDay,
    state, joiningDate, panNumber, aadhaarNumber, pfNumber, esiNumber, uanNumber,
    jobTitle, department, mobilePhone, status
  } = req.body;

  // Handle CTC revision — log it separately
  const updateData: any = {};
  if (employeeCode && employeeCode !== existing.employeeCode) updateData.employeeCode = employeeCode;
  if (annualCtc && annualCtc !== Number(existing.annualCtc)) {
    await prisma.salaryRevision.create({
      data: {
        employeeId: existing.id,
        effectiveFrom: new Date(),
        previousCtc: existing.annualCtc,
        newCtc: annualCtc,
        // previousIncentive: existing.annualIncentive,
        // newIncentive: annualIncentive ?? existing.annualIncentive,
        reason: req.body.revisionReason || 'CTC revision',
        revisedBy: req.user!.id,
        revisedByName: req.user!.name,
      },
    });
    updateData.annualCtc = annualCtc;
  }

  if (hasIncentive !== undefined) updateData.hasIncentive = hasIncentive;
  if (incentivePercent !== undefined) updateData.incentivePercent = incentivePercent;
  if (transportMonthly !== undefined) updateData.transportMonthly = transportMonthly;
  if (fbpMonthly !== undefined) updateData.fbpMonthly = fbpMonthly;
  if (mediclaim !== undefined) updateData.mediclaim = mediclaim;
  if (tdsMonthly !== undefined) updateData.tdsMonthly = tdsMonthly;
  if (resignationDate) updateData.resignationDate = new Date(resignationDate);
  if (lastWorkingDay) updateData.lastWorkingDay = new Date(lastWorkingDay);
  if (state) updateData.state = state;
  if (joiningDate) updateData.joiningDate = new Date(joiningDate);
  if (panNumber) updateData.panNumber = panNumber;
  if (aadhaarNumber) updateData.aadhaarNumber = aadhaarNumber;
  if (pfNumber) updateData.pfNumber = pfNumber;
  if (esiNumber) updateData.esiNumber = esiNumber;
  if (uanNumber) updateData.uanNumber = uanNumber;
  if (jobTitle) updateData.jobTitle = jobTitle;
  if (department) updateData.department = department;
  if (mobilePhone) updateData.mobilePhone = mobilePhone;
  if (status) updateData.status = status;

  // If resignation date set, put employee on notice
  if (resignationDate && !existing.resignationDate) {
    updateData.status = EmployeeStatus.ON_NOTICE;
  }

  const updated = await prisma.employee.update({
    where: { id: req.params.id },
    data: updateData,
  });

  await createAuditLog({
    user: req.user!,
    action: AuditAction.UPDATE,
    tableName: 'employees',
    recordId: existing.id,
    targetEmployeeId: existing.id,
    previousValue: { annualCtc: existing.annualCtc, status: existing.status },
    newValue: updateData,
    description: `Updated employee ${existing.name}`,
  });

  res.json({ success: true, data: updated });
});

// ─── DEACTIVATE EMPLOYEE ─────────────────────────────────────────────────────

employeeRouter.post('/:id/deactivate', requireHR, async (req, res) => {
  const employee = await prisma.employee.findUnique({ where: { id: req.params.id } });
  if (!employee) throw new AppError('Employee not found', 404);

  const updated = await prisma.employee.update({
    where: { id: req.params.id },
    data: { status: EmployeeStatus.INACTIVE },
  });

  await createAuditLog({
    user: req.user!,
    action: AuditAction.UPDATE,
    tableName: 'employees',
    recordId: employee.id,
    targetEmployeeId: employee.id,
    description: `Deactivated employee ${employee.name}`,
  });

  res.json({ success: true, data: updated });
});

// ─── DELETE EMPLOYEE (hard delete — SUPER_ADMIN only) ────────────────────────

employeeRouter.delete('/:id', async (req, res) => {
  if (req.user!.role !== 'SUPER_ADMIN') {
    throw new AppError('Only Super Admins can permanently delete employees', 403);
  }

  const employee = await prisma.employee.findUnique({ where: { id: req.params.id } });
  if (!employee) throw new AppError('Employee not found', 404);

  // Delete in FK-safe order
  await prisma.loanRepayment.deleteMany({ where: { loan: { employeeId: employee.id } } });
  await prisma.loan.deleteMany({ where: { employeeId: employee.id } });
  await prisma.payslip.deleteMany({ where: { employeeId: employee.id } });
  await prisma.payrollEntry.deleteMany({ where: { employeeId: employee.id } });
  await prisma.lopEntry.deleteMany({ where: { employeeId: employee.id } });
  await prisma.reimbursement.deleteMany({ where: { employeeId: employee.id } });
  await prisma.fnfSettlement.deleteMany({ where: { employeeId: employee.id } });
  await prisma.salaryRevision.deleteMany({ where: { employeeId: employee.id } });
  await prisma.auditLog.deleteMany({
    where: { OR: [{ performedById: employee.id }, { targetEmployeeId: employee.id }] },
  });
  await prisma.employeeDocument.deleteMany({ where: { employeeId: employee.id } });
  await prisma.governmentId.deleteMany({ where: { employeeId: employee.id } });
  await prisma.bankAccount.deleteMany({ where: { employeeId: employee.id } });
  await prisma.workExperience.deleteMany({ where: { employeeId: employee.id } });
  await prisma.educationRecord.deleteMany({ where: { employeeId: employee.id } });
  await prisma.emergencyContact.deleteMany({ where: { employeeId: employee.id } });
  await prisma.employmentDetail.deleteMany({ where: { employeeId: employee.id } });
  await prisma.employeeAddress.deleteMany({ where: { employeeId: employee.id } });
  await prisma.employeeProfile.deleteMany({ where: { employeeId: employee.id } });
  await prisma.bankDetail.deleteMany({ where: { employeeId: employee.id } });
  await prisma.leaveBalance.deleteMany({ where: { employeeId: employee.id } });
  await prisma.leaveApplication.deleteMany({ where: { employeeId: employee.id } });

  await prisma.employee.delete({ where: { id: employee.id } });

  res.json({ success: true, message: `Employee ${employee.name} permanently deleted` });
});

// ─── GET PAYROLL HISTORY FOR EMPLOYEE ────────────────────────────────────────

employeeRouter.get('/:id/payroll-history', async (req, res) => {
  if (req.user!.role === 'EMPLOYEE' && req.user!.id !== req.params.id) {
    throw new AppError('Access denied', 403);
  }

  const entries = await prisma.payrollEntry.findMany({
    where: { employeeId: req.params.id },
    include: {
      cycle: { select: { payrollMonth: true, status: true } },
      payslip: { select: { status: true, pdfUrl: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  res.json({ success: true, data: entries });
});

// ─── GET SALARY REVISIONS ────────────────────────────────────────────────────

employeeRouter.get('/:id/salary-revisions', requireSuperAdmin, async (req, res) => {
  const revisions = await prisma.salaryRevision.findMany({
    where: { employeeId: req.params.id },
    orderBy: { effectiveFrom: 'desc' },
  });

  res.json({ success: true, data: revisions });
});

// ─── SALARY PREVIEW ──────────────────────────────────────────────────────────
// POST /api/employees/salary-preview
// Returns calculated breakdown without saving — used for the manual review screen

employeeRouter.post('/salary-preview', requireSuperAdmin, async (req, res) => {
  const {
    annualCtc, basicPercent = 45, hraPercent = 35,
    transportMonthly = null, fbpMonthly = null,
    mediclaim = 0, hasIncentive = false, incentivePercent = 12,
  } = req.body

  if (!annualCtc) return res.status(400).json({ success: false, error: 'annualCtc is required' })

  const { previewSalaryBreakdown } = await import('../services/payrollEngine')
  const preview = previewSalaryBreakdown({
    annualCtc: Number(annualCtc),
    basicPercent: Number(basicPercent),
    hraPercent: Number(hraPercent),
    transportMonthly: transportMonthly !== null ? Number(transportMonthly) : null,
    fbpMonthly: fbpMonthly !== null ? Number(fbpMonthly) : null,
    mediclaim: Number(mediclaim),
    hasIncentive: Boolean(hasIncentive),
    incentivePercent: Number(incentivePercent),
  })

  res.json({ success: true, data: preview })
})
