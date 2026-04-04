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

// Request roles claim by including the app's own scope
// This is what causes the roles[] array to appear in the token
export const loginRequest = {
  scopes: [
    'openid',
    'profile',
    'email',
    'User.Read',
    `api://${import.meta.env.VITE_AZURE_CLIENT_ID}/access_as_user`,
  ],
}

export async function initializeMsal(): Promise<void> {
  await msalInstance.initialize()
}

export async function signInWithMicrosoft(): Promise<string | null> {
  try {
    const accounts = msalInstance.getAllAccounts()
    if (accounts.length > 0) {
      const silentResult = await msalInstance.acquireTokenSilent({
        ...loginRequest,
        account: accounts[0],
      })
      return silentResult.idToken
    }
    await msalInstance.loginRedirect(loginRequest)
    return null
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
