import { Router } from 'express'
import { authenticate, requireHR, requireManagement, requireAny } from '../middleware/auth'
import { prisma } from '../utils/prisma'
import { AppError } from '../middleware/errorHandler'
import { z } from 'zod'
import {
  sendAssetAssignedEmail,
  sendAssetReturnedEmail,
  sendAssetRequestStatusEmail,
} from '../services/assetService'
import multer from 'multer'
import * as XLSX from 'xlsx'

const AssetStatus = { AVAILABLE: 'AVAILABLE', ASSIGNED: 'ASSIGNED', UNDER_REPAIR: 'UNDER_REPAIR', RETIRED: 'RETIRED' } as const
const AssetCategory = { IT: 'IT', PHYSICAL: 'PHYSICAL' } as const
const AssetCondition = { GOOD: 'GOOD', DAMAGED: 'DAMAGED', LOST: 'LOST' } as const
const AssetRequestType = { NEEDED: 'NEEDED', RETURN: 'RETURN' } as const
const AssetRequestStatus = { PENDING: 'PENDING', APPROVED: 'APPROVED', REJECTED: 'REJECTED' } as const

export const assetRouter = Router()
assetRouter.use(authenticate)

const upload = multer({ storage: multer.memoryStorage() })

// ─── CONFIGURATOR ─────────────────────────────────────────────────────────────

// GET /api/assets/config/categories
assetRouter.get('/config/categories', requireManagement, async (req, res, next) => {
  try {
    const categories = await prisma.assetCategoryConfig.findMany({
      where: { isActive: true },
      include: { subCategories: { where: { isActive: true } } },
      orderBy: { name: 'asc' },
    })
    res.json(categories)
  } catch (e) { next(e) }
})

// POST /api/assets/config/categories
assetRouter.post('/config/categories', requireHR, async (req, res, next) => {
  try {
    const { name, type } = z.object({
      name: z.string().min(1),
      type: z.enum(['IT', 'PHYSICAL']),
    }).parse(req.body)

    const existing = await prisma.assetCategoryConfig.findUnique({ where: { name_type: { name, type } } })
    if (existing) {
      if (!existing.isActive) {
        const restored = await prisma.assetCategoryConfig.update({ where: { id: existing.id }, data: { isActive: true } })
        return res.json(restored)
      }
      throw new AppError('Category already exists', 400)
    }
    const cat = await prisma.assetCategoryConfig.create({ data: { name, type } })
    res.status(201).json(cat)
  } catch (e) { next(e) }
})

// PUT /api/assets/config/categories/:id
assetRouter.put('/config/categories/:id', requireHR, async (req, res, next) => {
  try {
    const { name } = z.object({ name: z.string().min(1) }).parse(req.body)
    const cat = await prisma.assetCategoryConfig.update({
      where: { id: req.params.id },
      data: { name },
    })
    res.json(cat)
  } catch (e) { next(e) }
})

// DELETE /api/assets/config/categories/:id
assetRouter.delete('/config/categories/:id', requireHR, async (req, res, next) => {
  try {
    await prisma.assetCategoryConfig.update({
      where: { id: req.params.id },
      data: { isActive: false },
    })
    res.json({ message: 'Category deactivated' })
  } catch (e) { next(e) }
})

// POST /api/assets/config/subcategories
assetRouter.post('/config/subcategories', requireHR, async (req, res, next) => {
  try {
    const { name, categoryId } = z.object({
      name: z.string().min(1),
      categoryId: z.string().min(1),
    }).parse(req.body)

    const existing = await prisma.assetSubCategoryConfig.findUnique({
      where: { name_categoryId: { name, categoryId } },
    })
    if (existing) {
      if (!existing.isActive) {
        const restored = await prisma.assetSubCategoryConfig.update({ where: { id: existing.id }, data: { isActive: true } })
        return res.json(restored)
      }
      throw new AppError('Sub-category already exists', 400)
    }
    const sub = await prisma.assetSubCategoryConfig.create({ data: { name, categoryId } })
    res.status(201).json(sub)
  } catch (e) { next(e) }
})

// PUT /api/assets/config/subcategories/:id
assetRouter.put('/config/subcategories/:id', requireHR, async (req, res, next) => {
  try {
    const { name } = z.object({ name: z.string().min(1) }).parse(req.body)
    const sub = await prisma.assetSubCategoryConfig.update({
      where: { id: req.params.id },
      data: { name },
    })
    res.json(sub)
  } catch (e) { next(e) }
})

// DELETE /api/assets/config/subcategories/:id
assetRouter.delete('/config/subcategories/:id', requireHR, async (req, res, next) => {
  try {
    await prisma.assetSubCategoryConfig.update({
      where: { id: req.params.id },
      data: { isActive: false },
    })
    res.json({ message: 'Sub-category deactivated' })
  } catch (e) { next(e) }
})

// ─── ASSETS ───────────────────────────────────────────────────────────────────

const assetSchema = z.object({
  assetCode: z.string().optional().nullable(),
  name: z.string().min(1),
  categoryId: z.string().min(1),
  subCategoryId: z.string().optional().nullable(),
  brand: z.string().optional().nullable(),
  model: z.string().optional().nullable(),
  serialNumber: z.string().optional().nullable(),
  purchaseDate: z.string().optional().nullable(),
  warrantyExpiry: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
})

// Derive 3-letter prefix from sub-category (or category) name
function derivePrefix(name: string): string {
  const overrides: Record<string, string> = {
    'laptop': 'LAP', 'desktop': 'DSK', 'monitor': 'MON', 'keyboard': 'KBD',
    'mouse': 'MSE', 'headphone': 'HPH', 'webcam': 'WCM', 'cpu': 'CPU',
    'hard disk': 'HDD', 'ssd': 'SSD', 'usb cable': 'USB', 'usb wifi dongle': 'UWD',
    'printer': 'PRN', 'scanner': 'SCN', 'router': 'RTR', 'switch': 'SWH',
    'server': 'SRV', 'ups': 'UPS', 'projector': 'PRJ', 'phone': 'PHN',
    'tablet': 'TAB', 'ipod': 'IPD', 'sim card': 'SIM', 'power bank': 'PWB',
    'os license': 'OSL', 'office suite': 'OFF', 'antivirus': 'AV', 'ide license': 'IDE',
    'chair': 'CHR', 'desk': 'DSK', 'cabinet': 'CAB', 'locker': 'LKR',
    'sofa': 'SOF', 'whiteboard': 'WBD', 'telephone': 'TEL', 'stapler': 'STP',
    'shredder': 'SHR', 'calculator': 'CAL', 'ac': 'AC', 'refrigerator': 'RFR',
    'microwave': 'MW', 'water dispenser': 'WTR', 'notebook': 'NTB', 'pen set': 'PEN',
    'file organizer': 'FLO', 'car': 'CAR', 'bike': 'BIK', 'scooter': 'SCT',
    'id card': 'IDC', 'access card': 'ACC', 'key': 'KEY', 'cctv camera': 'CCT',
  }
  const key = name.trim().toLowerCase()
  if (overrides[key]) return overrides[key]
  // Fallback: first letters of words, capped at 3
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length >= 2) return (words[0][0] + words[1][0] + (words[2]?.[0] || '')).toUpperCase().slice(0, 3)
  return name.trim().replace(/[^A-Za-z]/g, '').toUpperCase().slice(0, 3) || 'AST'
}

// Generate next unique asset code for a given prefix
async function nextAssetCode(prefix: string): Promise<string> {
  const pattern = `CT-${prefix}-`
  const existing = await prisma.asset.findMany({
    where: { assetCode: { startsWith: pattern } },
    select: { assetCode: true },
  })
  let maxNum = 0
  for (const a of existing) {
    const m = a.assetCode.match(new RegExp(`^CT-${prefix}-(\\d+)([A-Z]?)$`))
    if (m) {
      const n = parseInt(m[1], 10)
      if (n > maxNum) maxNum = n
    }
  }
  let next = maxNum + 1
  // Collision guard
  while (true) {
    const code = `CT-${prefix}-${String(next).padStart(3, '0')}`
    const hit = await prisma.asset.findUnique({ where: { assetCode: code } })
    if (!hit) return code
    next++
  }
}

// GET /api/assets
assetRouter.get('/', requireManagement, async (req, res, next) => {
  try {
    const { status, categoryId, search } = req.query as Record<string, string>
    const where: any = {}
    if (status) where.status = status as any
    if (categoryId) where.categoryId = categoryId
    if (search) where.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { assetCode: { contains: search, mode: 'insensitive' } },
      { serialNumber: { contains: search, mode: 'insensitive' } },
    ]

    const assets = await prisma.asset.findMany({
      where,
      include: {
        category: true,
        subCategory: true,
        assignments: {
          where: { isActive: true },
          include: { employee: { select: { id: true, name: true, employeeCode: true, department: true } } },
        },
      },
      orderBy: { createdAt: 'desc' },
    })
    res.json(assets)
  } catch (e) { next(e) }
})

// GET /api/assets/my  (employee self)
assetRouter.get('/my', requireAny, async (req, res, next) => {
  try {
    const user = (req as any).user
    const employee = await prisma.employee.findFirst({ where: { email: user.email } })
    if (!employee) throw new AppError('Employee not found', 404)

    const assignments = await prisma.assetAssignment.findMany({
      where: { employeeId: employee.id, isActive: true },
      include: { asset: { include: { category: true, subCategory: true } } },
      orderBy: { assignedDate: 'desc' },
    })
    res.json(assignments)
  } catch (e) { next(e) }
})

// GET /api/assets/employee/:employeeId
assetRouter.get('/employee/:employeeId', requireManagement, async (req, res, next) => {
  try {
    const assignments = await prisma.assetAssignment.findMany({
      where: { employeeId: req.params.employeeId },
      include: { asset: { include: { category: true, subCategory: true } } },
      orderBy: { assignedDate: 'desc' },
    })
    res.json(assignments)
  } catch (e) { next(e) }
})

// GET /api/assets/:id
assetRouter.get('/:id', requireManagement, async (req, res, next) => {
  try {
    const asset = await prisma.asset.findUnique({
      where: { id: req.params.id },
      include: {
        category: true,
        subCategory: true,
        assignments: {
          include: { employee: { select: { id: true, name: true, employeeCode: true, department: true } } },
          orderBy: { assignedDate: 'desc' },
        },
      },
    })
    if (!asset) throw new AppError('Asset not found', 404)
    res.json(asset)
  } catch (e) { next(e) }
})

// POST /api/assets
assetRouter.post('/', requireHR, async (req, res, next) => {
  try {
    const data = assetSchema.parse(req.body)
    let assetCode = (data.assetCode || '').trim()

    if (!assetCode) {
      // Auto-generate from sub-category (preferred) or category
      let sourceName = ''
      if (data.subCategoryId) {
        const sub = await prisma.assetSubCategoryConfig.findUnique({ where: { id: data.subCategoryId } })
        if (sub) sourceName = sub.name
      }
      if (!sourceName) {
        const cat = await prisma.assetCategoryConfig.findUnique({ where: { id: data.categoryId } })
        if (cat) sourceName = cat.name
      }
      if (!sourceName) throw new AppError('Cannot auto-generate code — category/sub-category missing', 400)
      const prefix = derivePrefix(sourceName)
      assetCode = await nextAssetCode(prefix)
    } else {
      const exists = await prisma.asset.findUnique({ where: { assetCode } })
      if (exists) throw new AppError('Asset code already exists', 400)
    }

    const { assetCode: _omit, ...rest } = data
    const asset = await prisma.asset.create({
      data: {
        ...rest,
        assetCode,
        purchaseDate: data.purchaseDate ? new Date(data.purchaseDate) : null,
        warrantyExpiry: data.warrantyExpiry ? new Date(data.warrantyExpiry) : null,
        status: AssetStatus.AVAILABLE,
      },
      include: { category: true, subCategory: true },
    })
    res.status(201).json(asset)
  } catch (e) { next(e) }
})

// PUT /api/assets/:id
assetRouter.put('/:id', requireHR, async (req, res, next) => {
  try {
    const data = assetSchema.partial().parse(req.body)
    const updateData: any = { ...data }
    if (data.purchaseDate !== undefined) updateData.purchaseDate = data.purchaseDate ? new Date(data.purchaseDate) : null
    if (data.warrantyExpiry !== undefined) updateData.warrantyExpiry = data.warrantyExpiry ? new Date(data.warrantyExpiry) : null
    if (updateData.assetCode === null || updateData.assetCode === '') delete updateData.assetCode

    const asset = await prisma.asset.update({
      where: { id: req.params.id },
      data: updateData,
      include: { category: true, subCategory: true },
    })
    res.json(asset)
  } catch (e) { next(e) }
})

// PATCH /api/assets/:id/status  (retire / repair)
assetRouter.patch('/:id/status', requireHR, async (req, res, next) => {
  try {
    const { status } = z.object({ status: z.enum(['AVAILABLE', 'ASSIGNED', 'UNDER_REPAIR', 'RETIRED']) }).parse(req.body)
    const asset = await prisma.asset.update({
      where: { id: req.params.id },
      data: { status },
    })
    res.json(asset)
  } catch (e) { next(e) }
})

// ─── ASSIGN / RETURN ──────────────────────────────────────────────────────────

// POST /api/assets/:id/assign
assetRouter.post('/:id/assign', requireHR, async (req, res, next) => {
  try {
    const { employeeId, condition, notes, assignedDate } = z.object({
      employeeId: z.string().min(1),
      condition: z.enum(['GOOD', 'DAMAGED', 'LOST']).default('GOOD'),
      notes: z.string().optional(),
      assignedDate: z.string().optional(),
    }).parse(req.body)

    const user = (req as any).user
    const asset = await prisma.asset.findUnique({ where: { id: req.params.id } })
    if (!asset) throw new AppError('Asset not found', 404)
    if (asset.status !== AssetStatus.AVAILABLE) throw new AppError('Asset is not available', 400)

    const employee = await prisma.employee.findUnique({ where: { id: employeeId } })
    if (!employee) throw new AppError('Employee not found', 404)

    const assignedDateValue = assignedDate ? new Date(assignedDate) : new Date()

    const assignment = await prisma.assetAssignment.create({
      data: {
        assetId: req.params.id,
        employeeId,
        condition,
        notes,
        assignedDate: assignedDateValue,
        assignedById: user.employeeId || user.id,
        assignedByName: user.name || user.email,
      },
    })

    await prisma.asset.update({
      where: { id: req.params.id },
      data: { status: AssetStatus.ASSIGNED },
    })

    // Send email (non-blocking)
    try {
      const { sendAssetAssignedNotif } = await import('../services/employeeNotifications')
      sendAssetAssignedNotif(
        employee.email,
        employee.name,
        asset.name,
        asset.assetCode,
        asset.categoryId,
        assignedDateValue,
        condition,
      ).catch(() => {})
    } catch {}

    res.status(201).json(assignment)
  } catch (e) { next(e) }
})

// POST /api/assets/:id/return
assetRouter.post('/:id/return', requireHR, async (req, res, next) => {
  try {
    const { assignmentId, returnCondition, notes } = z.object({
      assignmentId: z.string().min(1),
      returnCondition: z.enum(['GOOD', 'DAMAGED', 'LOST']).default('GOOD'),
      notes: z.string().optional(),
    }).parse(req.body)

    const assignment = await prisma.assetAssignment.findFirst({
      where: { id: assignmentId, assetId: req.params.id, isActive: true },
      include: { employee: true },
    })
    if (!assignment) throw new AppError('Active assignment not found', 404)

    await prisma.$transaction([
      prisma.assetAssignment.update({
        where: { id: assignmentId },
        data: { isActive: false, returnedDate: new Date(), returnCondition, notes },
      }),
      prisma.asset.update({
        where: { id: req.params.id },
        data: { status: AssetStatus.AVAILABLE },
      }),
    ])

    sendAssetReturnedEmail(
      assignment.employee.email,
      assignment.employee.name,
      (await prisma.asset.findUnique({ where: { id: req.params.id } }))!.name,
      req.params.id
    ).catch(() => {})

    res.json({ message: 'Asset returned successfully' })
  } catch (e) { next(e) }
})

// ─── BULK UPLOAD ──────────────────────────────────────────────────────────────

// GET /api/assets/bulk/template
assetRouter.get('/bulk/template', requireHR, async (_req, res, next) => {
  try {
    const wb = XLSX.utils.book_new()
    const ws = XLSX.utils.aoa_to_sheet([
      ['Asset Name*', 'Asset Code*', 'Category Name*', 'Sub Category', 'Brand', 'Model', 'Serial Number', 'Purchase Date (YYYY-MM-DD)', 'Warranty Expiry (YYYY-MM-DD)', 'Notes'],
      ['Dell Laptop', 'CT-LAP-001', 'IT Assets', 'Laptop', 'Dell', 'Inspiron 15', 'SN123456', '2024-01-01', '2027-01-01', ''],
    ])
    XLSX.utils.book_append_sheet(wb, ws, 'Assets')
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
    res.setHeader('Content-Disposition', 'attachment; filename="asset-template.xlsx"')
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.send(buf)
  } catch (e) { next(e) }
})

// POST /api/assets/bulk/upload
assetRouter.post('/bulk/upload', requireHR, upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) throw new AppError('No file uploaded', 400)
    const wb = XLSX.read(req.file.buffer, { type: 'buffer' })
    const ws = wb.Sheets[wb.SheetNames[0]]
    const rows = XLSX.utils.sheet_to_json<any>(ws, { defval: '' })

    // Flexible header resolver
    const pick = (row: any, keys: string[]) => {
      for (const k of keys) {
        if (row[k] !== undefined && row[k] !== null && String(row[k]).trim() !== '') {
          return String(row[k]).trim()
        }
      }
      return ''
    }

    const results: { row: number; status: string; error?: string }[] = []
    let imported = 0

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]
      const rowNum = i + 2
      try {
        const name = pick(row, ['Asset Name*', 'Asset Name', 'Assets Name', 'Assets Name*'])
        const assetCode = pick(row, ['Asset Code*', 'Asset Code'])
        const categoryName = pick(row, ['Category Name*', 'Category Name', 'Category'])
        const subCategoryName = pick(row, ['Sub Category', 'Sub-Category', 'SubCategory'])

        if (!name || !categoryName) {
          results.push({ row: rowNum, status: 'error', error: 'Missing required fields (Asset Name / Category)' })
          continue
        }

        const category = await prisma.assetCategoryConfig.findFirst({
          where: { name: { equals: categoryName, mode: 'insensitive' }, isActive: true },
        })
        if (!category) {
          results.push({ row: rowNum, status: 'error', error: `Category "${categoryName}" not found` })
          continue
        }

        let subCategoryId: string | null = null
        let subCategoryName2 = ''
        if (subCategoryName) {
          const sub = await prisma.assetSubCategoryConfig.findFirst({
            where: { name: { equals: subCategoryName, mode: 'insensitive' }, categoryId: category.id, isActive: true },
          })
          if (!sub) {
            results.push({ row: rowNum, status: 'error', error: `Sub-category "${subCategoryName}" not found under "${categoryName}"` })
            continue
          }
          subCategoryId = sub.id
          subCategoryName2 = sub.name
        }

        // Auto-generate code if blank
        let finalCode = assetCode
        if (!finalCode) {
          const prefix = derivePrefix(subCategoryName2 || category.name)
          finalCode = await nextAssetCode(prefix)
        } else {
          const existing = await prisma.asset.findUnique({ where: { assetCode: finalCode } })
          if (existing) {
            results.push({ row: rowNum, status: 'error', error: `Asset code "${finalCode}" already exists` })
            continue
          }
        }

        const purchaseDateStr = pick(row, ['Purchase Date (YYYY-MM-DD)', 'Purchase Date'])
        const warrantyStr = pick(row, ['Warranty Expiry (YYYY-MM-DD)', 'Warranty Expiry'])
        const brand = pick(row, ['Brand'])
        const model = pick(row, ['Model', 'Model No.', 'Model Number'])
        const serial = pick(row, ['Serial Number', 'Serial No.', 'Serial'])
        const notes = pick(row, ['Notes', 'Remarks'])

        await prisma.asset.create({
          data: {
            name,
            assetCode: finalCode,
            categoryId: category.id,
            subCategoryId,
            brand: brand || null,
            model: model || null,
            serialNumber: serial || null,
            purchaseDate: purchaseDateStr ? new Date(purchaseDateStr) : null,
            warrantyExpiry: warrantyStr ? new Date(warrantyStr) : null,
            notes: notes || null,
            status: AssetStatus.AVAILABLE,
          },
        })

        results.push({ row: rowNum, status: 'success' })
        imported++
      } catch (err: any) {
        results.push({ row: rowNum, status: 'error', error: err.message || 'Unknown error' })
      }
    }

    res.json({ imported, total: rows.length, results })
  } catch (e) { next(e) }
})

// ─── ASSET REQUESTS ───────────────────────────────────────────────────────────

// GET /api/assets/requests/all  (HR/SA)
assetRouter.get('/requests/all', requireHR, async (req, res, next) => {
  try {
    const { status, type } = req.query as Record<string, string>
    const where: any = {}
    if (status) where.status = status as any
    if (type) where.type = type as any

    const requests = await prisma.assetRequest.findMany({
      where,
      include: {
        employee: { select: { id: true, name: true, employeeCode: true, department: true } },
        asset: { include: { category: true } },
      },
      orderBy: { createdAt: 'desc' },
    })
    res.json(requests)
  } catch (e) { next(e) }
})

// GET /api/assets/requests/my  (employee)
assetRouter.get('/requests/my', requireAny, async (req, res, next) => {
  try {
    const user = (req as any).user
    const employee = await prisma.employee.findFirst({ where: { email: user.email } })
    if (!employee) throw new AppError('Employee not found', 404)

    const requests = await prisma.assetRequest.findMany({
      where: { employeeId: employee.id },
      include: { asset: { include: { category: true } } },
      orderBy: { createdAt: 'desc' },
    })
    res.json(requests)
  } catch (e) { next(e) }
})

// POST /api/assets/requests  (employee raise)
assetRouter.post('/requests', requireAny, async (req, res, next) => {
  try {
    const user = (req as any).user
    const employee = await prisma.employee.findFirst({ where: { email: user.email } })
    if (!employee) throw new AppError('Employee not found', 404)

    const { type, assetId, category, subCategory, reason } = z.object({
      type: z.enum(['NEEDED', 'RETURN']),
      assetId: z.string().optional().nullable(),
      category: z.string().optional().nullable(),
      subCategory: z.string().optional().nullable(),
      reason: z.string().min(1),
    }).parse(req.body)

    if (type === AssetRequestType.RETURN && !assetId) {
      throw new AppError('Asset ID required for return request', 400)
    }

    const request = await prisma.assetRequest.create({
      data: {
        employeeId: employee.id,
        type,
        assetId: assetId || null,
        category: category || null,
        subCategory: subCategory || null,
        reason,
      },
      include: { asset: true },
    })
    res.status(201).json(request)
  } catch (e) { next(e) }
})

// PATCH /api/assets/requests/:id/review  (HR/SA approve or reject)
assetRouter.patch('/requests/:id/review', requireHR, async (req, res, next) => {
  try {
    const user = (req as any).user
    const { status, notes } = z.object({
      status: z.enum(['APPROVED', 'REJECTED']),
      notes: z.string().optional(),
    }).parse(req.body)

    const request = await prisma.assetRequest.update({
      where: { id: req.params.id },
      data: {
        status,
        reviewedById: user.employeeId || user.id,
        reviewedByName: user.name || user.email,
        reviewNotes: notes,
        reviewedAt: new Date(),
      },
      include: { employee: true, asset: true },
    })

    // If approved return request → mark asset returned
    if (status === AssetRequestStatus.APPROVED && request.type === AssetRequestType.RETURN && request.assetId) {
      const activeAssignment = await prisma.assetAssignment.findFirst({
        where: { assetId: request.assetId, employeeId: request.employeeId, isActive: true },
      })
      if (activeAssignment) {
        await prisma.$transaction([
          prisma.assetAssignment.update({
            where: { id: activeAssignment.id },
            data: { isActive: false, returnedDate: new Date(), returnCondition: AssetCondition.GOOD },
          }),
          prisma.asset.update({
            where: { id: request.assetId },
            data: { status: AssetStatus.AVAILABLE },
          }),
        ])
      }
    }

    sendAssetRequestStatusEmail(
      request.employee.email,
      request.employee.name,
      request.type === AssetRequestType.NEEDED ? 'Asset Needed' : 'Asset Return',
      status,
      notes ?? null
    ).catch(() => {})

    res.json(request)
  } catch (e) { next(e) }
})
