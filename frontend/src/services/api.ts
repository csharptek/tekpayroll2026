import axios from 'axios'
import { useAuthStore } from '../store/authStore'
import { msalInstance, loginRequest } from './msal'

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:4000',
  timeout: 30000,
})

api.interceptors.request.use((config) => {
  const { token, user, isDevMode } = useAuthStore.getState()
  if (isDevMode && user) {
    config.headers['x-dev-role'] = user.role
    config.headers['x-dev-user-id'] = user.id
  } else if (token) {
    config.headers['Authorization'] = `Bearer ${token}`
  }
  return config
})

// Track if we're already refreshing to avoid infinite loops
let isRefreshing = false
let refreshQueue: Array<(token: string) => void> = []

api.interceptors.response.use(
  (res) => res,
  async (err) => {
    const { isDevMode, setUser, logout } = useAuthStore.getState()

    if (err.response?.status === 401 && !isDevMode && !err.config._retry) {
      // Try silent token refresh before giving up
      if (isRefreshing) {
        // Queue this request until refresh completes
        return new Promise((resolve, reject) => {
          refreshQueue.push((newToken: string) => {
            err.config._retry = true
            err.config.headers['Authorization'] = `Bearer ${newToken}`
            resolve(api(err.config))
          })
        })
      }

      isRefreshing = true
      err.config._retry = true

      try {
        const accounts = msalInstance.getAllAccounts()
        if (accounts.length === 0) throw new Error('No accounts')

        const result = await msalInstance.acquireTokenSilent({
          ...loginRequest,
          account: accounts[0],
          forceRefresh: true,
        })

        const newToken = result.idToken

        // Update stored token
        const { user } = useAuthStore.getState()
        if (user) setUser(user, newToken)

        // Flush queued requests
        refreshQueue.forEach(cb => cb(newToken))
        refreshQueue = []
        isRefreshing = false

        // Retry original request with new token
        err.config.headers['Authorization'] = `Bearer ${newToken}`
        return api(err.config)
      } catch (refreshErr) {
        // Refresh failed — clear session and redirect to login
        refreshQueue = []
        isRefreshing = false
        logout()
        window.location.href = '/login'
        return Promise.reject(refreshErr)
      }
    }

    return Promise.reject(err)
  }
)

export default api

export const employeeApi = {
  list: (params?: Record<string, any>) => api.get('/api/employees', { params }),
  get: (id: string) => api.get(`/api/employees/${id}`),
  getFull: (id: string) => api.get(`/api/employees/${id}/full`),
  nextCode: (type: 'EMPLOYEE' | 'TRAINEE') => api.get(`/api/employees/next-code?type=${type}`),
  delete: (id: string) => api.delete(`/api/employees/${id}`),
  create: (data: any) => api.post('/api/employees', data),
  update: (id: string, data: any) => api.put(`/api/employees/${id}`, data),
  deactivate: (id: string) => api.post(`/api/employees/${id}/deactivate`),
  payrollHistory: (id: string) => api.get(`/api/employees/${id}/payroll-history`),
  salaryRevisions: (id: string) => api.get(`/api/employees/${id}/salary-revisions`),
}

export const payrollApi = {
  cycles: () => api.get('/api/payroll/cycles'),
  cycle: (id: string) => api.get(`/api/payroll/cycles/${id}`),
  createCycle: (data: any) => api.post('/api/payroll/cycles', data),
  run: (id: string) => api.post(`/api/payroll/cycles/${id}/run`),
  lock: (id: string) => api.post(`/api/payroll/cycles/${id}/lock`),
  unlock: (id: string, reason: string) => api.post(`/api/payroll/cycles/${id}/unlock`, { reason }),
  disburse: (id: string) => api.post(`/api/payroll/cycles/${id}/disburse`),
  adjustEntry: (id: string, data: any) => api.put(`/api/payroll/entries/${id}`, data),
}

export const lopApi = {
  list: (cycleId: string) => api.get(`/api/lop/${cycleId}`),
  upsert: (data: any) => api.post('/api/lop', data),
}

export const reimbursementApi = {
  list: (cycleId: string) => api.get(`/api/reimbursements/${cycleId}`),
  create: (data: any) => api.post('/api/reimbursements', data),
  delete: (id: string) => api.delete(`/api/reimbursements/${id}`),
}

export const payslipApi = {
  forEmployee: (employeeId: string) => api.get(`/api/payslips/employee/${employeeId}`),
  generate: (cycleId: string) => api.post(`/api/payslips/generate/${cycleId}`),
}

export const loanApi = {
  list: () => api.get('/api/loans'),
  forEmployee: (employeeId: string) => api.get(`/api/loans/employee/${employeeId}`),
  create: (data: any) => api.post('/api/loans', data),
  close: (id: string, note: string) => api.post(`/api/loans/${id}/close`, { note }),
}

export const reportApi = {
  summary: () => api.get('/api/reports/summary'),
  trend: () => api.get('/api/reports/payroll-trend'),
  salarySummary: () => api.get('/api/reports/salary-summary'),
}

export const configApi = {
  get: () => api.get('/api/config'),
  update: (data: any) => api.put('/api/config', data),
  ptSlabs: () => api.get('/api/config/pt-slabs'),
}

export const auditApi = {
  list: (params?: any) => api.get('/api/audit', { params }),
}

export const fnfApi = {
  list:            ()           => api.get('/api/fnf'),
  eligible:        ()           => api.get('/api/fnf/eligible'),
  byEmployee:      (id: string) => api.get(`/api/fnf/employee/${id}`),
  get:             (id: string) => api.get(`/api/fnf/${id}`),
  calculate:       (empId: string) => api.post(`/api/fnf/calculate/${empId}`),
  initiate:        (empId: string) => api.post(`/api/fnf/initiate/${empId}`),
  approve:         (id: string, notes?: string) => api.post(`/api/fnf/${id}/approve`, { notes }),
  update:          (id: string, data: any) => api.put(`/api/fnf/${id}`, data),
}

export const leaveApi = {
  // Policy
  policy:             ()           => api.get('/api/leave/policy'),
  updatePolicy:       (data: any)  => api.put('/api/leave/policy', data),

  // Reasons
  reasons:            (kind?: string) => api.get('/api/leave/reasons', { params: kind ? { kind } : {} }),
  addReason:          (data: any)  => api.post('/api/leave/reasons', data),
  updateReason:       (id: string, data: any) => api.put(`/api/leave/reasons/${id}`, data),
  deleteReason:       (id: string) => api.delete(`/api/leave/reasons/${id}`),

  // Public Holidays
  holidays:           (year?: number) => api.get('/api/leave/holidays', { params: year ? { year } : {} }),
  addHoliday:         (data: any)  => api.post('/api/leave/holidays', data),
  updateHoliday:      (id: string, data: any) => api.put(`/api/leave/holidays/${id}`, data),
  deleteHoliday:      (id: string) => api.delete(`/api/leave/holidays/${id}`),

  // Balance
  myBalance:          (year?: number) => api.get('/api/leave/balance/my', { params: year ? { year } : {} }),
  employeeBalance:    (id: string, year?: number) => api.get(`/api/leave/balance/${id}`, { params: year ? { year } : {} }),
  allBalances:        (year?: number) => api.get('/api/leave/balance', { params: year ? { year } : {} }),
  balanceHistory:     (id: string) => api.get(`/api/leave/balance/${id}/history`),

  // Applications
  apply:              (data: any)  => api.post('/api/leave/apply', data),
  myApplications:     (params?: any) => api.get('/api/leave/my', { params }),
  allApplications:    (params?: any) => api.get('/api/leave/applications', { params }),
  approve:            (id: string) => api.put(`/api/leave/applications/${id}/approve`, {}),
  decline:            (id: string, reason: string) => api.put(`/api/leave/applications/${id}/decline`, { reason }),
  cancelDirect:       (id: string, newEndDate?: string) => api.put(`/api/leave/applications/${id}/cancel-direct`, { newEndDate }),

  // Cancellation requests (employee)
  requestCancel:      (id: string, reason?: string) => api.post(`/api/leave/applications/${id}/cancel`, { reason }),
  cancellationRequests: () => api.get('/api/leave/cancellations'),
  approveCancellation: (id: string, newEndDate?: string) => api.put(`/api/leave/cancellations/${id}/approve`, { newEndDate }),
  declineCancellation: (id: string, reason: string) => api.put(`/api/leave/cancellations/${id}/decline`, { reason }),

  // Rollover
  rolloverStatus:     () => api.get('/api/leave/rollover/status'),
  triggerRollover:    () => api.post('/api/leave/rollover', {}),
  rolloverHistory:    () => api.get('/api/leave/rollover/history'),

  // Seed
  seedReasons:        () => api.post('/api/leave/seed-reasons', {}),
}

export const policiesApi = {
  list:   ()                        => api.get('/api/policies'),
  create: (data: any)               => api.post('/api/policies', data),
  update: (id: string, data: any)   => api.put(`/api/policies/${id}`, data),
  delete: (id: string)              => api.delete(`/api/policies/${id}`),
  reorder:(ids: string[])           => api.put('/api/policies/reorder', { ids }),
}

export const calendarApi = {
  birthdays: (month: number) => api.get('/api/employees/birthdays/month', { params: { month } }),
}

export const exitApi = {
  get:              (id: string)                   => api.get(`/api/exit/${id}`),
  resign:           (id: string, data: any)        => api.post(`/api/exit/${id}/resign`, data),
  initiate:         (id: string, data: any)        => api.post(`/api/exit/${id}/initiate`, data),
  updateDetails:    (id: string, data: any)        => api.patch(`/api/exit/${id}/details`, data),
  updateClearance:  (id: string, data: any)        => api.patch(`/api/exit/${id}/clearance`, data),
  updateInterview:  (id: string, data: any)        => api.patch(`/api/exit/${id}/interview`, data),
  unlockFf:         (id: string)                   => api.patch(`/api/exit/${id}/ff-unlock`, {}),
  enableWithdrawal: (id: string, enabled: boolean) => api.patch(`/api/exit/${id}/enable-withdrawal`, { enabled }),
  withdraw:         (id: string)                   => api.post(`/api/exit/${id}/withdraw`, {}),
  convertLop:       (id: string, applicationId: string) => api.post(`/api/exit/${id}/convert-lop`, { applicationId }),
  separate:         (id: string)                   => api.post(`/api/exit/${id}/separate`, {}),
  lopLeaves:        (id: string)                   => api.get(`/api/exit/${id}/lop-leaves`),
  testEmail:        (toEmail: string)              => api.post('/api/config/test-email', { toEmail }),
}
