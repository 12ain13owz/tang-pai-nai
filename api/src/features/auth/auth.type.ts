/** The signed-in user as the web app sees it. */
export interface AuthUserData {
  id: string
  email: string
  displayName: string
  avatarUrl: string | null
  timezone: string
  /** Whether the user has set a password (it can then sign in with one). */
  hasPassword: boolean
  /** Linked sign-in providers (rule 14), oldest first; empty when none. */
  identities: AuthIdentityData[]
  /** The verified mobile number in E.164 (rule 25), or `null`. */
  phone: string | null
}

export interface AuthIdentityData {
  provider: 'google'
  /** The provider's email when it was linked. */
  email: string
  linkedAt: string
}

/** `GET /auth/providers`: which extra ways to sign in are switched on. */
export interface AuthProvidersData {
  google: boolean
  /** Phone sign-in and adding a number (rule 21): off when `SMS_PROVIDER=disabled`. */
  phone: boolean
}

/** `data` of sign-in and refresh. The refresh token only travels in the cookie. */
export interface AuthSessionData {
  accessToken: string
  /** Seconds until `accessToken` expires. */
  expiresIn: number
  user: AuthUserData
}

/** `GET /auth/sessions`: one signed-in device (a session family, rule 28). */
export interface AuthDeviceSessionData {
  /** The session family id; `DELETE /auth/sessions/:id` takes it. */
  id: string
  /** The latest user agent seen, if any; the web turns it into "Chrome · Android". */
  userAgent: string | null
  signedInAt: string
  lastUsedAt: string
  /** The caller's own session. */
  current: boolean
}

/** `DELETE /auth/sessions`: how many other devices were signed out. */
export interface AuthSessionsRevokedData {
  revoked: number
}

/** `POST /auth/google/link`: where the web app sends the browser next (rule 29). */
export interface AuthGoogleLinkData {
  authorizationUrl: string
}
