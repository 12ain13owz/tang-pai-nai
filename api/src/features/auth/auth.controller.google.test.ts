import cookieParser from 'cookie-parser'
import express from 'express'
import request from 'supertest'
import { describe, expect, it, vi } from 'vitest'
import { errorHandler } from '@/core/error'
import {
  accessTokens,
  createSealedBox,
  OidcError,
  pkceChallenge,
  randomToken,
  skipBreachCheck,
} from '@/core/security'
import type { AuthorizationRequest, OidcIdentity } from '@/core/security'
import { HttpStatus } from '@/shared/constants'
import type { AppResponse } from '@/shared/types'
import { GOOGLE_FLOW_COOKIE, REFRESH_COOKIE } from './auth.const'
import { createAuthController } from './auth.controller'
import { createMemoryAuthRepository } from './auth.repository.memory'
import { createAuthRouter } from './auth.routes'
import { createAuthService } from './auth.service'
import type { User } from './auth.entity'
import type { MemoryAuthState } from './auth.repository.memory'
import type { GoogleSignIn } from './auth.service'
import type { AuthProvidersData, AuthSessionData } from './auth.type'
import type { Express } from 'express'

const WEB = 'http://web.test'
const START = new Date('2026-10-19T00:00:00.000Z')

const account = (overrides: Partial<OidcIdentity> = {}): OidcIdentity => ({
  subject: 'google-sub-1',
  email: 'somchai@gmail.com',
  emailVerified: true,
  name: 'Somchai Jaidee',
  picture: null,
  ...overrides,
})

const disabledUser: User = {
  id: '01900000-0000-7000-8000-000000000001',
  email: 'somchai@gmail.com',
  displayName: 'somchai',
  avatarUrl: null,
  emailVerifiedAt: START,
  status: 'disabled',
  timezone: 'Asia/Bangkok',
  createdAt: START,
  updatedAt: START,
}

interface BuildOptions {
  google?: boolean
  seed?: Partial<MemoryAuthState>
  signupEnabled?: boolean
}

// The feature on its own in-memory repo, with a fake Google that checks PKCE and the nonce.
const buildApp = ({ google = true, seed, signupEnabled = true }: BuildOptions = {}) => {
  let pending: AuthorizationRequest | null = null
  const accounts = new Map<string, OidcIdentity>()
  const oidc: GoogleSignIn['oidc'] = {
    authorizationUrl: vi.fn(async (req: AuthorizationRequest) => {
      pending = req
      return `https://google.test/authorize?state=${req.state}`
    }),
    exchangeCode: vi.fn(async (code: string, verifier: string) => {
      if (pkceChallenge(verifier) !== pending?.codeChallenge || !accounts.has(code)) {
        throw new OidcError('token endpoint answered 400')
      }
      return code
    }),
    verifyIdToken: vi.fn(async (idToken: string, nonce: string) => {
      const identity = accounts.get(idToken)
      if (!identity || nonce !== pending?.nonce) {
        throw new OidcError('id token rejected')
      }
      return identity
    }),
  }
  const authService = createAuthService({
    authRepo: createMemoryAuthRepository(seed),
    notifier: { send: vi.fn() },
    accessTokens,
    breachChecker: skipBreachCheck,
    google: google
      ? { oidc, flowBox: createSealedBox('controller-test-secret-0000000000', 'google-oidc-flow') }
      : null,
    config: { webOrigin: WEB, signupEnabled, emailDailyLimit: 100, startMinDurationMs: 0 },
  })
  const app: Express = express()
  app.use(express.json())
  app.use(cookieParser())
  app.use('/auth', createAuthRouter(createAuthController(authService, { webOrigin: WEB }), WEB))
  app.use(errorHandler)
  /** The query Google sends back once the user picks `identity`. */
  const approve = (identity = account()) => {
    const code = randomToken()
    accounts.set(code, identity)
    return { code, state: pending?.state ?? '' }
  }
  return { app, oidc, approve }
}

const setCookies = (res: request.Response): string[] => {
  const header: unknown = res.headers['set-cookie']
  return Array.isArray(header) ? header.map(String) : []
}
const cookieNamed = (res: request.Response, name: string) =>
  setCookies(res).find((cookie) => cookie.startsWith(`${name}=`)) ?? ''
const cookieValue = (setCookie: string) => setCookie.split(';')[0]

/** GET start, then the callback with whatever Google answered and the flow cookie. */
const roundTrip = async (
  ctx: ReturnType<typeof buildApp>,
  identity = account(),
  returnUrl = '/wallets'
) => {
  const start = await request(ctx.app).get('/auth/google/start').query({ returnUrl })
  const flowCookie = cookieValue(cookieNamed(start, GOOGLE_FLOW_COOKIE))
  const callback = await request(ctx.app)
    .get('/auth/google/callback')
    .query(ctx.approve(identity))
    .set('Cookie', flowCookie)
  return { start, flowCookie, callback }
}

describe('GET /auth/providers', () => {
  it.each([true, false])('says whether Google sign-in is on (%s)', async (google) => {
    const { app } = buildApp({ google })

    const res = await request(app).get('/auth/providers')

    const body = res.body as AppResponse<AuthProvidersData>
    expect(res.status).toBe(HttpStatus.OK)
    expect(body.data).toEqual({ google })
  })
})

describe('GET /auth/google/start', () => {
  it('answers 404 for both Google routes while Google is off', async () => {
    const { app } = buildApp({ google: false })

    const start = await request(app).get('/auth/google/start')
    const callback = await request(app)
      .get('/auth/google/callback')
      .query({ code: 'c', state: 's' })

    expect(start.status).toBe(HttpStatus.NOT_FOUND)
    expect(callback.status).toBe(HttpStatus.NOT_FOUND)
    expect(setCookies(start)).toEqual([])
  })

  it('redirects to Google with a sealed, Lax, 10-minute flow cookie', async () => {
    const { app } = buildApp()

    const res = await request(app).get('/auth/google/start').query({ returnUrl: '/reports' })

    const cookie = cookieNamed(res, GOOGLE_FLOW_COOKIE)
    expect(res.status).toBe(HttpStatus.FOUND)
    expect(res.headers.location).toMatch(/^https:\/\/google\.test\/authorize\?state=/)
    expect(res.headers['cache-control']).toBe('no-store')
    expect(cookie).toMatch(/Max-Age=600/)
    expect(cookie).toMatch(/Path=\//)
    expect(cookie).toMatch(/HttpOnly/)
    expect(cookie).toMatch(/Secure/)
    expect(cookie).toMatch(/SameSite=Lax/)
    // Encrypted: neither the return path nor any JSON is readable in it.
    expect(cookie).not.toContain('reports')
  })

  it('sends the browser to the web error page when Google can’t be reached', async () => {
    const ctx = buildApp()
    vi.mocked(ctx.oidc.authorizationUrl).mockRejectedValueOnce(new Error('fetch failed'))

    const res = await request(ctx.app).get('/auth/google/start')

    expect(res.status).toBe(HttpStatus.FOUND)
    expect(res.headers.location).toBe(`${WEB}/auth/callback?error=failed`)
    expect(cookieNamed(res, GOOGLE_FLOW_COOKIE)).toBe('')
  })
})

describe('GET /auth/google/callback', () => {
  it('sets the refresh cookie, clears the flow cookie and goes back with no token in the URL', async () => {
    const ctx = buildApp()

    const { callback } = await roundTrip(ctx)

    const location = String(callback.headers.location)
    expect(callback.status).toBe(HttpStatus.FOUND)
    expect(location).toBe(`${WEB}/auth/callback?returnUrl=%2Fwallets`)
    expect(cookieNamed(callback, REFRESH_COOKIE)).toMatch(/HttpOnly; Secure; SameSite=Strict/)
    expect(cookieNamed(callback, GOOGLE_FLOW_COOKIE)).toMatch(
      /^__Host-goidc=;.*Expires=Thu, 01 Jan 1970/
    )
    expect(location).not.toMatch(/token|code=/i)
  })

  it('leaves out returnUrl for the home page and says when an identity was just linked', async () => {
    const ctx = buildApp({ seed: { users: [{ ...disabledUser, status: 'active' }] } })

    const { callback } = await roundTrip(ctx, account(), '/')

    expect(callback.headers.location).toBe(`${WEB}/auth/callback?linked=google`)
  })

  it('gives a session that /auth/refresh then answers with', async () => {
    const ctx = buildApp()
    const { callback } = await roundTrip(ctx)

    const res = await request(ctx.app)
      .post('/auth/refresh')
      .set('Origin', WEB)
      .set('Cookie', cookieValue(cookieNamed(callback, REFRESH_COOKIE)))

    const body = res.body as AppResponse<AuthSessionData>
    expect(res.status).toBe(HttpStatus.OK)
    expect(body.data?.user).toMatchObject({
      email: 'somchai@gmail.com',
      displayName: 'Somchai Jaidee',
      identities: [{ provider: 'google', email: 'somchai@gmail.com' }],
    })
    expect(typeof body.data?.user.identities[0]?.linkedAt).toBe('string')
  })

  it.each<[string, BuildOptions, OidcIdentity, string]>([
    ['email_unverified', {}, account({ emailVerified: false }), 'email_unverified'],
    ['signup_closed', { signupEnabled: false }, account(), 'signup_closed'],
    ['disabled', { seed: { users: [disabledUser] } }, account(), 'disabled'],
  ])(
    'redirects a refused sign-in to the web error page (%s)',
    async (_, options, identity, reason) => {
      const ctx = buildApp(options)

      const { callback } = await roundTrip(ctx, identity)

      expect(callback.status).toBe(HttpStatus.FOUND)
      expect(callback.headers.location).toBe(`${WEB}/auth/callback?error=${reason}`)
      expect(cookieNamed(callback, REFRESH_COOKIE)).toBe('')
    }
  )

  it('calls a refusal at Google a cancel', async () => {
    const ctx = buildApp()
    const start = await request(ctx.app).get('/auth/google/start')

    const res = await request(ctx.app)
      .get('/auth/google/callback')
      .query({ error: 'access_denied', state: ctx.approve().state })
      .set('Cookie', cookieValue(cookieNamed(start, GOOGLE_FLOW_COOKIE)))

    expect(res.headers.location).toBe(`${WEB}/auth/callback?error=cancelled`)
  })

  it('fails a forged state, a missing cookie and a replayed callback', async () => {
    const ctx = buildApp()
    const start = await request(ctx.app).get('/auth/google/start')
    const flowCookie = cookieValue(cookieNamed(start, GOOGLE_FLOW_COOKIE))
    const callback = ctx.approve()

    const forged = await request(ctx.app)
      .get('/auth/google/callback')
      .query({ ...callback, state: 'forged' })
      .set('Cookie', flowCookie)
    const noCookie = await request(ctx.app).get('/auth/google/callback').query(callback)
    // Same cookie and code twice: the code is spent at Google after the first exchange.
    vi.mocked(ctx.oidc.exchangeCode).mockRejectedValue(new OidcError('invalid_grant'))
    const replayed = await request(ctx.app)
      .get('/auth/google/callback')
      .query(callback)
      .set('Cookie', flowCookie)

    for (const res of [forged, noCookie, replayed]) {
      expect(res.headers.location).toBe(`${WEB}/auth/callback?error=failed`)
      expect(cookieNamed(res, REFRESH_COOKIE)).toBe('')
    }
  })

  it('never answers with JSON, even for an odd query', async () => {
    const { app } = buildApp()

    const res = await request(app)
      .get('/auth/google/callback')
      .query({ code: 'x'.repeat(5000), state: ['a', 'b'] })

    expect(res.status).toBe(HttpStatus.FOUND)
    expect(res.headers.location).toBe(`${WEB}/auth/callback?error=failed`)
  })
})
