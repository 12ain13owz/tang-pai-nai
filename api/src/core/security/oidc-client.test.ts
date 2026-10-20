import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import { createServer } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createOidcClient, OidcError, pkceChallenge } from './oidc-client'
import type { JWTPayload } from 'jose'
import type { AddressInfo } from 'node:net'

const CLIENT_ID = 'test-client'
const CLIENT_SECRET = 'test-secret'
const REDIRECT_URI = 'http://web.test/api/auth/google/callback'
const NONCE = 'the-nonce'

type KeyPair = Awaited<ReturnType<typeof generateKeyPair>>
let signingKey: KeyPair
let strangerKey: KeyPair
let issuer = ''
/** What the token endpoint answers next: an ID token, or an HTTP status. */
let nextToken: string | number = 500
const tokenRequests: URLSearchParams[] = []

// A local OpenID provider: discovery, JWKS and a token endpoint that hands out `nextToken`.
const server = createServer((req, res) => {
  const json = (status: number, body: unknown) => {
    res.writeHead(status, { 'content-type': 'application/json' })
    res.end(JSON.stringify(body))
  }
  if (req.url === '/.well-known/openid-configuration') {
    json(200, {
      issuer,
      authorization_endpoint: `${issuer}/authorize`,
      token_endpoint: `${issuer}/token`,
      jwks_uri: `${issuer}/jwks`,
    })
  } else if (req.url === '/wrong-issuer/.well-known/openid-configuration') {
    json(200, {
      issuer: 'https://someone-else.example',
      authorization_endpoint: `${issuer}/authorize`,
      token_endpoint: `${issuer}/token`,
      jwks_uri: `${issuer}/jwks`,
    })
  } else if (req.url === '/jwks') {
    void exportJWK(signingKey.publicKey).then((jwk) =>
      json(200, { keys: [{ ...jwk, kid: 'k1', alg: 'RS256', use: 'sig' }] })
    )
  } else if (req.url === '/token' && req.method === 'POST') {
    let body = ''
    req.on('data', (chunk: Buffer) => (body += chunk.toString()))
    req.on('end', () => {
      tokenRequests.push(new URLSearchParams(body))
      if (typeof nextToken === 'number') {
        json(nextToken, { error: 'invalid_grant' })
      } else {
        json(200, { id_token: nextToken, token_type: 'Bearer' })
      }
    })
  } else {
    json(404, {})
  }
})

beforeAll(async () => {
  signingKey = await generateKeyPair('RS256')
  strangerKey = await generateKeyPair('RS256')
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  issuer = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(() => {
  server.close()
})

const client = (overrides: { issuer?: string } = {}) =>
  createOidcClient({
    issuer,
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    redirectUri: REDIRECT_URI,
    scope: 'openid email profile',
    authorizationParams: { prompt: 'select_account' },
    timeoutMs: 2000,
    clockToleranceSeconds: 60,
    ...overrides,
  })

interface TokenOptions {
  claims?: JWTPayload
  /** `stranger`: a key the JWKS doesn't publish. */
  signer?: 'ours' | 'stranger'
  issuedAgoSeconds?: number
}

const idToken = async ({
  claims = {},
  signer = 'ours',
  issuedAgoSeconds = 0,
}: TokenOptions = {}) => {
  const issuedAt = Math.floor(Date.now() / 1000) - issuedAgoSeconds
  return new SignJWT({
    email: 'somchai@gmail.com',
    email_verified: true,
    name: 'Somchai',
    picture: 'https://lh3.googleusercontent.com/a/x',
    nonce: NONCE,
    ...claims,
  })
    .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
    .setIssuer(typeof claims.iss === 'string' ? claims.iss : issuer)
    .setAudience(claims.aud ?? CLIENT_ID)
    .setSubject('sub-1')
    .setIssuedAt(issuedAt)
    .setExpirationTime(issuedAt + 3600)
    .sign((signer === 'ours' ? signingKey : strangerKey).privateKey)
}

describe('pkceChallenge', () => {
  it('is BASE64URL(SHA256(verifier)) (RFC 7636 appendix B)', () => {
    expect(pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM'
    )
  })
})

describe('authorizationUrl', () => {
  it('asks for a code with PKCE S256, state, nonce and the extra parameters', async () => {
    const url = new URL(
      await client().authorizationUrl({ state: 's1', nonce: 'n1', codeChallenge: 'c1' })
    )

    expect(`${url.origin}${url.pathname}`).toBe(`${issuer}/authorize`)
    expect(Object.fromEntries(url.searchParams)).toEqual({
      response_type: 'code',
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      scope: 'openid email profile',
      state: 's1',
      nonce: 'n1',
      code_challenge: 'c1',
      code_challenge_method: 'S256',
      prompt: 'select_account',
    })
  })

  it('refuses a discovery document that names another issuer', async () => {
    await expect(
      client({ issuer: `${issuer}/wrong-issuer` }).authorizationUrl({
        state: 's',
        nonce: 'n',
        codeChallenge: 'c',
      })
    ).rejects.toBeInstanceOf(OidcError)
  })
})

describe('exchangeCode', () => {
  it('posts the code, the PKCE verifier and the client credentials, and returns the ID token', async () => {
    nextToken = 'the-id-token'

    await expect(client().exchangeCode('the-code', 'the-verifier')).resolves.toBe('the-id-token')
    expect(Object.fromEntries(tokenRequests.at(-1) ?? [])).toEqual({
      grant_type: 'authorization_code',
      code: 'the-code',
      code_verifier: 'the-verifier',
      redirect_uri: REDIRECT_URI,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
    })
  })

  it('fails when the provider refuses the code', async () => {
    nextToken = 400

    await expect(client().exchangeCode('used', 'v')).rejects.toThrow(/token endpoint answered 400/)
  })
})

describe('verifyIdToken', () => {
  it('returns the identity from a valid token', async () => {
    await expect(client().verifyIdToken(await idToken(), NONCE)).resolves.toEqual({
      subject: 'sub-1',
      email: 'somchai@gmail.com',
      emailVerified: true,
      name: 'Somchai',
      picture: 'https://lh3.googleusercontent.com/a/x',
    })
  })

  it('reads email_verified sent as a string, and missing optional claims as null', async () => {
    const token = await idToken({
      claims: { email_verified: 'true', name: undefined, picture: undefined, email: undefined },
    })

    await expect(client().verifyIdToken(token, NONCE)).resolves.toMatchObject({
      email: null,
      emailVerified: true,
      name: null,
      picture: null,
    })
  })

  it.each<[string, TokenOptions, string]>([
    ['another audience', { claims: { aud: 'another-client' } }, NONCE],
    ['another issuer', { claims: { iss: 'https://evil.example' } }, NONCE],
    ['expired beyond the tolerance', { issuedAgoSeconds: 3600 + 61 }, NONCE],
    ['a key not in the JWKS', { signer: 'stranger' }, NONCE],
    ['another nonce', {}, 'other-nonce'],
    ['several audiences without azp = us', { claims: { aud: [CLIENT_ID, 'other'] } }, NONCE],
  ])('rejects a token with %s', async (_, options, nonce) => {
    const token = await idToken(options)

    await expect(client().verifyIdToken(token, nonce)).rejects.toBeInstanceOf(OidcError)
  })

  it('accepts a token just expired within the clock tolerance', async () => {
    const token = await idToken({ issuedAgoSeconds: 3600 + 30 })

    await expect(client().verifyIdToken(token, NONCE)).resolves.toMatchObject({ subject: 'sub-1' })
  })

  it('accepts several audiences when azp names us', async () => {
    const token = await idToken({ claims: { aud: [CLIENT_ID, 'other'], azp: CLIENT_ID } })

    await expect(client().verifyIdToken(token, NONCE)).resolves.toMatchObject({ subject: 'sub-1' })
  })
})
