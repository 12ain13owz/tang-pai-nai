/** Mirrors `AuthUserData` in the API (`api/src/features/auth/auth.type.ts`). */
export interface AuthUser {
  id: string
  email: string
  displayName: string
  avatarUrl: string | null
  timezone: string
  /** Whether a password is set (the user can then sign in with it). */
  hasPassword: boolean
}

/** `data` of sign-in and `/auth/refresh`. The refresh token only lives in the httpOnly cookie. */
export interface AuthSession {
  accessToken: string
  expiresIn: number
  user: AuthUser
}

/**
 * - `unknown`: not checked yet (app start)
 * - `signedIn` / `signedOut`: the API said so
 * - `unreachable`: the check couldn't reach the API (offline); try again later
 */
export type AuthStatus = 'unknown' | 'signedIn' | 'signedOut' | 'unreachable'

/** `code` values the API sends on auth errors. */
export type AuthErrorCode =
  | 'OTP_INVALID'
  | 'OTP_LOCKED'
  | 'OTP_EXPIRED'
  | 'SESSION_EXPIRED'
  | 'SESSION_REVOKED'
  | 'USER_DISABLED'
  | 'RATE_LIMITED'
  | 'INVALID_CREDENTIALS'
  | 'CURRENT_PASSWORD_INVALID'
  | 'REAUTH_REQUIRED'
  | 'PASSWORD_TOO_SHORT'
  | 'PASSWORD_TOO_LONG'
  | 'PASSWORD_TOO_WEAK'
  | 'PASSWORD_MATCHES_EMAIL'
  | 'PASSWORD_BREACHED'
