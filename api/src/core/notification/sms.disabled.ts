import { AppError } from '@/core/error'
import { ErrorSeverity, HttpStatus } from '@/shared/constants'
import { NOTIFICATION_MESSAGE } from './notification.const'
import type { SmsProvider } from './notification.type'

/** For environments with no SMS provider yet: the app starts, and any send fails with 503. */
export const createDisabledSmsProvider = (): SmsProvider => ({
  name: 'disabled',
  send: async () =>
    Promise.reject(
      new AppError(
        NOTIFICATION_MESSAGE.SMS_DISABLED,
        HttpStatus.SERVICE_UNAVAILABLE,
        ErrorSeverity.WARN
      ).withOperation('smsProvider.send')
    ),
})
