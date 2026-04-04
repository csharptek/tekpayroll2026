import { useState, useEffect } from 'react'
import { useAuthStore, UserRole } from '../../store/authStore'
import { signInWithMicrosoft, getTokenAfterRedirect, initializeMsal } from '../../services/msal'
import api from '../../services/api'

const DEV_ROLES: { role: UserRole; label: string; description: string; color: string }[] = [
  { role: 'SUPER_ADMIN', label: 'Super Admin',  description: 'Full system access + unlock payroll', color: 'bg-purple-600' },
  { role: 'HR',          label: 'HR Admin',      description: 'Payroll, employees, payslips, config', color: 'bg-brand-600' },
  { role: 'MANAGEMENT',  label: 'Management',    description: 'Reports and dashboards', color: 'bg-emerald-600' },
  { role: 'EMPLOYEE',    label: 'Employee',      description: 'My payslips, profile, loans', color: 'bg-amber-500' },
]

const DEV_USERS: Record<UserRole, any> = {
  SUPER_ADMIN: { id: 'dev-super-admin', name: 'Dev Super Admin', email: 'superadmin@csharptek.com', role: 'SUPER_ADMIN' },
  HR:          { id: 'dev-hr',          name: 'Dev HR Manager',   email: 'hr@csharptek.com',         role: 'HR' },
  MANAGEMENT:  { id: 'dev-mgmt',        name: 'Dev Manager',      email: 'mgmt@csharptek.com',       role: 'MANAGEMENT' },
  EMPLOYEE:    { id: 'dev-employee',    name: 'Dev Employee',      email: 'employee@csharptek.com',   role: 'EMPLOYEE' },
}

export default function LoginPage() {
  const { isDevMode, setUser } = useAuthStore()
  const [selecting, setSelecting] = useState<UserRole | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // On mount: check if Microsoft just redirected back with a token
  useEffect(() => {
    async function handleRedirect() {
      try {
        await initializeMsal()
        const result = await getTokenAfterRedirect()
        if (result) {
          await loginWithToken(result.token)
        }
      } catch (err: any) {
        console.error('[AUTH] Redirect handling failed:', err)
        setError('Login failed. Please try again.')
      }
    }
    if (!isDevMode) {
      handleRedirect()
    }
  }, [])

  async function loginWithToken(token: string) {
    setLoading(true)
    setError('')
    try {
      // Send token to backend — backend validates with Microsoft JWKS
      const res = await api.post('/api/auth/microsoft/callback', { token })
      const { user, accessToken } = res.data.data
      setUser(user, accessToken)

      // Navigate based on role
      if (user.role === 'EMPLOYEE') {
        window.location.href = '/my/dashboard'
      } else if (user.role === 'MANAGEMENT') {
        window.location.href = '/management/dashboard'
      } else {
        window.location.href = '/hr/dashboard'
      }
    } catch (err: any) {
      const msg = err?.response?.data?.error || 'Login failed. Make sure your account is registered in the payroll system.'
      setError(msg)
      setLoading(false)
    }
  }

  async function handleMicrosoftLogin() {
    setLoading(true)
    setError('')
    try {
      await initializeMsal()
      await signInWithMicrosoft()
      // Page will redirect to Microsoft — loginWithToken called on return via useEffect
    } catch (err: any) {
      setError('Could not connect to Microsoft. Please try again.')
      setLoading(false)
    }
  }

  function handleDevLogin(role: UserRole) {
    setSelecting(role)
    const user = DEV_USERS[role]
    const authState = {
      state: { user, token: 'dev-token', devRole: role },
      version: 0
    }
    localStorage.setItem('csharptek-auth', JSON.stringify(authState))
    setTimeout(() => {
      if (role === 'EMPLOYEE') {
        window.location.href = '/my/dashboard'
      } else if (role === 'MANAGEMENT') {
        window.location.href = '/management/dashboard'
      } else {
        window.location.href = '/hr/dashboard'
      }
    }, 100)
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-brand-600 via-brand-700 to-brand-900 flex items-center justify-center p-4">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-32 -right-32 w-96 h-96 rounded-full bg-white/5 blur-3xl" />
        <div className="absolute -bottom-32 -left-32 w-96 h-96 rounded-full bg-white/5 blur-3xl" />
      </div>

      <div className="relative w-full max-w-md animate-slide-up">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-white/10 backdrop-blur-sm border border-white/20 mb-4">
            <span className="text-2xl font-display font-bold text-white">C#</span>
          </div>
          <h1 className="text-2xl font-display font-bold text-white">CSharpTek Payroll</h1>
          <p className="text-brand-200 text-sm mt-1">Internal Payroll Management System</p>
        </div>

        <div className="bg-white rounded-2xl shadow-2xl overflow-hidden">
          {/* Production Microsoft SSO */}
          {!isDevMode && (
            <div className="p-8">
              <button
                onClick={handleMicrosoftLogin}
                disabled={loading}
                className="w-full flex items-center justify-center gap-3 px-4 py-3 border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors duration-150 font-medium text-slate-700 shadow-sm disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {loading ? (
                  <span className="w-4 h-4 border-2 border-slate-300 border-t-brand-600 rounded-full animate-spin" />
                ) : (
                  <MicrosoftIcon />
                )}
                {loading ? 'Signing in...' : 'Sign in with Microsoft'}
              </button>

              {error && (
                <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 text-center">
                  {error}
                </div>
              )}

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
                    className="w-full flex items-center gap-3 p-3 rounded-xl border border-slate-100 hover:border-slate-200 hover:shadow-card-md transition-all duration-150 text-left disabled:opacity-60 disabled:cursor-not-allowed group"
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
