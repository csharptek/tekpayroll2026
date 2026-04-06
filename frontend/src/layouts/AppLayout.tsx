import { useState } from 'react'
import tekOneLogo from '../assets/tekone-logo.png'
import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom'
import { useAuthStore } from '../store/authStore'
import { signOut } from '../services/msal'
import {
  LayoutDashboard, Users, CreditCard, FileText, Settings,
  LogOut, ChevronDown, Menu, X, Building2, Shield,
  BarChart3, Receipt, Wallet, GitMerge, Upload,
  RefreshCw, ScrollText, FileSearch, DollarSign, Table2,
  UserCircle, Banknote, ClipboardList, Edit3, CalendarDays,
  CalendarCheck, CalendarClock, Palmtree, BookOpen, FlaskConical
} from 'lucide-react'
import clsx from 'clsx'

// ─── NAV STRUCTURE ───────────────────────────────────────────────────────────

// HR nav: employee management + leave admin only (no financial/payroll access)
const HR_NAV = [
  {
    section: 'Overview',
    items: [
      { label: 'Dashboard', icon: LayoutDashboard, to: '/hr/dashboard' },
    ]
  },
  {
    section: 'Employees',
    items: [
      { label: 'All Employees', icon: Users,     to: '/hr/employees' },
      { label: 'Bulk Import',   icon: Upload,    to: '/hr/import' },
      { label: 'Bulk Edit',     icon: Edit3,     to: '/hr/employees-bulk-edit' },
      { label: 'M365 Sync',     icon: RefreshCw, to: '/hr/sync' },
    ]
  },
  {
    section: 'Leave',
    items: [
      { label: 'Leave Applications', icon: CalendarCheck, to: '/hr/leaves' },
      { label: 'Public Holidays',    icon: CalendarDays,  to: '/hr/public-holidays' },
      { label: 'Leave Config',       icon: CalendarClock, to: '/hr/leave-config' },
    ]
  },
  {
    section: 'Admin',
    items: [
      { label: 'Audit Log', icon: ScrollText, to: '/hr/audit' },
    ]
  },
  {
    section: 'Company',
    items: [
      { label: 'Policies', icon: BookOpen, to: '/policies' },
    ]
  },
  // HR is also an employee — they can access their own payroll & leave data
  {
    section: 'My Payroll',
    items: [
      { label: 'My Payslips', icon: FileText,   to: '/my/payslips' },
      { label: 'My Profile',  icon: UserCircle, to: '/my/profile' },
      { label: 'My Loans',    icon: Wallet,     to: '/my/loans' },
    ]
  },
  {
    section: 'My Leave',
    items: [
      { label: 'My Leaves', icon: Palmtree, to: '/my/leaves' },
    ]
  },
]

// SUPER_ADMIN nav: full access including financial/payroll
const SUPER_ADMIN_NAV = [
  {
    section: 'Overview',
    items: [
      { label: 'Dashboard', icon: LayoutDashboard, to: '/hr/dashboard' },
    ]
  },
  {
    section: 'Employees',
    items: [
      { label: 'All Employees',      icon: Users,      to: '/hr/employees' },
      { label: 'Bulk Import',        icon: Upload,     to: '/hr/import' },
      { label: 'Bulk Edit',          icon: Edit3,      to: '/hr/employees-bulk-edit' },
      { label: 'Bulk Edit Salaries', icon: Table2,     to: '/hr/salaries-bulk-edit' },
      { label: 'M365 Sync',          icon: RefreshCw,  to: '/hr/sync' },
    ]
  },
  {
    section: 'Payroll',
    items: [
      { label: 'Payroll Cycles',   icon: CreditCard,     to: '/hr/payroll' },
      { label: 'Dry Run',          icon: FlaskConical,   to: '/hr/payroll/dry-run' },
      { label: 'Payslips',         icon: FileText,       to: '/hr/payslips' },
      { label: 'Loans & Advances', icon: Wallet,     to: '/hr/loans' },
      { label: 'F&F Settlement',   icon: GitMerge,   to: '/hr/fnf' },
    ]
  },
  {
    section: 'Leave',
    items: [
      { label: 'Leave Applications', icon: CalendarCheck, to: '/hr/leaves' },
      { label: 'Public Holidays',    icon: CalendarDays,  to: '/hr/public-holidays' },
      { label: 'Leave Config',       icon: CalendarClock, to: '/hr/leave-config' },
    ]
  },
  {
    section: 'Admin',
    items: [
      { label: 'Audit Log',     icon: ScrollText, to: '/hr/audit' },
      { label: 'Configuration', icon: Settings,   to: '/hr/config' },
    ]
  },
  {
    section: 'Company',
    items: [
      { label: 'Policies', icon: BookOpen, to: '/policies' },
    ]
  },
  // Super Admin is also an employee
  {
    section: 'My Payroll',
    items: [
      { label: 'My Payslips', icon: FileText,   to: '/my/payslips' },
      { label: 'My Profile',  icon: UserCircle, to: '/my/profile' },
      { label: 'My Loans',    icon: Wallet,     to: '/my/loans' },
    ]
  },
  {
    section: 'My Leave',
    items: [
      { label: 'My Leaves', icon: Palmtree, to: '/my/leaves' },
    ]
  },
]

const EMPLOYEE_NAV = [
  {
    section: 'Company',
    items: [
      { label: 'Policies', icon: BookOpen, to: '/policies' },
    ]
  },
  {
    section: 'My Payroll',
    items: [
      { label: 'Dashboard',  icon: LayoutDashboard, to: '/my/dashboard' },
      { label: 'My Payslips',icon: FileText,        to: '/my/payslips' },
      { label: 'My Loans',   icon: Wallet,          to: '/my/loans' },
      { label: 'My Profile', icon: UserCircle,      to: '/my/profile' },
    ]
  },
  {
    section: 'Leave',
    items: [
      { label: 'My Leaves', icon: Palmtree, to: '/my/leaves' },
    ]
  },
]

const MANAGEMENT_NAV = [
  {
    section: 'Analytics',
    items: [
      { label: 'Dashboard',       icon: BarChart3,  to: '/management/dashboard' },
      { label: 'Payroll Reports', icon: FileSearch, to: '/management/reports' },
      { label: 'Cost Analysis',   icon: DollarSign, to: '/management/cost-report' },
    ]
  },
  {
    section: 'Company',
    items: [
      { label: 'Policies', icon: BookOpen, to: '/policies' },
    ]
  },
  // Management is also an employee
  {
    section: 'My Payroll',
    items: [
      { label: 'My Payslips', icon: FileText,   to: '/my/payslips' },
      { label: 'My Profile',  icon: UserCircle, to: '/my/profile' },
      { label: 'My Loans',    icon: Wallet,     to: '/my/loans' },
    ]
  },
  {
    section: 'My Leave',
    items: [
      { label: 'My Leaves', icon: Palmtree, to: '/my/leaves' },
    ]
  },
]

function getNav(role: string) {
  if (role === 'SUPER_ADMIN') return SUPER_ADMIN_NAV
  if (role === 'HR') return HR_NAV
  if (role === 'MANAGEMENT') return MANAGEMENT_NAV
  return EMPLOYEE_NAV
}

// ─── SIDEBAR ─────────────────────────────────────────────────────────────────

function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { user, logout } = useAuthStore()
  const navigate = useNavigate()
  const nav = getNav(user?.role || 'EMPLOYEE')

  async function handleLogout() {
    logout()          // clear zustand store
    await signOut()   // clear MSAL session + redirect to /login
  }

  return (
    <>
      {/* Mobile overlay */}
      {open && (
        <div
          className="fixed inset-0 bg-black/40 backdrop-blur-sm z-20 lg:hidden"
          onClick={onClose}
        />
      )}

      <aside className={clsx(
        'fixed top-0 left-0 h-full w-64 bg-brand-900 z-30 flex flex-col',
        'transition-transform duration-300 ease-out',
        open ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
      )}>

        {/* Logo */}
        <div className="flex items-center gap-3 px-5 py-5 border-b border-brand-800">
          <div className="flex-1 min-w-0">
            <img src={tekOneLogo} alt="TEKONE" className="h-7 w-auto" />
          </div>
          <button onClick={onClose} className="lg:hidden text-brand-400 hover:text-white">
            <X size={16} />
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-5">
          {nav.map((group) => (
            <div key={group.section}>
              <p className="text-[10px] font-semibold text-brand-500 uppercase tracking-widest px-2 mb-1.5">
                {group.section}
              </p>
              <div className="space-y-0.5">
                {group.items.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    onClick={onClose}
                    className={({ isActive }) => clsx(
                      'flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-150',
                      isActive
                        ? 'bg-white/10 text-white'
                        : 'text-brand-300 hover:text-white hover:bg-white/5'
                    )}
                  >
                    <item.icon size={15} className="flex-shrink-0" />
                    <span>{item.label}</span>
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
        </nav>

        {/* User Footer */}
        <div className="border-t border-brand-800 p-3">
          <div className="flex items-center gap-3 px-2 py-2 rounded-lg">
            <div className="w-8 h-8 rounded-full bg-brand-700 border border-brand-600 flex items-center justify-center flex-shrink-0">
              <span className="text-xs font-semibold text-brand-200">
                {user?.name?.charAt(0) || '?'}
              </span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-white truncate">{user?.name}</p>
              <p className="text-[10px] text-brand-400 truncate">{user?.role?.replace('_', ' ')}</p>
            </div>
            <button
              onClick={handleLogout}
              title="Sign out"
              className="text-brand-500 hover:text-red-400 transition-colors p-1"
            >
              <LogOut size={14} />
            </button>
          </div>
        </div>
      </aside>
    </>
  )
}

// ─── TOP BAR ─────────────────────────────────────────────────────────────────

function TopBar({
  onMenuClick,
  title,
}: {
  onMenuClick: () => void
  title: string
}) {
  const { user } = useAuthStore()

  return (
    <header className="h-14 bg-white border-b border-slate-100 flex items-center px-4 gap-4 sticky top-0 z-10">
      <button
        onClick={onMenuClick}
        className="lg:hidden text-slate-500 hover:text-slate-700 p-1"
      >
        <Menu size={20} />
      </button>

      <h2 className="text-sm font-semibold text-slate-800 flex-1 truncate">{title}</h2>

      <div className="flex items-center gap-2">
        {user?.role === 'SUPER_ADMIN' && (
          <span className="badge badge-purple hidden sm:inline-flex gap-1">
            <Shield size={10} />
            Super Admin
          </span>
        )}
        {user?.role === 'HR' && (
          <span className="badge badge-blue hidden sm:inline-flex">HR</span>
        )}
        {user?.role === 'MANAGEMENT' && (
          <span className="badge badge-green hidden sm:inline-flex">Management</span>
        )}

        <div className="w-8 h-8 rounded-full bg-brand-600 flex items-center justify-center">
          <span className="text-xs font-semibold text-white">{user?.name?.charAt(0)}</span>
        </div>
      </div>
    </header>
  )
}

// ─── PAGE TITLE MAP ───────────────────────────────────────────────────────────

function usePageTitle() {
  const location = useLocation()
  const map: Record<string, string> = {
    '/hr/dashboard': 'Dashboard',
    '/hr/employees': 'Employees',
    '/hr/employees/add': 'Add Employee',
    '/hr/payroll': 'Payroll Cycles',
    '/hr/payroll/dry-run': 'Payroll Dry Run',
    '/hr/payslips': 'Payslip Generation',
    '/hr/loans': 'Loans & Advances',
    '/hr/fnf': 'Full & Final Settlement',
    '/hr/import': 'Bulk Import',
    '/hr/sync': 'M365 Sync',
    '/hr/employees-bulk-edit': 'Bulk Edit Employees',
    '/hr/salaries-bulk-edit': 'Bulk Edit Salaries',
    '/hr/audit': 'Audit Log',
    '/hr/config': 'Configuration',
    '/hr/leaves': 'Leave Management',
    '/hr/public-holidays': 'Public Holidays',
    '/hr/leave-config': 'Leave Configuration',
    '/my/dashboard': 'My Dashboard',
    '/my/payslips': 'My Payslips',
    '/my/profile': 'My Profile',
    '/my/loans': 'My Loans',
    '/my/leaves': 'My Leaves',
    '/policies': 'Company Policies',
    '/management/dashboard': 'Management Dashboard',
    '/management/reports': 'Payroll Reports',
    '/management/cost-report': 'Cost Analysis',
  }
  return map[location.pathname] || 'TEKONE'
}

// ─── APP LAYOUT ──────────────────────────────────────────────────────────────

export default function AppLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const title = usePageTitle()

  return (
    <div className="flex h-screen bg-surface overflow-hidden">
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      {/* Main content */}
      <div className="flex-1 flex flex-col lg:ml-64 min-w-0 overflow-hidden">
        <TopBar onMenuClick={() => setSidebarOpen(true)} title={title} />

        <main className="flex-1 overflow-y-auto">
          <div className="p-5 md:p-6 max-w-screen-xl mx-auto animate-fade-in">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  )
}
