import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import jwksClient from 'jwks-rsa';
import { UserRole } from '@prisma/client';
import { AppError } from './errorHandler';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  entraId?: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

// JWKS client for validating Microsoft tokens
const jwksClientInstance = jwksClient({
  jwksUri: `https://login.microsoftonline.com/${process.env.AZURE_TENANT_ID}/discovery/v2.0/keys`,
  cache: true,
  rateLimit: true,
});

// Map Entra ID App Role claims to our UserRole enum
function mapEntraRoleToUserRole(roles: string[]): UserRole {
  if (roles.includes('Payroll.SuperAdmin')) return UserRole.SUPER_ADMIN;
  if (roles.includes('Payroll.HR')) return UserRole.HR;
  if (roles.includes('Payroll.Management')) return UserRole.MANAGEMENT;
  if (roles.includes('Payroll.Employee')) return UserRole.EMPLOYEE;
  return UserRole.EMPLOYEE;
}

// ─── DEV BYPASS ──────────────────────────────────────────────────────────────
// In development, frontend sends X-Dev-Role header instead of a real token.
// This is disabled in production automatically.
function handleDevBypass(req: Request): AuthUser | null {
  if (process.env.DEV_AUTH_BYPASS !== 'true') return null;
  if (process.env.NODE_ENV === 'production') return null;

  const devRole = req.headers['x-dev-role'] as string;
  const devUserId = req.headers['x-dev-user-id'] as string;

  if (!devRole || !devUserId) return null;

  const roleMap: Record<string, UserRole> = {
    'SUPER_ADMIN': UserRole.SUPER_ADMIN,
    'HR': UserRole.HR,
    'MANAGEMENT': UserRole.MANAGEMENT,
    'EMPLOYEE': UserRole.EMPLOYEE,
  };

  return {
    id: devUserId,
    name: `Dev ${devRole}`,
    email: `dev.${devRole.toLowerCase()}@csharptek.com`,
    role: roleMap[devRole] || UserRole.EMPLOYEE,
  };
}

// ─── REAL MSAL TOKEN VALIDATION ──────────────────────────────────────────────
async function validateMsalToken(token: string): Promise<AuthUser> {
  const decoded = jwt.decode(token, { complete: true });
  if (!decoded || typeof decoded === 'string') {
    throw new AppError('Invalid token format', 401, 'INVALID_TOKEN');
  }

  const kid = decoded.header.kid;
  const signingKey = await jwksClientInstance.getSigningKey(kid);
  const publicKey = signingKey.getPublicKey();

  const payload = jwt.verify(token, publicKey, {
    audience: process.env.AZURE_CLIENT_ID,
    issuer: `https://login.microsoftonline.com/${process.env.AZURE_TENANT_ID}/v2.0`,
  }) as jwt.JwtPayload;

  const roles: string[] = payload.roles || [];
  const role = mapEntraRoleToUserRole(roles);

  // Look up employee in DB by entraId
  const { prisma } = await import('../utils/prisma');
  const employee = await prisma.employee.findUnique({
    where: { entraId: payload.oid },
  });

  if (!employee) {
    throw new AppError('Employee not found in payroll system. Contact HR.', 403, 'NOT_REGISTERED');
  }

  return {
    id: employee.id,
    name: employee.name,
    email: employee.email,
    role,
    entraId: payload.oid,
  };
}

// ─── MAIN AUTH MIDDLEWARE ─────────────────────────────────────────────────────
export async function authenticate(
  req: Request,
  _res: Response,
  next: NextFunction
) {
  try {
    // Try dev bypass first
    const devUser = handleDevBypass(req);
    if (devUser) {
      req.user = devUser;
      return next();
    }

    // Extract Bearer token
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      throw new AppError('Authentication required', 401, 'NO_TOKEN');
    }

    const token = authHeader.split(' ')[1];
    req.user = await validateMsalToken(token);
    next();
  } catch (err) {
    next(err);
  }
}

// ─── ROLE GUARDS ─────────────────────────────────────────────────────────────
export function requireRole(...roles: UserRole[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) {
      return next(new AppError('Authentication required', 401, 'NO_TOKEN'));
    }
    if (!roles.includes(req.user.role)) {
      return next(new AppError('You do not have permission to access this resource.', 403, 'FORBIDDEN'));
    }
    next();
  };
}

export const requireHR = requireRole(UserRole.HR, UserRole.SUPER_ADMIN);
export const requireManagement = requireRole(UserRole.MANAGEMENT, UserRole.HR, UserRole.SUPER_ADMIN);
export const requireSuperAdmin = requireRole(UserRole.SUPER_ADMIN);
export const requireAny = authenticate;
