import { PublicClientApplication, Configuration, AccountInfo } from '@azure/msal-browser'

const msalConfig: Configuration = {
  auth: {
    clientId:    import.meta.env.VITE_AZURE_CLIENT_ID || '',
    authority:   `https://login.microsoftonline.com/${import.meta.env.VITE_AZURE_TENANT_ID}`,
    redirectUri: import.meta.env.VITE_AZURE_REDIRECT_URI || window.location.origin,
  },
  cache: {
    cacheLocation: 'localStorage',
    storeAuthStateInCookie: false,
  },
}

export const msalInstance = new PublicClientApplication(msalConfig)

export const loginRequest = {
  scopes: ['openid', 'profile', 'email'],
}

// Flag key — set true after explicit logout so login page doesn't auto-sign-in
const LOGGED_OUT_KEY = 'csharptek-logged-out'

export function markLoggedOut() {
  sessionStorage.setItem(LOGGED_OUT_KEY, 'true')
}

export function clearLoggedOut() {
  sessionStorage.removeItem(LOGGED_OUT_KEY)
}

export function wasLoggedOut(): boolean {
  return sessionStorage.getItem(LOGGED_OUT_KEY) === 'true'
}

export async function initializeMsal(): Promise<void> {
  await msalInstance.initialize()
}

export async function signInWithMicrosoft(): Promise<string | null> {
  try {
    clearLoggedOut() // user is intentionally signing in
    // Always use prompt: 'select_account' — prevents auto-login with cached account
    await msalInstance.loginRedirect({
      ...loginRequest,
      prompt: 'select_account',
    })
    return null
  } catch (err) {
    console.error('[MSAL] Sign in error:', err)
    throw err
  }
}

export async function getTokenAfterRedirect(): Promise<{ token: string; account: AccountInfo } | null> {
  const result = await msalInstance.handleRedirectPromise()

  // Coming back from Microsoft login redirect
  if (result && result.idToken) {
    clearLoggedOut()
    return { token: result.idToken, account: result.account }
  }

  // Do NOT silently re-authenticate if the user explicitly logged out
  if (wasLoggedOut()) return null

  // No redirect result — don't auto-login with cached account
  // User must click "Sign in with Microsoft" explicitly
  return null
}

export async function signOut(): Promise<void> {
  markLoggedOut()
  const accounts = msalInstance.getAllAccounts()
  if (accounts.length > 0) {
    // postLogoutRedirectUri sends user back to login page cleanly
    await msalInstance.logoutRedirect({
      account: accounts[0],
      postLogoutRedirectUri: window.location.origin + '/login',
    })
  } else {
    window.location.href = '/login'
  }
}
