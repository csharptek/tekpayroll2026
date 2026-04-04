import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore, UserRole } from '../../store/authStore'

const DEV_ROLES: { role: UserRole; label: string; description: string; color: string }[] = [
  { role: 'SUPER_ADMIN', label: 'Super Admin',  description: 'Full system access + unlock payroll', color: 'bg-purple-600' },
  { role: 'HR',          label: 'HR Admin',      description: 'Payroll, employees, payslips, config', color: 'bg-brand-600' },
  { role: 'MANAGEMENT',  label: 'Management',    description: 'Reports and dashboards', color: 'bg-emerald-600' },
  { role: 'EMPLOYEE',    label: 'Employee',      description: 'My payslips, profile, loans', color: 'bg-amber-500' },
]

export default function LoginPage() {
  const { setDevRole, isAuthenticated, isDevMode } = useAuthStore()
  const navigate = useNavigate()
  const [selecting, setSelecting] = useState<UserRole | null>(null)

  if (isAuthenticated()) {
    navigate('/', { replace: true })
    return null
  }

  function handleDevLogin(role: UserRole) {
    setSelecting(role)
    setTimeout(() => {
      setDevRole(role, `dev-${role.toLowerCase()}`)
      navigate('/', { replace: true })
    }, 600)
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-brand-600 via-brand-700 to-brand-900 flex items-center justify-center p-4">

      {/* Background pattern */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-32 -right-32 w-96 h-96 rounded-full bg-white/5 blur-3xl" />
        <div className="absolute -bottom-32 -left-32 w-96 h-96 rounded-full bg-white/5 blur-3xl" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full bg-white/[0.02] blur-3xl" />
      </div>

      <div className="relative w-full max-w-md animate-slide-up">

        {/* Logo & Brand */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-white/10 backdrop-blur-sm border border-white/20 mb-4">
            <span className="text-2xl font-display font-bold text-white">C#</span>
          </div>
          <h1 className="text-2xl font-display font-bold text-white">CSharpTek Payroll</h1>
          <p className="text-brand-200 text-sm mt-1">Internal Payroll Management System</p>
        </div>

        {/* Card */}
        <div className="bg-white rounded-2xl shadow-2xl overflow-hidden">

          {/* Production SSO button */}
          {!isDevMode && (
            <div className="p-8">
              <button className="w-full flex items-center justify-center gap-3 px-4 py-3 border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors duration-150 font-medium text-slate-700 shadow-sm">
                <MicrosoftIcon />
                Sign in with Microsoft
              </button>
              <p className="text-center text-xs text-slate-400 mt-4">
                Use your CSharpTek Microsoft 365 account
              </p>
            </div>
          )}

          {/* Dev bypass */}
          {isDevMode && (
            <div className="p-6">
              <div className="flex items-center gap-2 mb-4">
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200">
                  DEV MODE
                </span>
                <span className="text-xs text-slate-500">Select a role to continue</span>
              </div>

              <div className="space-y-2">
                {DEV_ROLES.map(({ role, label, description, color }) => (
                  <button
                    key={role}
                    onClick={() => handleDevLogin(role)}
                    disabled={!!selecting}
                    className={`w-full flex items-center gap-3 p-3 rounded-xl border border-slate-100
                      hover:border-slate-200 hover:shadow-card-md transition-all duration-150 text-left
                      disabled:opacity-60 disabled:cursor-not-allowed group`}
                  >
                    <div className={`w-9 h-9 rounded-lg ${color} flex items-center justify-center flex-shrink-0 shadow-sm`}>
                      <span className="text-xs font-bold text-white">
                        {selecting === role ? '⟳' : label.charAt(0)}
                      </span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-slate-800 group-hover:text-brand-700 transition-colors">{label}</div>
                      <div className="text-xs text-slate-400">{description}</div>
                    </div>
                    <svg className="w-4 h-4 text-slate-300 group-hover:text-brand-400 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </button>
                ))}
              </div>

              <p className="text-center text-xs text-slate-400 mt-4 pt-4 border-t border-slate-100">
                Dev bypass active — set <code className="bg-slate-100 px-1 rounded">VITE_DEV_AUTH_BYPASS=false</code> for production
              </p>
            </div>
          )}
        </div>

        <p className="text-center text-brand-300 text-xs mt-6">
          © {new Date().getFullYear()} CSharpTek · Internal use only
        </p>
      </div>
    </div>
  )
}

function MicrosoftIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 21 21" fill="none">
      <rect x="1" y="1" width="9" height="9" fill="#F25022"/>
      <rect x="11" y="1" width="9" height="9" fill="#7FBA00"/>
      <rect x="1" y="11" width="9" height="9" fill="#00A4EF"/>
      <rect x="11" y="11" width="9" height="9" fill="#FFB900"/>
    </svg>
  )
}
