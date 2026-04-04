import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type UserRole = 'SUPER_ADMIN' | 'HR' | 'MANAGEMENT' | 'EMPLOYEE'

export interface AuthUser {
  id: string
  name: string
  email: string
  role: UserRole
  entraId?: string
}

interface AuthStore {
  user: AuthUser | null
  token: string | null
  devRole: UserRole | null
  isDevMode: boolean

  setUser: (user: AuthUser, token?: string) => void
  setDevRole: (role: UserRole, userId: string) => void
  logout: () => void
  isAuthenticated: () => boolean
  hasRole: (...roles: UserRole[]) => boolean
}

// Dev users for each role
const DEV_USERS: Record<UserRole, AuthUser> = {
  SUPER_ADMIN: { id: 'dev-super-admin', name: 'Dev Super Admin', email: 'superadmin@csharptek.com', role: 'SUPER_ADMIN' },
  HR: { id: 'dev-hr', name: 'Dev HR Manager', email: 'hr@csharptek.com', role: 'HR' },
  MANAGEMENT: { id: 'dev-mgmt', name: 'Dev Manager', email: 'mgmt@csharptek.com', role: 'MANAGEMENT' },
  EMPLOYEE: { id: 'dev-employee', name: 'Dev Employee', email: 'employee@csharptek.com', role: 'EMPLOYEE' },
}

export const useAuthStore = create<AuthStore>()(
  persist(
    (set, get) => ({
      user: null,
      token: null,
      devRole: null,
      isDevMode: import.meta.env.VITE_DEV_AUTH_BYPASS === 'true',

      setUser: (user, token) => set({ user, token }),

      setDevRole: (role, _userId) => {
        const user = DEV_USERS[role]
        set({ user, devRole: role, token: 'dev-token' })
      },

      logout: () => set({ user: null, token: null, devRole: null }),

      isAuthenticated: () => !!get().user,

      hasRole: (...roles) => {
        const { user } = get()
        if (!user) return false
        return roles.includes(user.role)
      },
    }),
    {
      name: 'csharptek-auth',
      partialize: (state) => ({ user: state.user, token: state.token, devRole: state.devRole }),
    }
  )
)
