import { Router } from 'express';
import { authenticate, requireHR } from '../middleware/auth';
import { prisma } from '../utils/prisma';

export const auditRouter = Router();
auditRouter.use(authenticate, requireHR);

auditRouter.get('/', async (req, res) => {
  const { action, table, employeeId, page = '1', limit = '50' } = req.query;
  const where: any = {};
  if (action) where.action = action;
  if (table) where.tableName = table;
  if (employeeId) where.targetEmployeeId = employeeId;

  const pageNum = parseInt(page as string);
  const limitNum = parseInt(limit as string);

  const [logs, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (pageNum - 1) * limitNum,
      take: limitNum,
    }),
    prisma.auditLog.count({ where }),
  ]);

  res.json({ success: true, data: logs, pagination: { page: pageNum, limit: limitNum, total } });
});
