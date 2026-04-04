import { prisma } from '../utils/prisma'

const EMPLOYER_PF = 21600

// ─── GRAPH TOKEN ─────────────────────────────────────────────────────────────

async function getGraphToken(): Promise<string> {
  const { AZURE_TENANT_ID: tid, AZURE_CLIENT_ID: cid, AZURE_CLIENT_SECRET: sec } = process.env
  if (!tid || !cid || !sec || tid === 'PLACEHOLDER') throw new Error('Azure credentials not configured')

  const res = await fetch(`https://login.microsoftonline.com/${tid}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: cid, client_secret: sec, scope: 'https://graph.microsoft.com/.default', grant_type: 'client_credentials' }).toString(),
  })
  if (!res.ok) { const e = await res.json() as any; throw new Error(`Graph token error: ${(e as any).error_description || (e as any).error}`) }
  return ((await res.json()) as any).access_token
}

// ─── FETCH VERIFIED DOMAINS ───────────────────────────────────────────────────

export async function fetchVerifiedDomains(): Promise<{ name: string; isDefault: boolean; isVerified: boolean }[]> {
  const token = await getGraphToken()

  // Try the Domains API first (requires Domain.Read.All permission)
  const res = await fetch('https://graph.microsoft.com/v1.0/domains', {
    headers: { Authorization: `Bearer ${token}` },
  })

  if (res.ok) {
    const data = await res.json() as any
    return (data.value || [])
      .filter((d: any) => d.isVerified)
      .map((d: any) => ({ name: d.id, isDefault: d.isDefault, isVerified: d.isVerified }))
  }

  // Fallback: extract unique domains from tenant users (requires User.Read.All only)
  console.warn('[SYNC] Domain.Read.All not available, falling back to user UPN extraction')
  const usersRes = await fetch(
    'https://graph.microsoft.com/v1.0/users?$select=userPrincipalName&$top=100',
    { headers: { Authorization: `Bearer ${token}` } }
  )

  if (!usersRes.ok) {
    const errData = await usersRes.json() as any
    throw new Error(`Failed to fetch domains or users: ${errData?.error?.message || errData?.error?.code || usersRes.status}`)
  }

  const usersData = await usersRes.json() as any
  const domainSet = new Set<string>()

  for (const user of (usersData.value || [])) {
    const upn = user.userPrincipalName || ''
    if (upn.includes('@') && !upn.includes('#EXT#')) {
      domainSet.add(upn.split('@')[1].toLowerCase())
    }
  }

  return Array.from(domainSet).map(domain => ({
    name: domain,
    isDefault: false,
    isVerified: true,
  }))
}

// ─── GET SERVICE PRINCIPAL ID ─────────────────────────────────────────────────

async function getServicePrincipalId(token: string): Promise<string | null> {
  const appId = process.env.AZURE_CLIENT_ID
  const res = await fetch(
    `https://graph.microsoft.com/v1.0/servicePrincipals?$filter=appId eq '${appId}'&$select=id,appRoles`,
    { headers: { Authorization: `Bearer ${token}` } }
  )
  if (!res.ok) return null
  const data = await res.json() as any
  return data.value?.[0]?.id || null
}

// ─── FETCH APP ROLE ASSIGNMENTS ───────────────────────────────────────────────

async function fetchRoleAssignments(token: string, spId: string): Promise<Record<string, string>> {
  // Returns: { userId -> roleValue }
  const roleMap: Record<string, string> = {}

  // Get role definitions from SP
  const spRes = await fetch(
    `https://graph.microsoft.com/v1.0/servicePrincipals/${spId}?$select=appRoles`,
    { headers: { Authorization: `Bearer ${token}` } }
  )
  const spData = await spRes.json() as any
  const roleDefs: Record<string, string> = {}
  for (const r of (spData.appRoles || [])) {
    roleDefs[r.id] = r.value
  }

  // Get assignments
  const assignRes = await fetch(
    `https://graph.microsoft.com/v1.0/servicePrincipals/${spId}/appRoleAssignedTo?$top=999`,
    { headers: { Authorization: `Bearer ${token}` } }
  )
  const assignData = await assignRes.json() as any
  for (const a of (assignData.value || [])) {
    roleMap[a.principalId] = roleDefs[a.appRoleId] || 'Payroll.Employee'
  }

  return roleMap
}

// ─── FETCH USERS FROM SELECTED DOMAINS ────────────────────────────────────────

async function fetchUsersByDomains(token: string, domains: string[]): Promise<any[]> {
  const fields = 'id,displayName,mail,userPrincipalName,jobTitle,department,mobilePhone,accountEnabled,employeeId,officeLocation'
  const allUsers: any[] = []

  for (const domain of domains) {
    let url: string | null =
      `https://graph.microsoft.com/v1.0/users?$filter=endsWith(userPrincipalName,'@${domain}')&$select=${fields}&$top=100`

    while (url) {
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      if (!res.ok) { console.error(`[SYNC] Failed to fetch users for domain ${domain}`); break }
      const data = await res.json() as any
      allUsers.push(...(data.value || []))
      url = data['@odata.nextLink'] || null
    }
  }

  // Deduplicate by id
  const seen = new Set<string>()
  return allUsers.filter(u => { if (seen.has(u.id)) return false; seen.add(u.id); return true })
}

// ─── MAP ENTRA ROLE → USER ROLE ───────────────────────────────────────────────

function mapRole(roleValue: string | undefined): string {
  const map: Record<string, string> = {
    'Payroll.SuperAdmin': 'SUPER_ADMIN',
    'Payroll.HR':         'HR',
    'Payroll.Management': 'MANAGEMENT',
    'Payroll.Employee':   'EMPLOYEE',
  }
  return map[roleValue || ''] || 'EMPLOYEE'
}

// ─── PREVIEW (fetch users, don't save) ────────────────────────────────────────

export interface PreviewUser {
  entraId:        string
  displayName:    string
  email:          string
  jobTitle:       string | null
  department:     string | null
  accountEnabled: boolean
  entraRole:      string | null  // Payroll.SuperAdmin etc
  payrollRole:    string         // SUPER_ADMIN etc

  // DB status
  status:         'NEW' | 'UPDATE' | 'NO_CHANGE'
  existingId:     string | null  // DB employee id if exists

  // Editable fields (pre-filled, HR can change before import)
  employeeCode:   string
  joiningDate:    string | null  // ISO date string
  state:          string | null
}

export async function fetchPreview(domains: string[]): Promise<PreviewUser[]> {
  const token = await getGraphToken()
  const spId  = await getServicePrincipalId(token)
  const roleMap = spId ? await fetchRoleAssignments(token, spId) : {}

  const graphUsers = await fetchUsersByDomains(token, domains)

  const results: PreviewUser[] = []

  for (const gu of graphUsers) {
    const email    = gu.mail || gu.userPrincipalName
    if (!email || gu.userPrincipalName?.includes('#EXT#')) continue

    const entraRole   = roleMap[gu.id] || null
    const payrollRole = mapRole(entraRole || undefined)

    // Check if exists in DB
    const existing = await prisma.employee.findFirst({
      where: { OR: [{ entraId: gu.id }, { email }] },
      select: { id: true, name: true, employeeCode: true, entraId: true, joiningDate: true, state: true, status: true },
    })

    let status: 'NEW' | 'UPDATE' | 'NO_CHANGE' = 'NEW'
    if (existing) {
      const nameChanged = existing.name !== gu.displayName
      status = nameChanged || !existing.entraId ? 'UPDATE' : 'NO_CHANGE'
    }

    results.push({
      entraId:        gu.id,
      displayName:    gu.displayName,
      email,
      jobTitle:       gu.jobTitle || null,
      department:     gu.department || null,
      accountEnabled: gu.accountEnabled !== false,
      entraRole,
      payrollRole,
      status,
      existingId:     existing?.id || null,
      employeeCode:   existing?.employeeCode || gu.employeeId || `M365-${gu.id.slice(0, 8).toUpperCase()}`,
      joiningDate:    existing?.joiningDate?.toISOString().split('T')[0] || null,
      state:          existing?.state || null,
    })
  }

  return results
}

// ─── IMPORT SELECTED USERS ────────────────────────────────────────────────────

export interface ImportRow {
  entraId:        string
  displayName:    string
  email:          string
  jobTitle:       string | null
  department:     string | null
  employeeCode:   string
  payrollRole:    string
  joiningDate:    string | null
  state:          string | null
  accountEnabled: boolean
  existingId:     string | null
  entraRole:      string | null
}

export async function importSelected(rows: ImportRow[], triggeredBy: string): Promise<{
  added: number; updated: number; errors: { email: string; error: string }[]
}> {
  const company = await prisma.company.findFirst()
  if (!company) throw new Error('Company not configured')

  let added = 0, updated = 0
  const errors: { email: string; error: string }[] = []

  for (const row of rows) {
    try {
      const role = row.payrollRole as any
      const joining = row.joiningDate ? new Date(row.joiningDate) : new Date()

      if (row.existingId) {
        // Update existing
        await prisma.employee.update({
          where: { id: row.existingId },
          data: {
            entraId:      row.entraId,
            name:         row.displayName,
            email:        row.email,
            jobTitle:     row.jobTitle,
            department:   row.department,
            employeeCode: row.employeeCode,
            role,
            joiningDate:  joining,
            state:        row.state,
            status:       row.accountEnabled ? undefined : 'INACTIVE',
          },
        })
        updated++
      } else {
        // Create new
        await prisma.employee.create({
          data: {
            companyId:    company.id,
            entraId:      row.entraId,
            employeeCode: row.employeeCode,
            name:         row.displayName,
            email:        row.email,
            jobTitle:     row.jobTitle,
            department:   row.department,
            role,
            joiningDate:  joining,
            state:        row.state,
            annualCtc:    0,  // HR must set salary separately
            status:       row.accountEnabled ? 'ACTIVE' : 'INACTIVE',
          },
        })
        added++
      }

      // Assign Payroll App Role in Entra ID for new employees
      if (!row.existingId && row.entraRole === null) {
        await assignPayrollRole(row.entraId, row.payrollRole).catch((e: any) =>
          console.error(`[SYNC] Role assignment failed for ${row.email}:`, e.message)
        )
      }
    } catch (err: any) {
      errors.push({ email: row.email, error: err.message })
    }
  }

  return { added, updated, errors }
}

// ─── ASSIGN PAYROLL ROLE IN ENTRA ─────────────────────────────────────────────

async function assignPayrollRole(userId: string, payrollRole: string): Promise<void> {
  const token = await getGraphToken()
  const spId  = await getServicePrincipalId(token)
  if (!spId) throw new Error('Service principal not found')

  // Get app role id
  const spRes  = await fetch(`https://graph.microsoft.com/v1.0/servicePrincipals/${spId}?$select=appRoles`, { headers: { Authorization: `Bearer ${token}` } })
  const spData = await spRes.json() as any

  const roleValueMap: Record<string, string> = {
    SUPER_ADMIN: 'Payroll.SuperAdmin',
    HR:          'Payroll.HR',
    MANAGEMENT:  'Payroll.Management',
    EMPLOYEE:    'Payroll.Employee',
  }
  const targetValue = roleValueMap[payrollRole] || 'Payroll.Employee'
  const appRole = (spData.appRoles || []).find((r: any) => r.value === targetValue)
  if (!appRole) throw new Error(`App role ${targetValue} not found`)

  await fetch(`https://graph.microsoft.com/v1.0/servicePrincipals/${spId}/appRoleAssignedTo`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ principalId: userId, resourceId: spId, appRoleId: appRole.id }),
  })
}

// ─── PUSH TO ENTRA (writeback) ────────────────────────────────────────────────
// SAFE: only writes extension attributes, never deletes or disables

export async function pushToEntra(employeeIds: string[]): Promise<{
  success: number; failed: number; errors: { name: string; error: string }[]
}> {
  const token = await getGraphToken()
  const appId = process.env.AZURE_CLIENT_ID!.replace(/-/g, '')  // extension attr prefix

  const employees = await prisma.employee.findMany({
    where: { id: { in: employeeIds }, entraId: { not: null } },
    select: { id: true, name: true, entraId: true, employeeCode: true, joiningDate: true, state: true },
  })

  let success = 0, failed = 0
  const errors: { name: string; error: string }[] = []

  for (const emp of employees) {
    try {
      const body: Record<string, any> = {
        [`extension_${appId}_employeeCode`]: emp.employeeCode,
        [`extension_${appId}_joiningDate`]:  emp.joiningDate?.toISOString().split('T')[0] || null,
        [`extension_${appId}_state`]:         emp.state || null,
      }
      // Remove nulls
      for (const key of Object.keys(body)) {
        if (body[key] === null) delete body[key]
      }

      const res = await fetch(`https://graph.microsoft.com/v1.0/users/${emp.entraId}`, {
        method:  'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
      })

      if (!res.ok) {
        const err = await res.json() as any
        throw new Error(err.error?.message || `HTTP ${res.status}`)
      }
      success++
    } catch (err: any) {
      failed++
      errors.push({ name: emp.name, error: err.message })
    }
  }

  return { success, failed, errors }
}

// ─── CREATE USER IN ENTRA ID ─────────────────────────────────────────────────

export async function createEntraUser(params: {
  displayName: string
  email:       string
  jobTitle?:   string | null
  department?: string | null
  payrollRole: string
}): Promise<string> {
  const token = await getGraphToken()

  const domain    = params.email.split('@')[1]
  const mailNick  = params.email.split('@')[0].replace(/[^a-zA-Z0-9]/g, '')
  const tempPass  = `CSharpTek@${new Date().getFullYear()}`

  const body = {
    displayName:       params.displayName,
    mailNickname:      mailNick,
    userPrincipalName: params.email,
    mail:              params.email,
    jobTitle:          params.jobTitle || undefined,
    department:        params.department || undefined,
    accountEnabled:    true,
    passwordProfile: {
      forceChangePasswordNextSignIn: true,
      password: tempPass,
    },
    usageLocation: 'IN',
  }

  const res = await fetch('https://graph.microsoft.com/v1.0/users', {
    method:  'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  })

  if (!res.ok) {
    const err = await res.json() as any
    throw new Error(`Failed to create Entra user: ${err.error?.message || JSON.stringify(err)}`)
  }

  const created = await res.json() as any
  const entraId = created.id

  // Assign payroll role
  await assignPayrollRole(entraId, params.payrollRole).catch((e: any) =>
    console.warn(`[SYNC] Role assignment failed for new user:`, e.message)
  )

  return entraId
}

// ─── FULL SYNC (for cron) ─────────────────────────────────────────────────────

export async function syncEntraUsers(triggeredBy?: string, triggeredByName?: string) {
  // Get enabled domains from DB config
  const domainConfigs = await prisma.syncDomainConfig.findMany({ where: { isEnabled: true } })
  if (domainConfigs.length === 0) {
    return { added: 0, updated: 0, deactivated: 0, skipped: 0, errors: ['No domains configured for sync'] }
  }

  const domains  = domainConfigs.map(d => d.domain)
  const preview  = await fetchPreview(domains)
  const toImport = preview.filter(u => u.status === 'NEW' || u.status === 'UPDATE')

  const result = await importSelected(toImport, triggeredBy || 'cron')
  return { added: result.added, updated: result.updated, deactivated: 0, skipped: preview.filter(u => u.status === 'NO_CHANGE').length, errors: result.errors.map(e => `${e.email}: ${e.error}`) }
}
