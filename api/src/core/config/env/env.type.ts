import type { LogLevel } from '@/shared/constants'
import type { AppEnv, EmailProviderName, SmsProviderName } from '@/shared/types'

export type EnvConfig = {
  PORT: number
  NODE_ENV: AppEnv
  BASE_URL: string
  CORS_ORIGINS: string[]
  LOG_LEVEL_CONSOLE: LogLevel
  LOG_LEVEL_FILE: LogLevel
  LOG_LEVEL_ERROR_FILE: LogLevel
  LOG_SILENT: boolean
  SHUTDOWN_TIMEOUT_MS: number
  EMAIL_PROVIDER: EmailProviderName
  EMAIL_FROM: string
  SMTP_URL?: string
  SMS_PROVIDER: SmsProviderName
}
