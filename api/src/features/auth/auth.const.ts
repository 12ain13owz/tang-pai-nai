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
  /** Rule 12: failed password checks, per email and per IP. */
  PASSWORD_FAILURES_PER_EMAIL: { limit: 5, windowMs: 15 * MINUTE },
  PASSWORD_FAILURES_PER_IP: { limit: 30, windowMs: 15 * MINUTE },
  /** Rule 13: how long after a credential check `PUT/DELETE /auth/password` needs no other proof. */
  RECENT_AUTH_MS: 10 * MINUTE,
  /** Rule 11: HIBP answers slower than this count as unreachable (fail open). */
  BREACH_CHECK_TIMEOUT_MS: 3000,
} as const

/** Rule 11, the owner's choice (8+, four character classes). The web mirrors these numbers. */
export const PASSWORD_POLICY = {
  MIN_LENGTH: 8,
  MAX_LENGTH: 128,
  /** Each must match at least once: lowercase, uppercase, digit, anything else. */
  REQUIRED_CLASSES: [/\p{Ll}/u, /\p{Lu}/u, /\p{Nd}/u, /[^\p{L}\p{N}]/u],
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
  INVALID_CREDENTIALS = 'INVALID_CREDENTIALS',
  CURRENT_PASSWORD_INVALID = 'CURRENT_PASSWORD_INVALID',
  REAUTH_REQUIRED = 'REAUTH_REQUIRED',
  PASSWORD_TOO_SHORT = 'PASSWORD_TOO_SHORT',
  PASSWORD_TOO_LONG = 'PASSWORD_TOO_LONG',
  PASSWORD_TOO_WEAK = 'PASSWORD_TOO_WEAK',
  PASSWORD_MATCHES_EMAIL = 'PASSWORD_MATCHES_EMAIL',
  PASSWORD_BREACHED = 'PASSWORD_BREACHED',
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
  INVALID_CREDENTIALS: 'Invalid email or password',
  CURRENT_PASSWORD_INVALID: 'The current password is incorrect',
  REAUTH_REQUIRED: 'Confirm it is you first',
  REAUTH_CODE_SENT: 'A confirmation code is on its way',
  REAUTHENTICATED: 'Identity confirmed',
  PASSWORD_SAVED: 'Password saved',
  PASSWORD_REMOVED: 'Password removed',
  PASSWORD_TOO_SHORT: `The password must be at least ${PASSWORD_POLICY.MIN_LENGTH} characters`,
  PASSWORD_TOO_LONG: `The password must be at most ${PASSWORD_POLICY.MAX_LENGTH} characters`,
  PASSWORD_TOO_WEAK:
    'The password needs a lowercase letter, an uppercase letter, a digit and a symbol',
  PASSWORD_MATCHES_EMAIL: 'The password must not be your email',
  PASSWORD_BREACHED: 'This password has appeared in a data breach. Choose another one',
}

/** Name of the refresh-token cookie (`__Host-`: Secure, Path=/, no Domain). */
export const REFRESH_COOKIE = '__Host-rt'
