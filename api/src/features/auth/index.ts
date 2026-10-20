import { env } from '@/core/config'
import { db } from '@/core/database'
import { notifier } from '@/core/notification'
import {
  accessTokens,
  createOidcClient,
  createPwnedPasswordsChecker,
  createSealedBox,
  skipBreachCheck,
} from '@/core/security'
import { PasswordBreachCheck, SmsProviderName } from '@/shared/types'
import { AUTH_LIMITS, GOOGLE_OIDC } from './auth.const'
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
// Rule 14: off unless both Google settings are present (Local-first).
const google =
  env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
    ? {
        oidc: createOidcClient({
          issuer: env.GOOGLE_ISSUER,
          clientId: env.GOOGLE_CLIENT_ID,
          clientSecret: env.GOOGLE_CLIENT_SECRET,
          redirectUri: `${env.WEB_ORIGIN}${GOOGLE_OIDC.CALLBACK_PATH}`,
          scope: GOOGLE_OIDC.SCOPE,
          authorizationParams: { prompt: GOOGLE_OIDC.PROMPT },
          timeoutMs: AUTH_LIMITS.GOOGLE_TIMEOUT_MS,
          clockToleranceSeconds: AUTH_LIMITS.GOOGLE_CLOCK_TOLERANCE_S,
        }),
        flowBox: createSealedBox(env.JWT_SECRET, 'google-oidc-flow'),
      }
    : null
export const authService = createAuthService({
  authRepo,
  notifier,
  accessTokens,
  breachChecker,
  google,
  config: {
    webOrigin: env.WEB_ORIGIN,
    signupEnabled: env.SIGNUP_ENABLED,
    emailDailyLimit: env.EMAIL_DAILY_LIMIT,
    startMinDurationMs: AUTH_LIMITS.START_MIN_DURATION_MS,
    // Rule 21: no SMS provider, no phone sign-in.
    phoneEnabled: env.SMS_PROVIDER !== SmsProviderName.DISABLED,
    smsDailyLimit: env.SMS_DAILY_LIMIT,
  },
})
const authController = createAuthController(authService, { webOrigin: env.WEB_ORIGIN })

export const authRouter = createAuthRouter(authController, env.WEB_ORIGIN)
export type { User } from './auth.entity'
