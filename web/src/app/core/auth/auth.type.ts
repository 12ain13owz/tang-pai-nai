/** Mirrors `AuthUserData` in the API (`api/src/features/auth/auth.type.ts`). */
export interface AuthUser {
  id: string
  email: string
  displayName: string
  avatarUrl: string | null
  timezone: string
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
