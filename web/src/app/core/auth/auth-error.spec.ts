import { authErrorMessage } from './auth-error'

describe('authErrorMessage', () => {
  it.each([
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
    ['PHONE_DISABLED', 'auth.phoneDisabled'],
    ['PHONE_UNCHANGED', 'phone.unchanged'],
    ['PHONE_IN_USE', 'phone.inUse'],
  ])('maps %s to %s', (code, key) => {
    expect(authErrorMessage({ status: 400, code }, 'fallback')).toEqual({ key })
  })

  it('says the API is unreachable when offline or behind a dead proxy', () => {
    expect(authErrorMessage({ status: 0 }, 'fallback')).toEqual({ key: 'auth.unreachable' })
    expect(authErrorMessage({ status: 504 }, 'fallback')).toEqual({ key: 'auth.unreachable' })
  })

  it.each([
    [45, 'auth.waitSeconds', 45],
    [61, 'auth.waitMinutes', 2],
    [3240, 'auth.waitMinutes', 54],
    [86_000, 'auth.waitHours', 24],
  ])('turns Retry-After %s s into %s (%s)', (seconds, key, count) => {
    const error = { status: 429, code: 'RATE_LIMITED', retryAfterSeconds: seconds }

    expect(authErrorMessage(error, 'fallback')).toEqual({ key, params: { count } })
  })

  it('falls back for anything unexpected', () => {
    expect(authErrorMessage({ status: 500 }, 'auth.sendFailed')).toEqual({ key: 'auth.sendFailed' })
  })
})
