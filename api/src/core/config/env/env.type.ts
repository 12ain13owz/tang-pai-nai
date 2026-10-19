import type { LogLevel } from '@/shared/constants'
import type {
  AppEnv,
  EmailProviderName,
  PasswordBreachCheck,
  SmsProviderName,
} from '@/shared/types'

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
  DATABASE_URL: string
  DATABASE_AUTH_TOKEN?: string
  WEB_ORIGIN: string
  TRUST_PROXY_HOPS: number
  JWT_SECRET: string
  OTP_PEPPER: string
  SIGNUP_ENABLED: boolean
  EMAIL_DAILY_LIMIT: number
  PASSWORD_BREACH_CHECK: PasswordBreachCheck
  HIBP_API_URL: string
  GOOGLE_CLIENT_ID?: string
  GOOGLE_CLIENT_SECRET?: string
  GOOGLE_ISSUER: string
}
