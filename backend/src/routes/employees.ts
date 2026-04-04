import { Router } from 'express';
import { authenticate, requireHR } from '../middleware/auth';
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
  annualIncentive: z.number().min(0).default(0),
  panNumber: z.string().optional(),
  aadhaarNumber: z.string().optional(),
  pfNumber: z.string().optional(),
  esiNumber: z.string().optional(),
  uanNumber: z.string().optional(),
});

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
  });

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
    annualCtc, annualIncentive, resignationDate, lastWorkingDay,
    state, joiningDate, panNumber, aadhaarNumber, pfNumber, esiNumber, uanNumber,
    jobTitle, department, mobilePhone, status
  } = req.body;

  // Handle CTC revision — log it separately
  const updateData: any = {};
  if (annualCtc && annualCtc !== Number(existing.annualCtc)) {
    await prisma.salaryRevision.create({
      data: {
        employeeId: existing.id,
        effectiveFrom: new Date(),
        previousCtc: existing.annualCtc,
        newCtc: annualCtc,
        previousIncentive: existing.annualIncentive,
        newIncentive: annualIncentive ?? existing.annualIncentive,
        reason: req.body.revisionReason || 'CTC revision',
        revisedBy: req.user!.id,
        revisedByName: req.user!.name,
      },
    });
    updateData.annualCtc = annualCtc;
  }

  if (annualIncentive !== undefined) updateData.annualIncentive = annualIncentive;
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

employeeRouter.get('/:id/salary-revisions', requireHR, async (req, res) => {
  const revisions = await prisma.salaryRevision.findMany({
    where: { employeeId: req.params.id },
    orderBy: { effectiveFrom: 'desc' },
  });

  res.json({ success: true, data: revisions });
});

// ─── SALARY PREVIEW ──────────────────────────────────────────────────────────
// POST /api/employees/salary-preview
// Returns calculated breakdown without saving — used for the manual review screen

employeeRouter.post('/salary-preview', requireHR, async (req, res) => {
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
