import { errors, jwtVerify, SignJWT } from 'jose'
import { v7 as uuidv7 } from 'uuid'

const ALGORITHM = 'HS256'

export interface AccessTokenClaims {
  /** User id. */
  sub: string
  /** Session family id. */
  sid: string
}

export interface AccessTokenOptions {
  secret: string
  issuer: string
  audience: string
  ttlSeconds: number
}

/**
 * Short-lived JWT access tokens (auth spec → Tokens & session). HS256 is pinned on verify, so a
 * token with any other `alg` (including `none`) is rejected.
 */
export const createAccessTokens = ({
  secret,
  issuer,
  audience,
  ttlSeconds,
}: AccessTokenOptions) => {
  const key = new TextEncoder().encode(secret)

  const sign = async ({ sub, sid }: AccessTokenClaims): Promise<string> =>
    new SignJWT({ sid })
      .setProtectedHeader({ alg: ALGORITHM, typ: 'JWT' })
      .setSubject(sub)
      .setIssuer(issuer)
      .setAudience(audience)
      .setJti(uuidv7())
      .setIssuedAt()
      .setExpirationTime(`${ttlSeconds}s`)
      .sign(key)

  /** Claims of a valid token, or `null` when it's malformed, forged or expired. */
  const verify = async (token: string): Promise<AccessTokenClaims | null> => {
    try {
      const { payload } = await jwtVerify(token, key, {
        algorithms: [ALGORITHM],
        issuer,
        audience,
        requiredClaims: ['sub', 'sid', 'exp', 'iat', 'jti'],
      })
      if (typeof payload.sub !== 'string' || typeof payload.sid !== 'string') {
        return null
      }
      return { sub: payload.sub, sid: payload.sid }
    } catch (error) {
      if (error instanceof errors.JOSEError) {
        return null
      }
      throw error
    }
  }

  return { sign, verify, ttlSeconds }
}

export type AccessTokens = ReturnType<typeof createAccessTokens>
