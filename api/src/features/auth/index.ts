import { env } from '@/core/config'
import { db } from '@/core/database'
import { notifier } from '@/core/notification'
import { accessTokens, createPwnedPasswordsChecker, skipBreachCheck } from '@/core/security'
import { PasswordBreachCheck } from '@/shared/types'
import { AUTH_LIMITS } from './auth.const'
import { createAuthController } from './auth.controller'
import { createDrizzleAuthRepository } from './auth.repository.drizzle'
import { createAuthRouter } from './auth.routes'
import { createAuthService } from './auth.service'

const authRepo = createDrizzleAuthRepository(db)
const breachChecker =
  env.PASSWORD_BREACH_CHECK === PasswordBreachCheck.HIBP
    ? createPwnedPasswordsChecker({
        baseUrl: env.HIBP_API_URL,
        timeoutMs: AUTH_LIMITS.BREACH_CHECK_TIMEOUT_MS,
      })
    : skipBreachCheck
export const authService = createAuthService({
  authRepo,
  notifier,
  accessTokens,
  breachChecker,
  config: {
    webOrigin: env.WEB_ORIGIN,
    signupEnabled: env.SIGNUP_ENABLED,
    emailDailyLimit: env.EMAIL_DAILY_LIMIT,
    startMinDurationMs: AUTH_LIMITS.START_MIN_DURATION_MS,
  },
})
const authController = createAuthController(authService)

export const authRouter = createAuthRouter(authController, env.WEB_ORIGIN)
export type { User } from './auth.entity'
