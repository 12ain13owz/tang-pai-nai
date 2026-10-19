import { SignJWT } from 'jose'
import { describe, expect, it } from 'vitest'
import { createAccessTokens } from './access-token'

const SECRET = 'access-token-test-secret-0123456789'
const options = { secret: SECRET, issuer: 'api', audience: 'web', ttlSeconds: 600 }
const tokens = createAccessTokens(options)
const key = new TextEncoder().encode(SECRET)

const base64url = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url')

describe('createAccessTokens', () => {
  it('signs a token that verifies back to its claims', async () => {
    const token = await tokens.sign({ sub: 'user-1', sid: 'family-1' })

    await expect(tokens.verify(token)).resolves.toEqual({ sub: 'user-1', sid: 'family-1' })
  })

  it('rejects a token signed with another secret', async () => {
    const other = createAccessTokens({ ...options, secret: 'another-secret-another-secret-0000' })
    const token = await other.sign({ sub: 'user-1', sid: 'family-1' })

    await expect(tokens.verify(token)).resolves.toBeNull()
  })

  it('rejects a token for another audience or issuer', async () => {
    const otherAudience = createAccessTokens({ ...options, audience: 'admin' })
    const otherIssuer = createAccessTokens({ ...options, issuer: 'elsewhere' })

    await expect(
      tokens.verify(await otherAudience.sign({ sub: 'u', sid: 's' }))
    ).resolves.toBeNull()
    await expect(tokens.verify(await otherIssuer.sign({ sub: 'u', sid: 's' }))).resolves.toBeNull()
  })

  it('rejects an expired token', async () => {
    const past = Math.floor(Date.now() / 1000) - 3600
    const token = await new SignJWT({ sid: 's' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('u')
      .setIssuer('api')
      .setAudience('web')
      .setJti('j')
      .setIssuedAt(past)
      .setExpirationTime(past + 600)
      .sign(key)

    await expect(tokens.verify(token)).resolves.toBeNull()
  })

  it('pins HS256: rejects HS512 with the same secret and an unsigned `none` token', async () => {
    const now = Math.floor(Date.now() / 1000)
    const claims = {
      sub: 'u',
      sid: 's',
      iss: 'api',
      aud: 'web',
      jti: 'j',
      iat: now,
      exp: now + 600,
    }
    const hs512 = await new SignJWT(claims).setProtectedHeader({ alg: 'HS512' }).sign(key)
    const none = `${base64url({ alg: 'none', typ: 'JWT' })}.${base64url(claims)}.`

    await expect(tokens.verify(hs512)).resolves.toBeNull()
    await expect(tokens.verify(none)).resolves.toBeNull()
  })

  it('rejects garbage', async () => {
    await expect(tokens.verify('not-a-jwt')).resolves.toBeNull()
  })
})
