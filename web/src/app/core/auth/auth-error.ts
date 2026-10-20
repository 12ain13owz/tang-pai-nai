import { isUnreachable } from '@/core/api'
import type { ApiError } from '@/core/api'

/** A translation key and its params, translated in the template so it follows a language switch. */
export interface UiMessage {
  key: string
  params?: Record<string, unknown>
}

const MINUTE = 60
const HOUR = 60 * MINUTE

const waitMessage = (seconds = MINUTE): UiMessage => {
  if (seconds < MINUTE) {
    return { key: 'auth.waitSeconds', params: { count: seconds } }
  }
  if (seconds < HOUR) {
    return { key: 'auth.waitMinutes', params: { count: Math.ceil(seconds / MINUTE) } }
  }
  return { key: 'auth.waitHours', params: { count: Math.ceil(seconds / HOUR) } }
}

const CODE_MESSAGES = new Map<string, string>([
  ['OTP_INVALID', 'auth.codeInvalid'],
  ['OTP_LOCKED', 'auth.codeLocked'],
  ['OTP_EXPIRED', 'auth.codeExpired'],
  ['USER_DISABLED', 'auth.userDisabled'],
  ['INVALID_CREDENTIALS', 'auth.invalidCredentials'],
  ['CURRENT_PASSWORD_INVALID', 'auth.currentPasswordInvalid'],
  ['PASSWORD_TOO_SHORT', 'auth.passwordTooShort'],
  ['PASSWORD_TOO_LONG', 'auth.passwordTooLong'],
  ['PASSWORD_TOO_WEAK', 'auth.passwordWeak'],
  ['PASSWORD_MATCHES_EMAIL', 'auth.passwordSameAsEmail'],
  ['PASSWORD_BREACHED', 'auth.passwordBreached'],
  ['IDENTITY_ALREADY_LINKED', 'security.googleAlreadyLinked'],
  ['GOOGLE_IN_USE', 'security.googleInUse'],
])

/** What to tell the user about a failed auth call; `fallback` covers anything unexpected. */
export const authErrorMessage = (error: ApiError, fallback: string): UiMessage => {
  if (isUnreachable(error)) {
    return { key: 'auth.unreachable' }
  }
  if (error.code === 'RATE_LIMITED' || error.status === 429) {
    return waitMessage(error.retryAfterSeconds)
  }
  return { key: (error.code && CODE_MESSAGES.get(error.code)) ?? fallback }
}
