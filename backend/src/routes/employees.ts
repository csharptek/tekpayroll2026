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
  mobilePhone: z.string().min(10, 'Valid mobile number is required'),
  state: z.string().optional(),
  joiningDate: z.string().datetime(),
  annualCtc: z.number().default(0),
  stipendMonthly: z.number().positive().optional(),
  basicPercent: z.number().min(1).max(100).default(45),
  hraPercent: z.number().min(1).max(100).default(35),
  hasIncentive: z.boolean().default(false),
  incentivePercent: z.number().min(0).max(100).default(12),
  bonusAmountOverride: z.number().min(0).nullable().optional(),
  hraOfBasic: z.boolean().default(true),
  transportMonthly: z.number().nullable().optional(),
  fbpMonthly: z.number().nullable().optional(),
  mediclaim: z.number().default(0),
  tdsMonthly: z.number().default(0),
  panNumber: z.string().optional(),
  aadhaarNumber: z.string().optional(),
  pfNumber: z.string().optional(),
  esiNumber: z.string().optional(),
  uanNumber: z.string().optional(),
  isTrainee: z.boolean().default(false),
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

  // Validate: trainee needs stipend, regular employee needs CTC
  if (data.isTrainee) {
    if (!data.stipendMonthly || data.stipendMonthly <= 0) {
      throw new AppError('Stipend amount is required for trainees', 400)
    }
  } else {
    if (!data.annualCtc || data.annualCtc <= 0) {
      throw new AppError('Annual CTC is required', 400)
    }
  }

  // Get company
  const company = await prisma.company.findFirst();
  if (!company) throw new AppError('Company not configured', 500);

  const employee = await prisma.employee.create({
    data: {
      ...data,
      companyId: company.id,
      joiningDate: new Date(data.joiningDate),
      // For trainees: store stipend*12 as annualCtc so payroll totals still work
      annualCtc: data.isTrainee ? (data.stipendMonthly! * 12) : data.annualCtc,
    },
  })

  // Grant pro-rata leaves for the joining year
  try {
    const { grantJoiningLeaves } = await import('../services/leaveService')
    await grantJoiningLeaves(employee.id, employee.joiningDate, employee.isTrainee)
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
    annualCtc, basicPercent, hraPercent, hasIncentive, incentivePercent, transportMonthly, fbpMonthly,
    mediclaim, tdsMonthly, resignationDate, lastWorkingDay,
    state, joiningDate, panNumber, aadhaarNumber, pfNumber, esiNumber, uanNumber,
    jobTitle, department, mobilePhone, status, stipendMonthly,
    bonusAmountOverride, bonusPayoutOverride, hraOfBasic, revisionEffectiveFrom,
  } = req.body;

  const numOrNull = (v: any) => (v === null || v === undefined || v === '' ? null : Number(v))
  const ex: any = existing
  const prevBonusOverride = ex.bonusAmountOverride != null ? Number(ex.bonusAmountOverride) : null
  const prevBonusPayout   = ex.bonusPayoutOverride != null ? Number(ex.bonusPayoutOverride) : null
  const nextBonusOverride = bonusAmountOverride !== undefined ? numOrNull(bonusAmountOverride) : prevBonusOverride
  const nextBonusPayout   = bonusPayoutOverride !== undefined ? numOrNull(bonusPayoutOverride) : prevBonusPayout
  const nextHraOfBasic    = hraOfBasic !== undefined ? Boolean(hraOfBasic) : Boolean(ex.hraOfBasic)

  const ctcChanged    = Boolean(annualCtc) && Number(annualCtc) !== Number(existing.annualCtc)
  const bonusChanged  = nextBonusOverride !== prevBonusOverride || nextBonusPayout !== prevBonusPayout
  const hraChanged    = nextHraOfBasic !== Boolean(ex.hraOfBasic)
    || (hraPercent !== undefined && Number(hraPercent) !== Number(ex.hraPercent ?? 35))
  const salaryFieldsTouched = [annualCtc, basicPercent, hraPercent, hasIncentive, incentivePercent,
    transportMonthly, fbpMonthly, mediclaim, bonusAmountOverride, bonusPayoutOverride, hraOfBasic]
    .some(v => v !== undefined)

  const effFrom = revisionEffectiveFrom ? new Date(revisionEffectiveFrom) : new Date()
  if (isNaN(effFrom.getTime())) throw new AppError('Invalid revision effective date', 400)

  // Handle salary revision — log it separately (CTC, bonus override or HRA basis change)
  const updateData: any = {};
  if (employeeCode && employeeCode !== existing.employeeCode) updateData.employeeCode = employeeCode;
  if (ctcChanged || bonusChanged || hraChanged) {
    await prisma.salaryRevision.create({
      data: {
        employeeId: existing.id,
        effectiveFrom: effFrom,
        previousBonusOverride: prevBonusOverride,
        newBonusOverride:      nextBonusOverride,
        newBonusPayout:        nextBonusPayout,
        previousHraOfBasic:    Boolean(ex.hraOfBasic),
        newHraOfBasic:         nextHraOfBasic,
        previousCtc:          existing.annualCtc,
        newCtc:               ctcChanged ? annualCtc : existing.annualCtc,
        previousBasicPct:     (existing as any).basicPercent     ?? 45,
        newBasicPct:          basicPercent     ?? (existing as any).basicPercent     ?? 45,
        previousHraPct:       (existing as any).hraPercent       ?? 35,
        newHraPct:            hraPercent       ?? (existing as any).hraPercent       ?? 35,
        previousHasIncentive: Boolean((existing as any).hasIncentive),
        newHasIncentive:      hasIncentive     !== undefined ? Boolean(hasIncentive)     : Boolean((existing as any).hasIncentive),
        previousIncentivePct: (existing as any).incentivePercent ?? 12,
        newIncentivePct:      incentivePercent ?? (existing as any).incentivePercent ?? 12,
        previousTransport:    (existing as any).transportMonthly ?? null,
        newTransport:         transportMonthly !== undefined ? (transportMonthly ?? null) : ((existing as any).transportMonthly ?? null),
        previousFbp:          (existing as any).fbpMonthly       ?? null,
        newFbp:               fbpMonthly       !== undefined ? (fbpMonthly       ?? null) : ((existing as any).fbpMonthly       ?? null),
        previousMediclaim:    (existing as any).mediclaim        ?? 0,
        newMediclaim:         mediclaim        ?? (existing as any).mediclaim        ?? 0,
        previousTds:          (existing as any).tdsMonthly       ?? 0,
        newTds:               tdsMonthly       ?? (existing as any).tdsMonthly       ?? 0,
        reason: req.body.revisionReason || (ctcChanged ? 'CTC revision' : 'Salary structure revision'),
        revisedBy: req.user!.id,
        revisedByName: req.user!.name,
      },
    });
    if (ctcChanged) updateData.annualCtc = annualCtc;
  }
  if (bonusAmountOverride !== undefined) updateData.bonusAmountOverride = nextBonusOverride;
  if (bonusPayoutOverride !== undefined) updateData.bonusPayoutOverride = nextBonusPayout;
  if (hraOfBasic !== undefined) updateData.hraOfBasic = nextHraOfBasic;

  if (hasIncentive !== undefined) updateData.hasIncentive = hasIncentive;
  if (incentivePercent !== undefined) updateData.incentivePercent = incentivePercent;
  if (basicPercent !== undefined) updateData.basicPercent = basicPercent;
  if (hraPercent !== undefined) updateData.hraPercent = hraPercent;
  // Allow null to reset transport/fbp back to auto
  if (transportMonthly !== undefined) updateData.transportMonthly = transportMonthly ?? null;
  if (fbpMonthly !== undefined) updateData.fbpMonthly = fbpMonthly ?? null;
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
  if (stipendMonthly !== undefined && existing.isTrainee) {
    updateData.stipendMonthly = stipendMonthly
    updateData.annualCtc = stipendMonthly * 12
  }
  if (status) updateData.status = status;

  // If resignation date set, put employee on notice
  if (resignationDate && !existing.resignationDate) {
    updateData.status = EmployeeStatus.ON_NOTICE;
  }

  const updated = await prisma.employee.update({
    where: { id: req.params.id },
    data: updateData,
  });

  // Salary changed → refresh active salary snapshot (payroll source of truth)
  if (salaryFieldsTouched && !existing.isTrainee && Number(updated.annualCtc) > 0) {
    try {
      const { computeAndSaveSnapshot } = await import('../services/salarySnapshot')
      await computeAndSaveSnapshot(existing.id, req.user!.id, effFrom)
    } catch (err) {
      console.error('[SNAPSHOT] Failed to refresh salary snapshot:', err)
    }
  }

  // Recalculate leave entitlements if joining date changed
  if (joiningDate && new Date(joiningDate).toISOString() !== existing.joiningDate?.toISOString()) {
    try {
      const { grantJoiningLeaves } = await import('../services/leaveService')
      await grantJoiningLeaves(existing.id, new Date(joiningDate), existing.isTrainee)
    } catch (err) {
      console.error('[LEAVE] Failed to recalculate joining leaves on date update:', err)
    }
  }

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

// ─── CONVERT TRAINEE → EMPLOYEE ──────────────────────────────────────────────
// Copy personal / statutory / bank data from trainee to converted employee.
// Only fills what is missing on the new record. Never copies salary.
async function copyTraineeData(traineeId: string, newId: string) {
  const t: any = await prisma.employee.findUnique({
    where: { id: traineeId },
    include: { bankDetail: true, profile: true, address: true, governmentId: true, employmentDetail: true, documents: true } as any,
  })
  const n: any = await prisma.employee.findUnique({
    where: { id: newId },
    include: { bankDetail: true, profile: true, address: true, governmentId: true, employmentDetail: true, documents: true } as any,
  })
  if (!t || !n) return

  const strip = (o: any) => {
    if (!o) return o
    const { id, employeeId, createdAt, updatedAt, ...rest } = o
    return rest
  }

  // Scalar statutory fields + job title
  const scalar: any = {}
  for (const f of ['panNumber', 'aadhaarNumber', 'pfNumber', 'esiNumber', 'uanNumber']) {
    if (!n[f] && t[f]) scalar[f] = t[f]
  }
  if (n.jobTitle && /trainee/i.test(n.jobTitle)) {
    const cleaned = n.jobTitle.replace(/\btrainee\b/i, '').replace(/\s+/g, ' ').trim()
    if (cleaned) scalar.jobTitle = cleaned
  }
  if (Object.keys(scalar).length) await prisma.employee.update({ where: { id: newId }, data: scalar })

  if (t.bankDetail && !n.bankDetail)     await prisma.bankDetail.create({ data: { ...strip(t.bankDetail), employeeId: newId } })
  if (t.profile && !n.profile)           await prisma.employeeProfile.create({ data: { ...strip(t.profile), employeeId: newId } })
  if (t.address && !n.address)           await prisma.employeeAddress.create({ data: { ...strip(t.address), employeeId: newId } })
  if (t.governmentId && !n.governmentId) await prisma.governmentId.create({ data: { ...strip(t.governmentId), employeeId: newId } })

  // Employment detail — no probation on conversion
  if (!n.employmentDetail) {
    const ed = t.employmentDetail ? strip(t.employmentDetail) : {}
    await prisma.employmentDetail.create({ data: { ...ed, probationMonths: 0, employeeId: newId } })
  } else if (n.employmentDetail.probationMonths) {
    await prisma.employmentDetail.update({ where: { employeeId: newId }, data: { probationMonths: 0 } })
  }

  // Documents — copy rows (same stored file)
  if ((t.documents?.length ?? 0) > 0 && (n.documents?.length ?? 0) === 0) {
    await prisma.employeeDocument.createMany({
      data: t.documents.map((d: any) => ({ ...strip(d), employeeId: newId })),
    })
  }
}

// Re-grant leaves for converted employee with zero probation
async function regrantConvertedLeaves(newId: string, joiningDate: Date) {
  const { grantJoiningLeaves } = await import('../services/leaveService')
  const used = await prisma.leaveApplication.count({ where: { employeeId: newId } })
  if (used === 0) await prisma.leaveEntitlement.deleteMany({ where: { employeeId: newId } })
  await grantJoiningLeaves(newId, joiningDate, false, 0)
}

// POST /api/employees/:id/convert-to-employee
// Body: { traineeEndDate: string (ISO date) }

employeeRouter.post('/:id/convert-to-employee', requireHR, async (req, res) => {
  const trainee = await prisma.employee.findUnique({ where: { id: req.params.id } })
  if (!trainee) throw new AppError('Employee not found', 404)
  if (!trainee.isTrainee) throw new AppError('Employee is not a trainee', 400)
  if (trainee.convertedToEmployeeId) throw new AppError('Trainee already converted', 400)
  // Allow retry of a previously failed half-conversion (INACTIVE + suffixed email, no link)
  const isHalfConverted = trainee.status !== 'ACTIVE' && trainee.email.includes('+trainee@')
  if (trainee.status !== 'ACTIVE' && !isHalfConverted) throw new AppError('Trainee is not active', 400)

  const { traineeEndDate } = req.body
  if (!traineeEndDate) throw new AppError('traineeEndDate is required', 400)

  const endDate = new Date(traineeEndDate)
  if (isNaN(endDate.getTime())) throw new AppError('Invalid traineeEndDate', 400)

  const joiningDate = new Date(endDate)
  joiningDate.setDate(joiningDate.getDate() + 1)

  // Auto-generate next C#TEK code
  const allCodes = await prisma.employee.findMany({ select: { employeeCode: true } })
  let maxNum = 0
  for (const emp of allCodes) {
    const code = emp.employeeCode
    if (!code.startsWith('C#TEK') || code.startsWith('C#TEKT')) continue
    const num = parseInt(code.replace('C#TEK', ''), 10)
    if (!isNaN(num) && num > maxNum) maxNum = num
  }
  const newCode = `C#TEK${maxNum + 1}`

  // Original email (strip +trainee suffix if this is a retry)
  const originalEmail = trainee.email.replace('+trainee@', '@')
  const [localPart, domain] = originalEmail.split('@')
  const traineeEmail = `${localPart}+trainee@${domain}`

  const company = await prisma.company.findFirst()
  if (!company) throw new AppError('Company not configured', 500)

  const clash = await prisma.employee.findFirst({
    where: { email: originalEmail, id: { not: trainee.id } },
    select: { employeeCode: true },
  })
  if (clash) throw new AppError(`Email ${originalEmail} already used by ${clash.employeeCode}`, 409)

  // Atomic: free email + entraId on trainee, create employee, link
  const newEmployee = await prisma.$transaction(async (tx) => {
    await tx.employee.update({
      where: { id: trainee.id },
      data: {
        status:  'INACTIVE' as any,
        email:   traineeEmail,
        entraId: null,
      },
    })

    const created = await tx.employee.create({
      data: {
        companyId:    company.id,
        entraId:      trainee.entraId,
        employeeCode: newCode,
        name:         trainee.name,
        email:        originalEmail,
        jobTitle:     trainee.jobTitle,
        department:   trainee.department,
        mobilePhone:  trainee.mobilePhone,
        officeLocation: trainee.officeLocation,
        state:        trainee.state,
        role:         'EMPLOYEE' as any,
        isTrainee:    false,
        joiningDate,
        annualCtc:    0,  // HR sets salary separately
        status:       'ACTIVE' as any,
        convertedFromTraineeId: trainee.id,
      },
    })

    await tx.employee.update({
      where: { id: trainee.id },
      data: { convertedToEmployeeId: created.id },
    })

    return created
  })

  // Copy personal / statutory / bank data
  try {
    await copyTraineeData(trainee.id, newEmployee.id)
  } catch (err) {
    console.error('[CONVERT] Failed to copy trainee data:', err)
  }

  // Grant pro-rata leave entitlements — no probation on conversion
  try {
    await regrantConvertedLeaves(newEmployee.id, joiningDate)
  } catch (err) {
    console.error('[CONVERT] Failed to grant leaves:', err)
  }

  // Assign Payroll.Employee role in Entra ID
  if (trainee.entraId) {
    try {
      const { assignPayrollRole } = await import('../services/graphSyncService')
      await assignPayrollRole(trainee.entraId, 'EMPLOYEE')
    } catch (err) {
      console.warn('[CONVERT] Entra role assignment failed:', err)
    }
  }

  await createAuditLog({
    user: req.user!,
    action: AuditAction.CREATE,
    tableName: 'employees',
    recordId: newEmployee.id,
    targetEmployeeId: newEmployee.id,
    newValue: { employeeCode: newCode, convertedFrom: trainee.employeeCode },
    description: `Converted trainee ${trainee.name} (${trainee.employeeCode}) → employee (${newCode})`,
  })

  res.json({ success: true, data: { newEmployeeId: newEmployee.id, employeeCode: newCode } })
})

// ─── RESYNC CONVERTED EMPLOYEE FROM TRAINEE ──────────────────────────────────
// POST /api/employees/:id/resync-from-trainee  (:id = converted employee)
employeeRouter.post('/:id/resync-from-trainee', requireHR, async (req, res) => {
  const emp = await prisma.employee.findUnique({ where: { id: req.params.id } })
  if (!emp) throw new AppError('Employee not found', 404)
  if (!emp.convertedFromTraineeId) throw new AppError('Employee was not converted from a trainee', 400)

  await copyTraineeData(emp.convertedFromTraineeId, emp.id)
  await regrantConvertedLeaves(emp.id, emp.joiningDate)

  res.json({ success: true })
})

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
  const preview = await previewSalaryBreakdown({
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
