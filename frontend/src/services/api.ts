import axios from 'axios'
import { useAuthStore } from '../store/authStore'

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

api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      useAuthStore.getState().logout()
      window.location.href = '/login'
    }
    return Promise.reject(err)
  }
)

export default api

export const employeeApi = {
  list: (params?: Record<string, any>) => api.get('/api/employees', { params }),
  get: (id: string) => api.get(`/api/employees/${id}`),
  getFull: (id: string) => api.get(`/api/employees/${id}/full`),
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
