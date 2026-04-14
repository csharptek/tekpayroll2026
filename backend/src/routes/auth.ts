import { Router } from 'express'
import jwt from 'jsonwebtoken'
import jwksClient from 'jwks-rsa'
import { authenticate } from '../middleware/auth'
import { createAuditLog } from '../middleware/audit'
import { AuditAction, UserRole } from '@prisma/client'
import { prisma } from '../utils/prisma'
import { AppError } from '../middleware/errorHandler'

export const authRouter = Router()

// JWKS client
const jwksClientInstance = jwksClient({
  jwksUri: `https://login.microsoftonline.com/${process.env.AZURE_TENANT_ID}/discovery/v2.0/keys`,
  cache: true,
  rateLimit: true,
})

function mapRoles(roles: string[]): UserRole {
  if (roles.includes('Payroll.SuperAdmin')) return UserRole.SUPER_ADMIN
  if (roles.includes('Payroll.HR')) return UserRole.HR
  if (roles.includes('Payroll.Management')) return UserRole.MANAGEMENT
  return UserRole.EMPLOYEE
}

// POST /api/auth/microsoft/callback
// Called after Microsoft SSO redirects back — frontend sends the ID token here
authRouter.post('/microsoft/callback', async (req, res) => {
  const { token } = req.body
  if (!token) throw new AppError('No token provided', 400)

  // Decode to get kid
  const decoded = jwt.decode(token, { complete: true })
  if (!decoded || typeof decoded === 'string') {
    throw new AppError('Invalid token', 401)
  }

  // Get signing key from Microsoft
  const signingKey = await jwksClientInstance.getSigningKey(decoded.header.kid)
  const publicKey = signingKey.getPublicKey()

  // Verify token
  let payload: jwt.JwtPayload
  try {
    payload = jwt.verify(token, publicKey, {
      audience: process.env.AZURE_CLIENT_ID,
      issuer: `https://login.microsoftonline.com/${process.env.AZURE_TENANT_ID}/v2.0`,
    }) as jwt.JwtPayload
  } catch (jwtErr: any) {
    if (jwtErr.name === 'TokenExpiredError') {
      throw new AppError('Session expired. Please sign in again.', 401)
    }
    throw new AppError('Invalid or expired token. Please sign in again.', 401)
  }

  const entraId = payload.oid || payload.sub
  const email   = payload.email || payload.preferred_username || payload.upn
  const name    = payload.name || email
  const roles   = payload.roles || []
  const role    = mapRoles(roles)

  // Find or auto-create employee record
  let employee = await prisma.employee.findFirst({
    where: { OR: [{ entraId }, { email }] },
    include: { profile: { select: { profilePhotoUrl: true } } },
  })

  if (!employee) {
    // Auto-create from Entra ID data if not exists
    // HR can fill in salary details later
    const company = await prisma.company.findFirst()
    if (!company) throw new AppError('Company not configured', 500)

    employee = await prisma.employee.create({
      data: {
        companyId:    company.id,
        entraId,
        employeeCode: `M365-${entraId.slice(0, 8).toUpperCase()}`,
        name,
        email,
        role,
        joiningDate:  new Date(),
        annualCtc:    0,
        status:       'ACTIVE',
      },
    })
  } else {
    // Update entraId and role from latest token
    await prisma.employee.update({
      where: { id: employee.id },
      data:  { entraId, role, name: name || employee.name },
    })
  }

  // Return employee info + the original token (used as Bearer on subsequent requests)
  res.json({
    success: true,
    data: {
      user: {
        id:      employee.id,
        name:    name || employee.name,
        email:   employee.email,
        role:    employee.role,
        entraId: employee.entraId,
        photoUrl: (employee as any).profile?.profilePhotoUrl || null,
      },
      accessToken: token,
    },
  })
})

// GET /api/auth/me
authRouter.get('/me', authenticate, async (req, res) => {
  res.json({ success: true, user: req.user })
})

// POST /api/auth/logout
authRouter.post('/logout', authenticate, async (req, res) => {
  await createAuditLog({
    user: req.user!,
    action: AuditAction.LOGOUT,
    description: `${req.user!.name} logged out`,
  })
  res.json({ success: true })
})

// GET /api/auth/dev-roles — dev only
authRouter.get('/dev-roles', (_req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(404).json({ error: 'Not found' })
  }
  res.json({ available: ['SUPER_ADMIN', 'HR', 'MANAGEMENT', 'EMPLOYEE'] })
})
