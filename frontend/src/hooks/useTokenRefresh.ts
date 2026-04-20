import { useEffect, useRef } from 'react'
import { useAuthStore } from '../store/authStore'
import { msalInstance, loginRequest, markLoggedOut } from '../services/msal'

// Decode JWT and return exp as milliseconds epoch, or null on failure
function getTokenExp(token: string | null): number | null {
  if (!token) return null
  try {
    const payload = JSON.parse(atob(token.split('.')[1]))
    if (!payload.exp) return null
    return payload.exp * 1000
  } catch {
    return null
  }
}

const REFRESH_BUFFER_MS = 5 * 60 * 1000 // refresh 5 min before expiry
const CHECK_INTERVAL_MS = 60 * 1000     // check every 1 min

/**
 * Proactively refreshes the Azure AD token before it expires.
 * If refresh fails (e.g. MSAL has no accounts), forces logout + redirect to login.
 * This prevents the "sitting on dashboard but nothing loads" state.
 */
export function useTokenRefresh() {
  const { user, token, isDevMode, setUser, logout } = useAuthStore()
  const refreshingRef = useRef(false)

  useEffect(() => {
    if (isDevMode || !user || !token) return

    const doRefresh = async (forceLogoutOnFail: boolean) => {
      if (refreshingRef.current) return
      refreshingRef.current = true
      try {
        const accounts = msalInstance.getAllAccounts()
        if (accounts.length === 0) throw new Error('No MSAL accounts')

        const result = await msalInstance.acquireTokenSilent({
          ...loginRequest,
          account: accounts[0],
          forceRefresh: true,
        })
        if (result.idToken) {
          const current = useAuthStore.getState().user
          if (current) setUser(current, result.idToken)
        }
      } catch (err) {
        console.warn('[TokenRefresh] silent refresh failed', err)
        if (forceLogoutOnFail) {
          markLoggedOut()
          logout()
          window.location.href = '/login?expired=1'
        }
      } finally {
        refreshingRef.current = false
      }
    }

    const check = () => {
      const exp = getTokenExp(useAuthStore.getState().token)
      if (!exp) return
      const now = Date.now()
      const msLeft = exp - now

      if (msLeft <= 0) {
        // Already expired — try refresh, force logout if fails
        void doRefresh(true)
      } else if (msLeft <= REFRESH_BUFFER_MS) {
        // About to expire — refresh proactively, don't force logout yet
        void doRefresh(false)
      }
    }

    // Run once immediately, then on interval
    check()
    const interval = setInterval(check, CHECK_INTERVAL_MS)

    // Also check when tab regains focus (user returning after idle)
    const onFocus = () => check()
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onFocus)

    return () => {
      clearInterval(interval)
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onFocus)
    }
  }, [user, token, isDevMode, setUser, logout])
}
