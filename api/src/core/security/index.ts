import { env } from '@/core/config'
import { createAccessTokens } from './access-token'
import { createKeyedHasher } from './secret'

export const ACCESS_TOKEN_TTL_SECONDS = 10 * 60

export const accessTokens = createAccessTokens({
  secret: env.JWT_SECRET,
  issuer: 'tang-pai-nai-api',
  audience: 'tang-pai-nai-web',
  ttlSeconds: ACCESS_TOKEN_TTL_SECONDS,
})

/** Hashes OTP codes with `OTP_PEPPER` (auth spec rule 18). */
export const hashCode = createKeyedHasher(env.OTP_PEPPER)

export { createAccessTokens } from './access-token'
export type { AccessTokenClaims, AccessTokens } from './access-token'
export * from './secret'
export * from './password'
export * from './breached-password'
