import { Router } from 'express';
import { authenticate, requireHR } from '../middleware/auth';
import { prisma } from '../utils/prisma';
import { AppError } from '../middleware/errorHandler';
import { createAuditLog } from '../middleware/audit';
import { AuditAction } from '@prisma/client';

export const loanRouter = Router();
loanRouter.use(authenticate);

loanRouter.get('/', requireHR, async (_req, res) => {
  const loans = await prisma.loan.findMany({
    include: { employee: { select: { name: true, employeeCode: true } } },
    orderBy: { createdAt: 'desc' },
  });
  res.json({ success: true, data: loans });
});

loanRouter.get('/employee/:employeeId', async (req, res) => {
  if (req.user!.role === 'EMPLOYEE' && req.user!.id !== req.params.employeeId) throw new AppError('Access denied', 403);
  const loans = await prisma.loan.findMany({
    where: { employeeId: req.params.employeeId },
    include: { repayments: { orderBy: { paidOn: 'desc' } } },
    orderBy: { createdAt: 'desc' },
  });
  res.json({ success: true, data: loans });
});

loanRouter.post('/', requireHR, async (req, res) => {
  const { employeeId, principalAmount, disbursedOn, tenureMonths, emiAmount, purpose } = req.body;
  const loan = await prisma.loan.create({
    data: {
      employeeId, principalAmount, disbursedOn: new Date(disbursedOn),
      tenureMonths, emiAmount, outstandingBalance: principalAmount,
      purpose, approvedBy: req.user!.id, approvedByName: req.user!.name,
    },
  });
  await createAuditLog({ user: req.user!, action: AuditAction.LOAN_CREATE, recordId: loan.id, targetEmployeeId: employeeId, description: `Created loan of ₹${principalAmount} for employee` });
  res.status(201).json({ success: true, data: loan });
});

loanRouter.post('/:id/close', requireHR, async (req, res) => {
  const loan = await prisma.loan.findUnique({ where: { id: req.params.id } });
  if (!loan) throw new AppError('Loan not found', 404);
  const updated = await prisma.loan.update({
    where: { id: req.params.id },
    data: { status: 'CLOSED', closedAt: new Date(), closedBy: req.user!.id, closureNote: req.body.note },
  });
  await createAuditLog({ user: req.user!, action: AuditAction.LOAN_CLOSE, recordId: loan.id, targetEmployeeId: loan.employeeId, description: `Closed loan ${loan.id}` });
  res.json({ success: true, data: updated });
});
