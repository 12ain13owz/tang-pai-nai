const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** Numbers from docs/features/auth.md (rules 4–7, Tokens & session, rule 20). */
export const AUTH_LIMITS = {
  CODE_DIGITS: 6,
  CHALLENGE_TTL_MS: 10 * MINUTE,
  MAX_CODE_ATTEMPTS: 5,
  /** Every `/email/start` takes at least this long, mail or not (rule 5). */
  START_MIN_DURATION_MS: 700,
  RESEND_COOLDOWN_MS: MINUTE,
  STARTS_PER_EMAIL: { limit: 5, windowMs: HOUR },
  STARTS_PER_IP: { limit: 20, windowMs: HOUR },
  VERIFIES_PER_IP: { limit: 30, windowMs: 15 * MINUTE },
  EMAILS_PER_DAY_WINDOW_MS: DAY,
  SESSION_IDLE_MS: 30 * DAY,
  SESSION_ABSOLUTE_MS: 180 * DAY,
  CLEANUP_AFTER_MS: 7 * DAY,
  USER_AGENT_MAX: 255,
} as const

/** `code` beside `message` in error responses, for the web app to pick its text. */
export enum AuthErrorCode {
  OTP_INVALID = 'OTP_INVALID',
  OTP_LOCKED = 'OTP_LOCKED',
  OTP_EXPIRED = 'OTP_EXPIRED',
  SESSION_EXPIRED = 'SESSION_EXPIRED',
  SESSION_REVOKED = 'SESSION_REVOKED',
  USER_DISABLED = 'USER_DISABLED',
  RATE_LIMITED = 'RATE_LIMITED',
}

export const AUTH_MESSAGE = {
  CODE_SENT: 'If the address can sign in, a code and a link are on their way',
  SIGNED_IN: 'Signed in',
  REFRESHED: 'Session refreshed',
  SIGNED_OUT: 'Signed out',
  CODE_INVALID: 'The code is incorrect',
  CODE_LOCKED: 'Too many wrong codes. Request a new one',
  CODE_EXPIRED: 'The code or link has expired. Request a new one',
  SESSION_EXPIRED: 'Your session has expired. Sign in again',
  SESSION_REVOKED: 'Your session was signed out. Sign in again',
  USER_DISABLED: 'This account is disabled',
}

/** Name of the refresh-token cookie (`__Host-`: Secure, Path=/, no Domain). */
export const REFRESH_COOKIE = '__Host-rt'
