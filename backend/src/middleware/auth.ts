import { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import jwksClient from 'jwks-rsa'
import { UserRole } from '@prisma/client'
import { AppError } from './errorHandler'

export interface AuthUser {
  id: string
  name: string
  email: string
  role: UserRole
  entraId?: string
  photoUrl?: string | null
}

declare global {
  namespace Express {
    interface Request { user?: AuthUser }
  }
}

const jwksClientInstance = jwksClient({
  jwksUri: `https://login.microsoftonline.com/${process.env.AZURE_TENANT_ID}/discovery/v2.0/keys`,
  cache: true,
  rateLimit: true,
})

function mapEntraRoleToUserRole(roles: string[]): UserRole {
  if (roles.includes('Payroll.SuperAdmin')) return UserRole.SUPER_ADMIN
  if (roles.includes('Payroll.HR'))         return UserRole.HR
  if (roles.includes('Payroll.Management')) return UserRole.MANAGEMENT
  return UserRole.EMPLOYEE
}

// ─── DEV BYPASS ──────────────────────────────────────────────────────────────
// Only works when DEV_AUTH_BYPASS=true AND NODE_ENV != production
function handleDevBypass(req: Request): AuthUser | null {
  if (process.env.DEV_AUTH_BYPASS !== 'true') return null
  if (process.env.NODE_ENV === 'production')   return null

  const devRole   = req.headers['x-dev-role']    as string
  const devUserId = req.headers['x-dev-user-id'] as string
  if (!devRole || !devUserId) return null

  const roleMap: Record<string, UserRole> = {
    SUPER_ADMIN: UserRole.SUPER_ADMIN,
    HR:          UserRole.HR,
    MANAGEMENT:  UserRole.MANAGEMENT,
    EMPLOYEE:    UserRole.EMPLOYEE,
  }

  return {
    id:    devUserId,
    name:  `Dev ${devRole}`,
    email: `dev.${devRole.toLowerCase()}@csharptek.com`,
    role:  roleMap[devRole] || UserRole.EMPLOYEE,
  }
}

// ─── TOKEN CACHE ─────────────────────────────────────────────────────────────
// Avoids hitting DB on every request. Cache keyed by token, TTL = token expiry.
interface CachedAuth {
  user: AuthUser
  expiresAt: number
}
const tokenCache = new Map<string, CachedAuth>()

// Purge expired entries periodically
setInterval(() => {
  const now = Date.now()
  for (const [key, val] of tokenCache.entries()) {
    if (val.expiresAt <= now) tokenCache.delete(key)
  }
}, 5 * 60 * 1000) // every 5 minutes

// ─── MSAL TOKEN VALIDATION ────────────────────────────────────────────────────
async function validateMsalToken(token: string): Promise<AuthUser> {
  // Return cached result if still valid (with 60s buffer)
  const cached = tokenCache.get(token)
  if (cached && cached.expiresAt > Date.now() + 60_000) {
    return cached.user
  }

  const decoded = jwt.decode(token, { complete: true })
  if (!decoded || typeof decoded === 'string') {
    throw new AppError('Invalid token format', 401, 'INVALID_TOKEN')
  }

  const signingKey = await jwksClientInstance.getSigningKey(decoded.header.kid)
  const publicKey  = signingKey.getPublicKey()

  const payload = jwt.verify(token, publicKey, {
    audience: process.env.AZURE_CLIENT_ID,
    issuer:   `https://login.microsoftonline.com/${process.env.AZURE_TENANT_ID}/v2.0`,
  }) as jwt.JwtPayload

  const entraId = payload.oid || payload.sub
  const email   = payload.email || payload.preferred_username || ''
  const roles   = payload.roles || []
  const role    = mapEntraRoleToUserRole(roles)

  const { prisma } = await import('../utils/prisma')

  // Find by entraId first, then by email as fallback
  let employee = await prisma.employee.findFirst({
    where: { OR: [{ entraId }, { email }] },
  })

  if (!employee) {
    // Auto-create from Entra ID data
    const company = await prisma.company.findFirst()
    if (!company) throw new AppError('Company not configured', 500)

    employee = await prisma.employee.create({
      data: {
        companyId:    company.id,
        entraId,
        employeeCode: `M365-${entraId.slice(0, 8).toUpperCase()}`,
        name:         payload.name || email,
        email,
        role,
        joiningDate:  new Date(),
        annualCtc:    0,
        status:       'ACTIVE',
      },
    })
  } else if (!employee.entraId || employee.entraId !== entraId) {
    // Only update when entraId needs linking — avoid unnecessary writes
    await prisma.employee.update({
      where: { id: employee.id },
      data:  { entraId, role, name: payload.name || employee.name },
    })
  }

  const user: AuthUser = {
    id:      employee.id,
    name:    payload.name || employee.name,
    email:   employee.email,
    role:    employee.role,
    entraId: employee.entraId || entraId,
    photoUrl: (employee as any).profilePhotoUrl || null,
  }

  // Cache until token expiry
  const expiresAt = (payload.exp || 0) * 1000
  if (expiresAt > Date.now()) {
    tokenCache.set(token, { user, expiresAt })
  }

  return user
}

// ─── MAIN MIDDLEWARE ──────────────────────────────────────────────────────────
export async function authenticate(req: Request, _res: Response, next: NextFunction) {
  try {
    const devUser = handleDevBypass(req)
    if (devUser) { req.user = devUser; return next() }

    const authHeader = req.headers.authorization
    if (!authHeader?.startsWith('Bearer ')) {
      throw new AppError('Authentication required', 401, 'NO_TOKEN')
    }

    const token = authHeader.split(' ')[1]
    req.user = await validateMsalToken(token)
    next()
  } catch (err: any) {
    // Surface the real JWT/MSAL error instead of a generic NO_TOKEN
    if (err instanceof AppError) return next(err)

    if (err.name === 'TokenExpiredError') {
      return next(new AppError('Session expired. Please sign in again.', 401, 'TOKEN_EXPIRED'))
    }
    if (err.name === 'JsonWebTokenError') {
      return next(new AppError(`Invalid token: ${err.message}`, 401, 'INVALID_TOKEN'))
    }
    if (err.name === 'SigningKeyNotFoundError' || err.code === 'ECONNREFUSED') {
      return next(new AppError('Auth service unavailable. Please try again.', 503, 'AUTH_UNAVAILABLE'))
    }

    console.error('[AUTH] Unexpected auth error:', err.name, err.message)
    return next(new AppError('Authentication failed', 401, 'AUTH_FAILED'))
  }
}

// ─── ROLE GUARDS ─────────────────────────────────────────────────────────────
export function requireRole(...roles: UserRole[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(new AppError('Authentication required', 401, 'NO_TOKEN'))
    if (!roles.includes(req.user.role)) return next(new AppError('Access denied', 403, 'FORBIDDEN'))
    next()
  }
}

export const requireHR         = requireRole(UserRole.HR, UserRole.SUPER_ADMIN)
export const requireManagement = requireRole(UserRole.MANAGEMENT, UserRole.HR, UserRole.SUPER_ADMIN)
export const requireSuperAdmin = requireRole(UserRole.SUPER_ADMIN)
export const requireAny        = authenticate
