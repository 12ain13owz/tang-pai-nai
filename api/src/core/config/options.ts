import { ERRORS, HttpStatus } from '@/shared/constants'
import { AppEnv } from '@/shared/types'
import { env } from './env'
import type { CorsOptions } from 'cors'
import type { Options as RateLimitOptions } from 'express-rate-limit'
import type { HelmetOptions } from 'helmet'

export const corsOptions: CorsOptions = {
  origin: env.NODE_ENV === AppEnv.DEVELOPMENT ? true : env.CORS_ORIGINS,
  credentials: true,
}

export const helmetOptions: HelmetOptions = {
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", 'cdn.jsdelivr.net'],
      connectSrc: ["'self'", 'cdn.jsdelivr.net'],
    },
  },
}

export const rateLimitOptions: Partial<RateLimitOptions> = {
  windowMs: 15 * 60 * 1000,
  max: env.NODE_ENV === AppEnv.PRODUCTION ? 1000 : 10_000,
  message: ERRORS.TOO_MANY_REQUESTS,
  statusCode: HttpStatus.TOO_MANY_REQUESTS,
  standardHeaders: true,
  legacyHeaders: false,
}
