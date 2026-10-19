import { env } from '@/core/config'
import { db } from '@/core/database'
import { notifier } from '@/core/notification'
import { accessTokens } from '@/core/security'
import { AUTH_LIMITS } from './auth.const'
import { createAuthController } from './auth.controller'
import { createDrizzleAuthRepository } from './auth.repository.drizzle'
import { createAuthRouter } from './auth.routes'
import { createAuthService } from './auth.service'

const authRepo = createDrizzleAuthRepository(db)
export const authService = createAuthService({
  authRepo,
  notifier,
  accessTokens,
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
