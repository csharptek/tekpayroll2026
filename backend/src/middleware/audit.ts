import { AuditAction, UserRole } from '@prisma/client';
import { prisma } from '../utils/prisma';
import { AuthUser } from './auth';

interface AuditParams {
  user: AuthUser;
  action: AuditAction;
  tableName?: string;
  recordId?: string;
  targetEmployeeId?: string;
  previousValue?: object;
  newValue?: object;
  description?: string;
  ipAddress?: string;
}

export async function createAuditLog(params: AuditParams) {
  try {
    await prisma.auditLog.create({
      data: {
        performedById: params.user.id,
        performedByName: params.user.name,
        performedByRole: params.user.role as UserRole,
        action: params.action,
        tableName: params.tableName,
        recordId: params.recordId,
        targetEmployeeId: params.targetEmployeeId,
        previousValue: params.previousValue as any,
        newValue: params.newValue as any,
        description: params.description,
        ipAddress: params.ipAddress,
      },
    });
  } catch (err) {
    // Audit log failure should never break the main operation
    console.error('[AUDIT] Failed to create audit log:', err);
  }
}
