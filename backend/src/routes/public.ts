import { Router } from 'express'
import { prisma } from '../lib/prisma'

export const publicRouter = Router()

// GET /api/public/holidays?year=2026
publicRouter.get('/holidays', async (req, res) => {
  const year = parseInt(req.query.year as string) || new Date().getFullYear()
  const holidays = await prisma.publicHoliday.findMany({
    where: { year },
    orderBy: { date: 'asc' },
    select: {
      id: true,
      date: true,
      name: true,
      description: true,
      year: true,
    },
  })
  res.json({ success: true, data: holidays })
})

// GET /api/public/birthdays  — today's birthdays + work anniversaries
publicRouter.get('/birthdays', async (req, res) => {
  const today = new Date()
  const month = today.getMonth() + 1 // 1-12
  const day = today.getDate()

  // Birthdays from EmployeeProfile.dateOfBirth
  const profiles = await prisma.employeeProfile.findMany({
    where: {
      dateOfBirth: { not: null },
      employee: { status: 'ACTIVE' },
    },
    select: {
      dateOfBirth: true,
      firstName: true,
      lastName: true,
      profilePhotoUrl: true,
      employee: {
        select: {
          id: true,
          name: true,
          jobTitle: true,
          department: true,
        },
      },
    },
  })

  const birthdays = profiles
    .filter((p) => {
      if (!p.dateOfBirth) return false
      const d = new Date(p.dateOfBirth)
      return d.getMonth() + 1 === month && d.getDate() === day
    })
    .map((p) => ({
      employeeId: p.employee.id,
      name: p.firstName && p.lastName
        ? `${p.firstName} ${p.lastName}`
        : p.employee.name,
      jobTitle: p.employee.jobTitle,
      department: p.employee.department,
      photoUrl: p.profilePhotoUrl,
      type: 'birthday' as const,
    }))

  // Work anniversaries from Employee.joiningDate
  const employees = await prisma.employee.findMany({
    where: { status: 'ACTIVE' },
    select: {
      id: true,
      name: true,
      jobTitle: true,
      department: true,
      joiningDate: true,
      profile: {
        select: {
          firstName: true,
          lastName: true,
          profilePhotoUrl: true,
        },
      },
    },
  })

  const anniversaries = employees
    .filter((e) => {
      const d = new Date(e.joiningDate)
      return (
        d.getMonth() + 1 === month &&
        d.getDate() === day &&
        d.getFullYear() !== today.getFullYear() // exclude joining year
      )
    })
    .map((e) => {
      const years = today.getFullYear() - new Date(e.joiningDate).getFullYear()
      return {
        employeeId: e.id,
        name: e.profile?.firstName && e.profile?.lastName
          ? `${e.profile.firstName} ${e.profile.lastName}`
          : e.name,
        jobTitle: e.jobTitle,
        department: e.department,
        photoUrl: e.profile?.profilePhotoUrl || null,
        type: 'anniversary' as const,
        years,
      }
    })

  res.json({
    success: true,
    data: {
      birthdays,
      anniversaries,
    },
  })
})

// GET /api/public/announcements  — returns empty array until admin panel built
publicRouter.get('/announcements', async (_req, res) => {
  // Will be replaced with DB query when Announcement model is added
  res.json({
    success: true,
    data: [],
  })
})
