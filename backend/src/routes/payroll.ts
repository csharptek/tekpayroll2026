import { Router } from 'express';
import { authenticate, requireHR, requireSuperAdmin } from '../middleware/auth';
import { prisma } from '../utils/prisma';
import { AppError } from '../middleware/errorHandler';
import { createAuditLog } from '../middleware/audit';
import { AuditAction, PayrollStatus } from '@prisma/client';
import { calculatePayrollForEmployee } from '../services/payrollEngine';

export const payrollRouter = Router();
payrollRouter.use(authenticate);

// ─── GET ALL CYCLES ──────────────────────────────────────────────────────────

payrollRouter.get('/cycles', async (_req, res) => {
  const cycles = await prisma.payrollCycle.findMany({
    orderBy: { cycleStart: 'desc' },
    take: 24,
  });
  res.json({ success: true, data: cycles });
});

// ─── GET CYCLE DETAIL ────────────────────────────────────────────────────────

payrollRouter.get('/cycles/:id', requireHR, async (req, res) => {
  const cycle = await prisma.payrollCycle.findUnique({
    where: { id: req.params.id },
    include: {
      entries: {
        include: {
          employee: { select: { id: true, name: true, employeeCode: true, department: true } },
          payslip: { select: { status: true } },
        },
      },
    },
  });

  if (!cycle) throw new AppError('Payroll cycle not found', 404);
  res.json({ success: true, data: cycle });
});

// ─── CREATE CYCLE (MANUAL) ───────────────────────────────────────────────────

payrollRouter.post('/cycles', requireHR, async (req, res) => {
  const { cycleStart, cycleEnd, payrollMonth } = req.body;

  const existing = await prisma.payrollCycle.findFirst({
    where: { payrollMonth },
  });
  if (existing) throw new AppError(`Payroll cycle for ${payrollMonth} already exists`, 409);

  const start = new Date(cycleStart);
  const end = new Date(cycleEnd);

  // payroll date = 27th of cycle end month
  const payrollDate = new Date(end.getFullYear(), end.getMonth(), 27);
  // payslip date = 5th of next month
  const payslipDate = new Date(end.getFullYear(), end.getMonth() + 1, 5);
  // salary date = last day of cycle end month
  const salaryDate = new Date(end.getFullYear(), end.getMonth() + 1, 0);

  const cycle = await prisma.payrollCycle.create({
    data: { cycleStart: start, cycleEnd: end, payrollMonth, payrollDate, payslipDate, salaryDate },
  });

  res.status(201).json({ success: true, data: cycle });
});

// ─── RUN PAYROLL ─────────────────────────────────────────────────────────────

payrollRouter.post('/cycles/:id/run', requireHR, async (req, res) => {
  const cycle = await prisma.payrollCycle.findUnique({ where: { id: req.params.id } });
  if (!cycle) throw new AppError('Payroll cycle not found', 404);
  if (cycle.status === PayrollStatus.LOCKED || cycle.status === PayrollStatus.DISBURSED) {
    throw new AppError('Cannot run payroll on a locked or disbursed cycle', 400);
  }

  const employees = await prisma.employee.findMany({
    where: { status: { in: ['ACTIVE', 'ON_NOTICE'] } },
  });

  const results = [];
  let totalGross = 0;
  let totalNet = 0;
  let totalPf = 0;
  let totalEsi = 0;

  for (const emp of employees) {
    try {
      // Get LOP for this cycle
      const lopEntry = await prisma.lopEntry.findUnique({
        where: { cycleId_employeeId: { cycleId: cycle.id, employeeId: emp.id } },
      });

      // Get TDS (from previous entry or default 0)
      const prevEntry = await prisma.payrollEntry.findFirst({
        where: { employeeId: emp.id },
        orderBy: { createdAt: 'desc' },
      });
      const tdsAmount = prevEntry ? Number(prevEntry.tdsAmount) : 0;

      // Get reimbursements total
      const reimbs = await prisma.reimbursement.aggregate({
        where: { cycleId: cycle.id, employeeId: emp.id },
        _sum: { amount: true },
      });
      const reimbTotal = Number(reimbs._sum.amount || 0);

      const calc = await calculatePayrollForEmployee({
        employeeId: emp.id,
        annualCtc: Number(emp.annualCtc),
        annualIncentive: Number(emp.annualIncentive),
        state: emp.state || '',
        joiningDate: emp.joiningDate,
        lastWorkingDay: emp.lastWorkingDay,
        resignationDate: emp.resignationDate,
        cycleStart: cycle.cycleStart,
        cycleEnd: cycle.cycleEnd,
        lopDays: lopEntry?.lopDays || 0,
        tdsAmount,
        reimbursements: reimbTotal,
      });

      // Upsert the payroll entry
      const entry = await prisma.payrollEntry.upsert({
        where: { cycleId_employeeId: { cycleId: cycle.id, employeeId: emp.id } },
        create: {
          cycleId: cycle.id,
          employeeId: emp.id,
          annualCtc: calc.salary.annualCtc,
          monthlyCtc: calc.salary.monthlyCtc,
          basic: calc.salary.basic,
          hra: calc.salary.hra,
          allowances: calc.salary.allowances,
          grossSalary: calc.salary.grossSalary,
          totalDays: calc.proration.totalDays,
          payableDays: calc.proration.payableDays,
          isProrated: calc.proration.isProrated,
          proratedGross: calc.proration.proratedGross,
          incentive: calc.incentive,
          reimbursementTotal: calc.reimbursements,
          lopDays: lopEntry?.lopDays || 0,
          lopAmount: calc.deductions.lop,
          pfAmount: calc.deductions.pf,
          esiAmount: calc.deductions.esi,
          ptAmount: calc.deductions.pt,
          tdsAmount: calc.deductions.tds,
          incentiveRecovery: calc.deductions.incentiveRecovery,
          loanDeduction: calc.deductions.loanDeduction,
          netSalary: calc.netSalary,
          status: 'CALCULATED',
        },
        update: {
          annualCtc: calc.salary.annualCtc,
          monthlyCtc: calc.salary.monthlyCtc,
          basic: calc.salary.basic,
          hra: calc.salary.hra,
          allowances: calc.salary.allowances,
          grossSalary: calc.salary.grossSalary,
          totalDays: calc.proration.totalDays,
          payableDays: calc.proration.payableDays,
          isProrated: calc.proration.isProrated,
          proratedGross: calc.proration.proratedGross,
          incentive: calc.incentive,
          reimbursementTotal: calc.reimbursements,
          lopDays: lopEntry?.lopDays || 0,
          lopAmount: calc.deductions.lop,
          pfAmount: calc.deductions.pf,
          esiAmount: calc.deductions.esi,
          ptAmount: calc.deductions.pt,
          tdsAmount: calc.deductions.tds,
          incentiveRecovery: calc.deductions.incentiveRecovery,
          loanDeduction: calc.deductions.loanDeduction,
          netSalary: calc.netSalary,
          status: 'CALCULATED',
        },
      });

      totalGross += calc.salary.grossSalary;
      totalNet += calc.netSalary;
      totalPf += calc.deductions.pf;
      totalEsi += calc.deductions.esi;
      results.push({ employeeId: emp.id, name: emp.name, netSalary: calc.netSalary, status: 'ok' });
    } catch (err: any) {
      results.push({ employeeId: emp.id, name: emp.name, status: 'error', error: err.message });
    }
  }

  // Update cycle totals and status
  await prisma.payrollCycle.update({
    where: { id: cycle.id },
    data: {
      status: PayrollStatus.CALCULATED,
      runAt: new Date(),
      runBy: req.user!.id,
      totalGross,
      totalNet,
      totalPf,
      totalEsi,
      employeeCount: employees.length,
    },
  });

  await createAuditLog({
    user: req.user!,
    action: AuditAction.PAYROLL_RUN,
    recordId: cycle.id,
    description: `Ran payroll for ${cycle.payrollMonth} — ${employees.length} employees, net total ₹${totalNet.toFixed(2)}`,
  });

  res.json({ success: true, data: { cycleId: cycle.id, results, totalGross, totalNet, employeeCount: employees.length } });
});

// ─── ADJUST INDIVIDUAL ENTRY ─────────────────────────────────────────────────

payrollRouter.put('/entries/:id', requireHR, async (req, res) => {
  const entry = await prisma.payrollEntry.findUnique({
    where: { id: req.params.id },
    include: { cycle: true },
  });
  if (!entry) throw new AppError('Payroll entry not found', 404);
  if (entry.cycle.status === 'LOCKED' || entry.cycle.status === 'DISBURSED') {
    throw new AppError('Cannot edit entries in a locked or disbursed cycle', 400);
  }

  const { tdsAmount, adjustmentNote } = req.body;
  const prev = { tdsAmount: entry.tdsAmount, netSalary: entry.netSalary };

  // Recalculate net after TDS adjustment
  const newTds = tdsAmount ?? Number(entry.tdsAmount);
  const tdsDiff = newTds - Number(entry.tdsAmount);
  const newNet = Number(entry.netSalary) - tdsDiff;

  const updated = await prisma.payrollEntry.update({
    where: { id: req.params.id },
    data: {
      tdsAmount: newTds,
      netSalary: Math.max(0, newNet),
      adjustmentNote,
      adjustedBy: req.user!.id,
      status: 'ADJUSTED',
    },
  });

  await createAuditLog({
    user: req.user!,
    action: AuditAction.UPDATE,
    tableName: 'payroll_entries',
    recordId: entry.id,
    previousValue: prev,
    newValue: { tdsAmount: newTds, netSalary: newNet, adjustmentNote },
    description: `Adjusted payroll entry for employee ${entry.employeeId}`,
  });

  res.json({ success: true, data: updated });
});

// ─── LOCK CYCLE ───────────────────────────────────────────────────────────────

payrollRouter.post('/cycles/:id/lock', requireHR, async (req, res) => {
  const cycle = await prisma.payrollCycle.findUnique({ where: { id: req.params.id } });
  if (!cycle) throw new AppError('Cycle not found', 404);
  if (cycle.status !== 'CALCULATED') throw new AppError('Only CALCULATED cycles can be locked', 400);

  const updated = await prisma.payrollCycle.update({
    where: { id: req.params.id },
    data: { status: 'LOCKED', lockedAt: new Date(), lockedBy: req.user!.id },
  });

  await createAuditLog({
    user: req.user!,
    action: AuditAction.PAYROLL_LOCK,
    recordId: cycle.id,
    description: `Locked payroll cycle ${cycle.payrollMonth}`,
  });

  res.json({ success: true, data: updated });
});

// ─── UNLOCK CYCLE (SUPER ADMIN ONLY) ─────────────────────────────────────────

payrollRouter.post('/cycles/:id/unlock', requireSuperAdmin, async (req, res) => {
  const cycle = await prisma.payrollCycle.findUnique({ where: { id: req.params.id } });
  if (!cycle) throw new AppError('Cycle not found', 404);
  if (cycle.status !== 'LOCKED') throw new AppError('Only LOCKED cycles can be unlocked', 400);

  const { reason } = req.body;
  if (!reason) throw new AppError('Unlock reason is required', 400);

  const updated = await prisma.payrollCycle.update({
    where: { id: req.params.id },
    data: {
      status: 'CALCULATED',
      unlockedAt: new Date(),
      unlockedBy: req.user!.id,
      unlockReason: reason,
    },
  });

  await createAuditLog({
    user: req.user!,
    action: AuditAction.PAYROLL_UNLOCK,
    recordId: cycle.id,
    description: `Unlocked payroll cycle ${cycle.payrollMonth}. Reason: ${reason}`,
  });

  res.json({ success: true, data: updated });
});

// ─── DISBURSE CYCLE ──────────────────────────────────────────────────────────

payrollRouter.post('/cycles/:id/disburse', requireHR, async (req, res) => {
  const cycle = await prisma.payrollCycle.findUnique({ where: { id: req.params.id } });
  if (!cycle) throw new AppError('Cycle not found', 404);
  if (cycle.status !== 'LOCKED') throw new AppError('Cycle must be locked before disbursing', 400);

  const updated = await prisma.payrollCycle.update({
    where: { id: req.params.id },
    data: {
      status: 'DISBURSED',
      disbursedAt: new Date(),
      disbursedBy: req.user!.id,
    },
  });

  // Update all LOCKED entries
  await prisma.payrollEntry.updateMany({
    where: { cycleId: cycle.id },
    data: { status: 'LOCKED' },
  });

  res.json({ success: true, data: updated });
});
