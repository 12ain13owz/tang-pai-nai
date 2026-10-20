import { createRemoteJWKSet, jwtVerify } from 'jose'
import { createHash } from 'node:crypto'
import type { JWTPayload } from 'jose'

/** The parts of an OIDC discovery document we use. */
interface Discovery {
  issuer: string
  authorization_endpoint: string
  token_endpoint: string
  jwks_uri: string
}

export interface OidcClientOptions {
  /** e.g. `https://accounts.google.com`, or a local stand-in in dev and tests. */
  issuer: string
  clientId: string
  clientSecret: string
  redirectUri: string
  scope: string
  /** Extra parameters for the authorization request (`prompt`, …). */
  authorizationParams?: Record<string, string>
  /** Discovery and token requests slower than this fail. */
  timeoutMs: number
  clockToleranceSeconds: number
}

/** What the app keeps from a verified ID token. */
export interface OidcIdentity {
  subject: string
  email: string | null
  emailVerified: boolean
  name: string | null
  picture: string | null
}

export interface AuthorizationRequest {
  state: string
  nonce: string
  codeChallenge: string
}

/** Something about the provider's answer is wrong; `reason` goes to the log only. */
export class OidcError extends Error {
  constructor(readonly reason: string) {
    super(`OIDC: ${reason}`)
    this.name = 'OidcError'
  }
}

/** PKCE S256: `BASE64URL(SHA256(verifier))`. */
export const pkceChallenge = (verifier: string): string =>
  createHash('sha256').update(verifier).digest('base64url')

// Google's ID tokens may carry the issuer without the scheme.
const acceptedIssuers = (issuer: string): string[] =>
  issuer === 'https://accounts.google.com' ? [issuer, 'accounts.google.com'] : [issuer]

const isDiscovery = (value: unknown): value is Discovery => {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const document = new Map(Object.entries(value))
  return ['issuer', 'authorization_endpoint', 'token_endpoint', 'jwks_uri'].every(
    (key) => typeof document.get(key) === 'string'
  )
}

const optionalString = (value: unknown): string | null =>
  typeof value === 'string' && value !== '' ? value : null

/**
 * An OpenID Connect relying party for the Authorization Code flow with PKCE (auth spec rule 14):
 * reads the issuer's discovery document once, exchanges a code server-side, and verifies the ID
 * token (signature from the JWKS, `iss`, `aud`, `exp`, `nonce`).
 */
export const createOidcClient = (options: OidcClientOptions) => {
  let discovery: Promise<{
    document: Discovery
    jwks: ReturnType<typeof createRemoteJWKSet>
  }> | null = null

  const discover = async () => {
    discovery ??= (async () => {
      const url = `${options.issuer}/.well-known/openid-configuration`
      const response = await fetch(url, { signal: AbortSignal.timeout(options.timeoutMs) })
      const document: unknown = response.ok ? await response.json() : null
      if (!isDiscovery(document) || document.issuer !== options.issuer) {
        throw new OidcError('invalid discovery document')
      }
      const jwks = createRemoteJWKSet(new URL(document.jwks_uri), {
        timeoutDuration: options.timeoutMs,
      })
      return { document, jwks }
    })().catch((error: unknown) => {
      discovery = null // try again on the next sign-in
      throw error
    })
    return discovery
  }

  const authorizationUrl = async ({
    state,
    nonce,
    codeChallenge,
  }: AuthorizationRequest): Promise<string> => {
    const { document } = await discover()
    const url = new URL(document.authorization_endpoint)
    const params = {
      response_type: 'code',
      client_id: options.clientId,
      redirect_uri: options.redirectUri,
      scope: options.scope,
      state,
      nonce,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      ...options.authorizationParams,
    }
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value)
    }
    return url.toString()
  }

  /** Trades the authorization code for the raw ID token. */
  const exchangeCode = async (code: string, codeVerifier: string): Promise<string> => {
    const { document } = await discover()
    const response = await fetch(document.token_endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        code_verifier: codeVerifier,
        redirect_uri: options.redirectUri,
        client_id: options.clientId,
        client_secret: options.clientSecret,
      }),
      signal: AbortSignal.timeout(options.timeoutMs),
    })
    const body: unknown = await response.json().catch(() => null)
    const idToken =
      typeof body === 'object' && body !== null ? (body as Record<string, unknown>).id_token : null
    if (!response.ok || typeof idToken !== 'string') {
      throw new OidcError(`token endpoint answered ${response.status}`)
    }
    return idToken
  }

  /** Checks the ID token against the JWKS, issuer, audience, expiry and the expected nonce. */
  const verifyIdToken = async (idToken: string, nonce: string): Promise<OidcIdentity> => {
    const { jwks } = await discover()
    let payload: JWTPayload
    try {
      ;({ payload } = await jwtVerify(idToken, jwks, {
        issuer: acceptedIssuers(options.issuer),
        audience: options.clientId,
        clockTolerance: options.clockToleranceSeconds,
        requiredClaims: ['sub', 'exp', 'iat', 'nonce'],
      }))
    } catch (error) {
      throw new OidcError(
        `id token rejected: ${error instanceof Error ? error.message : 'unknown'}`
      )
    }
    if (payload.nonce !== nonce) {
      throw new OidcError('id token nonce mismatch')
    }
    // Several audiences: the token must have been issued to us (`azp`).
    if (Array.isArray(payload.aud) && payload.aud.length > 1 && payload.azp !== options.clientId) {
      throw new OidcError('id token azp mismatch')
    }
    if (typeof payload.sub !== 'string' || payload.sub === '') {
      throw new OidcError('id token without sub')
    }
    return {
      subject: payload.sub,
      email: optionalString(payload.email),
      // Some providers send the flag as a string.
      emailVerified: payload.email_verified === true || payload.email_verified === 'true',
      name: optionalString(payload.name),
      picture: optionalString(payload.picture),
    }
  }

  return { authorizationUrl, exchangeCode, verifyIdToken }
}

export type OidcClient = ReturnType<typeof createOidcClient>
