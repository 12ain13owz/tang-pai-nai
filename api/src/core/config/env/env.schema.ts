import { z } from 'zod'
import { ERRORS, LOG_LEVELS } from '@/shared/constants'
import type { LogLevel } from '@/shared/constants'
import { AppEnv, EmailProviderName, SmsProviderName } from '@/shared/types'
import type { EnvConfig } from './env.type'

const logLevel = Object.keys(LOG_LEVELS) as LogLevel[]

export const envSchema: z.ZodType<EnvConfig> = z
  .object({
    PORT: z.coerce.number().int().positive().max(65535),
    NODE_ENV: z.enum([AppEnv.DEVELOPMENT, AppEnv.PRODUCTION]),
    BASE_URL: z.string(),
    CORS_ORIGINS: z
      .string()
      .optional()
      .transform((value) =>
        (value ?? '')
          .split(',')
          .map((origin) => origin.trim())
          .filter(Boolean)
      ),
    LOG_LEVEL_CONSOLE: z.enum(logLevel),
    LOG_LEVEL_FILE: z.enum(logLevel),
    LOG_LEVEL_ERROR_FILE: z.enum(logLevel),
    LOG_SILENT: z.stringbool().default(false),
    SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
    EMAIL_PROVIDER: z.enum(EmailProviderName).default(EmailProviderName.CONSOLE),
    EMAIL_FROM: z.string().trim().min(1).default('Tang Pai Nai <no-reply@localhost>'),
    // An empty value (`SMTP_URL=""` in .env.example) means "not set".
    SMTP_URL: z
      .union([z.literal('').transform(() => undefined), z.url({ protocol: /^smtps?$/ })])
      .optional(),
    SMS_PROVIDER: z.enum(SmsProviderName).default(SmsProviderName.CONSOLE),
  })
  .superRefine((env, ctx) => {
    if (env.EMAIL_PROVIDER === EmailProviderName.SMTP && !env.SMTP_URL) {
      ctx.addIssue({
        code: 'custom',
        path: ['SMTP_URL'],
        message: ERRORS.requiredField('SMTP_URL'),
      })
    }
    // Console providers print OTPs to stdout: dev only.
    if (env.NODE_ENV === AppEnv.PRODUCTION) {
      if (env.EMAIL_PROVIDER === EmailProviderName.CONSOLE) {
        ctx.addIssue({
          code: 'custom',
          path: ['EMAIL_PROVIDER'],
          message: ERRORS.devOnly('console'),
        })
      }
      if (env.SMS_PROVIDER === SmsProviderName.CONSOLE) {
        ctx.addIssue({ code: 'custom', path: ['SMS_PROVIDER'], message: ERRORS.devOnly('console') })
      }
    }
  })
