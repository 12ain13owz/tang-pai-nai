import type { EnvConfig } from '@/core/config'
import { AppError } from '@/core/error'
import { ERRORS, ErrorSeverity, HttpStatus } from '@/shared/constants'
import { EmailProviderName, SmsProviderName } from '@/shared/types'
import { createConsoleEmailProvider } from './email.console'
import { createSmtpEmailProvider } from './email.smtp'
import { createConsoleSmsProvider } from './sms.console'
import { createDisabledSmsProvider } from './sms.disabled'
import type { EmailProvider, SmsProvider } from './notification.type'

// Provider registries: EMAIL_PROVIDER / SMS_PROVIDER pick one entry each. To add a provider (an
// HTTP mail API, Twilio, ThaiBulkSMS, …): add its value to the enum in `@/shared/types`, write an
// `<channel>.<provider>.ts` adapter that implements the port, and add an entry here.

type EmailProviderFactory = (env: EnvConfig) => EmailProvider
type SmsProviderFactory = (env: EnvConfig) => SmsProvider

const emailProviders: Record<EmailProviderName, EmailProviderFactory> = {
  [EmailProviderName.CONSOLE]: (env) => createConsoleEmailProvider({ from: env.EMAIL_FROM }),
  [EmailProviderName.SMTP]: (env) => {
    if (!env.SMTP_URL) {
      throw new AppError(
        ERRORS.requiredField('SMTP_URL'),
        HttpStatus.INTERNAL_SERVER_ERROR,
        ErrorSeverity.ERROR
      ).withOperation('createEmailProvider')
    }
    return createSmtpEmailProvider({ from: env.EMAIL_FROM, url: env.SMTP_URL })
  },
}

const smsProviders: Record<SmsProviderName, SmsProviderFactory> = {
  [SmsProviderName.CONSOLE]: () => createConsoleSmsProvider(),
  [SmsProviderName.DISABLED]: () => createDisabledSmsProvider(),
}

export const createEmailProvider = (env: EnvConfig): EmailProvider =>
  emailProviders[env.EMAIL_PROVIDER](env)

export const createSmsProvider = (env: EnvConfig): SmsProvider =>
  smsProviders[env.SMS_PROVIDER](env)
