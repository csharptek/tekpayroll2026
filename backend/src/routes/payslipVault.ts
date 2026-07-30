import { Router } from 'express'
import { authenticate, requireSuperAdmin } from '../middleware/auth'
import { prisma } from '../utils/prisma'
import { AppError } from '../middleware/errorHandler'
import {
  mergeSingleEmployeePayslips,
  zipBulkPayslips,
  getSalaryView,
  exportSalaryExcel,
} from '../services/payslipVaultService'

export const payslipVaultRouter = Router()
payslipVaultRouter.use(authenticate, requireSuperAdmin)

// GET all employees (active + inactive) for selector
payslipVaultRouter.get('/employees', async (_req, res) => {
  const employees = await prisma.employee.findMany({
    select: { id: true, employeeCode: true, name: true, department: true, status: true },
    orderBy: [{ status: 'asc' }, { name: 'asc' }],
  })
  res.json({ success: true, data: employees })
})

// GET distinct payroll months available (for month picker)
payslipVaultRouter.get('/months', async (_req, res) => {
  const cycles = await prisma.payrollCycle.findMany({
    select: { payrollMonth: true, cycleStart: true },
    orderBy: { cycleStart: 'desc' },
  })
  res.json({ success: true, data: cycles })
})

// POST download merged PDF for one employee, multiple months
payslipVaultRouter.post('/download/single', async (req, res) => {
  const { employeeId, months } = req.body
  if (!employeeId || !Array.isArray(months) || !months.length) {
    throw new AppError('employeeId and months[] are required', 400)
  }

  const { buffer, employee } = await mergeSingleEmployeePayslips(employeeId, months)

  res.setHeader('Content-Type', 'application/pdf')
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${employee.employeeCode}_payslips.pdf"`,
  )
  res.send(buffer)
})

// POST download zip of individual PDFs for multiple employees
payslipVaultRouter.post('/download/bulk', async (req, res) => {
  const { employeeIds, months, from, to } = req.body
  if (!Array.isArray(employeeIds) || !employeeIds.length) {
    throw new AppError('employeeIds[] is required', 400)
  }

  const stream = await zipBulkPayslips({
    employeeIds,
    months,
    from: from ? new Date(from) : undefined,
    to: to ? new Date(to) : undefined,
  })

  res.setHeader('Content-Type', 'application/zip')
  res.setHeader('Content-Disposition', `attachment; filename="payslips_bulk.zip"`)
  stream.pipe(res)
})

// GET salary view — monthly + cumulative for one employee
payslipVaultRouter.get('/salary-view/:employeeId', async (req, res) => {
  const { from, to } = req.query as { from?: string; to?: string }
  const data = await getSalaryView({
    employeeId: req.params.employeeId,
    from: from ? new Date(from) : undefined,
    to: to ? new Date(to) : undefined,
  })
  res.json({ success: true, data })
})

// POST export excel — full breakup, one or many employees, one sheet
payslipVaultRouter.post('/export/excel', async (req, res) => {
  const { employeeIds, from, to } = req.body
  if (!Array.isArray(employeeIds) || !employeeIds.length) {
    throw new AppError('employeeIds[] is required', 400)
  }

  const buffer = await exportSalaryExcel({
    employeeIds,
    from: from ? new Date(from) : undefined,
    to: to ? new Date(to) : undefined,
  })

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  res.setHeader('Content-Disposition', `attachment; filename="salary_breakup.xlsx"`)
  res.send(buffer)
})
