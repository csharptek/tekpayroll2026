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

// Scopes requested — basic profile + our API
export const loginRequest = {
  scopes: ['openid', 'profile', 'email', 'User.Read'],
}

export async function initializeMsal(): Promise<void> {
  await msalInstance.initialize()
  // Handle redirect response (called after Microsoft redirects back)
  await msalInstance.handleRedirectPromise()
}

export async function signInWithMicrosoft(): Promise<string | null> {
  try {
    // Try silent first (if user already logged in)
    const accounts = msalInstance.getAllAccounts()
    if (accounts.length > 0) {
      const silentResult = await msalInstance.acquireTokenSilent({
        ...loginRequest,
        account: accounts[0],
      })
      return silentResult.idToken
    }

    // Otherwise redirect to Microsoft login
    await msalInstance.loginRedirect(loginRequest)
    return null // Will return after redirect
  } catch (err) {
    console.error('[MSAL] Sign in error:', err)
    throw err
  }
}

export async function getTokenAfterRedirect(): Promise<{ token: string; account: AccountInfo } | null> {
  const result = await msalInstance.handleRedirectPromise()
  if (result && result.idToken) {
    return { token: result.idToken, account: result.account }
  }

  // Check if already signed in
  const accounts = msalInstance.getAllAccounts()
  if (accounts.length > 0) {
    try {
      const silentResult = await msalInstance.acquireTokenSilent({
        ...loginRequest,
        account: accounts[0],
      })
      return { token: silentResult.idToken, account: accounts[0] }
    } catch {
      return null
    }
  }

  return null
}

export async function signOut(): Promise<void> {
  const accounts = msalInstance.getAllAccounts()
  if (accounts.length > 0) {
    await msalInstance.logoutRedirect({ account: accounts[0] })
  }
}
