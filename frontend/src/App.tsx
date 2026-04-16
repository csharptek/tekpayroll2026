import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useAuthStore } from './store/authStore'

// Auth
import LoginPage from './pages/auth/LoginPage'
import AccessDeniedPage from './pages/auth/AccessDeniedPage'

// Layout
import AppLayout from './layouts/AppLayout'

// HR Pages
import HRDashboard from './pages/hr/HRDashboard'
import EmployeeListPage from './pages/hr/EmployeeListPage'
import AddEmployeePage from './pages/hr/AddEmployeePage'
import EditEmployeePage from './pages/hr/EditEmployeePage'
import EmployeeDetailPage from './pages/hr/EmployeeDetailPage'
import RunPayrollPage from './pages/hr/RunPayrollPage'
import PayrollCyclesPage from './pages/hr/PayrollCyclesPage'
import PayrollRunDetailPage from './pages/hr/PayrollRunDetailPage'
import PayrollPreviewPage from './pages/hr/PayrollPreviewPage'
import LopManagementPage from './pages/hr/LopManagementPage'
import ReimbursementsPage from './pages/hr/ReimbursementsPage'
import LoansPage from './pages/hr/LoansPage'
import PayslipGenerationPage from './pages/hr/PayslipGenerationPage'
import FnfPage from './pages/hr/FnfPage'
import AuditLogPage from './pages/hr/AuditLogPage'
import RunTasksPage from './pages/hr/RunTasksPage'
import ConfigPage from './pages/hr/ConfigPage'
import SalaryCalculatorPage from './pages/hr/SalaryCalculatorPage'
import SalaryCalculatorNewEsicPage from './pages/hr/SalaryCalculatorNewEsicPage'
import SyncPage from './pages/hr/SyncPage'
import BulkImportPage from './pages/hr/BulkImportPage'
import BulkEditEmployeesPage from './pages/hr/BulkEditEmployeesPage'
import BulkEditEmployeePage from './pages/hr/BulkEditEmployeePage'
import HRLeavePage from './pages/hr/HRLeavePage'
import PublicHolidaysPage from './pages/hr/PublicHolidaysPage'
import LeaveConfigPage from './pages/hr/LeaveConfigPage'
import BulkLeaveEntryPage from './pages/hr/BulkLeaveEntryPage'

// Employee Pages
import EmployeeDashboard from './pages/employee/EmployeeDashboard'
import MyPayslipsPage from './pages/employee/MyPayslipsPage'
import MyProfilePage from './pages/employee/MyProfilePage'
import MyLoansPage from './pages/employee/MyLoansPage'
import MyLeavesPage from './pages/employee/MyLeavesPage'
import MyResignationPage from './pages/employee/MyResignationPage'

// Shared Pages
import PoliciesPage from './pages/shared/PoliciesPage'
import AssetListPage from './pages/hr/assets/AssetListPage'
import AssetDetailPage from './pages/hr/assets/AssetDetailPage'
import AssetRequestsPage from './pages/hr/assets/AssetRequestsPage'
import AssetConfiguratorPage from './pages/hr/assets/AssetConfiguratorPage'
import MyAssetsPage from './pages/employee/MyAssetsPage'

// Management Pages
import ManagementDashboard from './pages/management/ManagementDashboard'
import PayrollReportsPage from './pages/management/PayrollReportsPage'
import CostReportPage from './pages/management/CostReportPage'

// Guard
function RequireAuth({ children, roles }: { children: React.ReactNode; roles?: string[] }) {
  const { user, isAuthenticated } = useAuthStore()

  if (!isAuthenticated()) return <Navigate to="/login" replace />
  if (roles && user && !roles.includes(user.role)) return <Navigate to="/access-denied" replace />

  return <>{children}</>
}

function RoleBasedHome() {
  const { user } = useAuthStore()
  if (!user) return <Navigate to="/login" replace />
  if (user.role === 'EMPLOYEE') return <Navigate to="/my/dashboard" replace />
  if (user.role === 'MANAGEMENT') return <Navigate to="/management/dashboard" replace />
  return <Navigate to="/hr/dashboard" replace />
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Public */}
        <Route path="/login" element={<LoginPage />} />
        <Route path="/access-denied" element={<AccessDeniedPage />} />

        {/* Root redirect */}
        <Route path="/" element={<RequireAuth><RoleBasedHome /></RequireAuth>} />

        {/* HR & Super Admin — shared routes */}
        <Route path="/hr" element={<RequireAuth roles={['HR', 'SUPER_ADMIN']}><AppLayout /></RequireAuth>}>
          <Route path="dashboard" element={<HRDashboard />} />
          <Route path="employees" element={<EmployeeListPage />} />
          <Route path="employees/add" element={<AddEmployeePage />} />
          <Route path="employees/:id" element={<EmployeeDetailPage />} />
          <Route path="employees/:id/edit" element={<EditEmployeePage />} />
          <Route path="employees-bulk-edit" element={<BulkEditEmployeesPage />} />
          <Route path="employees-bulk-edit" element={<BulkEditEmployeePage />} />
          <Route path="import" element={<BulkImportPage />} />
          <Route path="sync" element={<SyncPage />} />
          <Route path="audit" element={<AuditLogPage />} />
          <Route path="run-tasks" element={<RequireAuth roles={['SUPER_ADMIN']}><RunTasksPage /></RequireAuth>} />
          <Route path="config" element={<ConfigPage />} />
          <Route path="salary-calculator" element={<SalaryCalculatorPage />} />
          <Route path="salary-calculator-new-esic" element={<SalaryCalculatorNewEsicPage />} />
          <Route path="leaves" element={<HRLeavePage />} />
          <Route path="public-holidays" element={<PublicHolidaysPage />} />
          <Route path="leave-config" element={<LeaveConfigPage />} />
          <Route path="bulk-leave-entry" element={<BulkLeaveEntryPage />} />

          {/* Asset routes */}
          <Route path="assets" element={<AssetListPage />} />
          <Route path="assets/:id" element={<AssetDetailPage />} />
          <Route path="asset-requests" element={<AssetRequestsPage />} />
          <Route path="asset-configurator" element={<AssetConfiguratorPage />} />

          {/* Financial routes — SUPER_ADMIN only */}
          <Route path="payroll" element={<RequireAuth roles={['SUPER_ADMIN']}><PayrollCyclesPage /></RequireAuth>} />
          <Route path="payroll/preview" element={<RequireAuth roles={['SUPER_ADMIN']}><PayrollPreviewPage /></RequireAuth>} />
          <Route path="payroll/:id/run" element={<RequireAuth roles={['SUPER_ADMIN']}><RunPayrollPage /></RequireAuth>} />
          <Route path="payroll/:id/detail" element={<RequireAuth roles={['SUPER_ADMIN']}><PayrollRunDetailPage /></RequireAuth>} />
          <Route path="payroll/:id/lop" element={<RequireAuth roles={['SUPER_ADMIN']}><LopManagementPage /></RequireAuth>} />
          <Route path="payroll/:id/reimbursements" element={<RequireAuth roles={['SUPER_ADMIN']}><ReimbursementsPage /></RequireAuth>} />
          <Route path="payslips" element={<RequireAuth roles={['SUPER_ADMIN']}><PayslipGenerationPage /></RequireAuth>} />
          <Route path="loans" element={<RequireAuth roles={['SUPER_ADMIN']}><LoansPage /></RequireAuth>} />
          <Route path="fnf" element={<RequireAuth roles={['SUPER_ADMIN']}><FnfPage /></RequireAuth>} />
        </Route>

        {/* Employee self-service */}
        <Route path="/my" element={<RequireAuth><AppLayout /></RequireAuth>}>
          <Route path="dashboard" element={<EmployeeDashboard />} />
          <Route path="payslips" element={<MyPayslipsPage />} />
          <Route path="profile" element={<MyProfilePage />} />
          <Route path="loans" element={<MyLoansPage />} />
          <Route path="leaves" element={<MyLeavesPage />} />
          <Route path="resignation" element={<MyResignationPage />} />
          <Route path="assets" element={<MyAssetsPage />} />
        </Route>

        {/* Management */}
        <Route path="/management" element={<RequireAuth roles={['MANAGEMENT', 'HR', 'SUPER_ADMIN']}><AppLayout /></RequireAuth>}>
          <Route path="dashboard" element={<ManagementDashboard />} />
          <Route path="reports" element={<PayrollReportsPage />} />
          <Route path="cost-report" element={<CostReportPage />} />
        </Route>

        {/* Policies — all authenticated roles */}
        <Route path="/policies" element={<RequireAuth><AppLayout /></RequireAuth>}>
          <Route index element={<PoliciesPage />} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
