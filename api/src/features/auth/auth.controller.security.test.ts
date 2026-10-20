import cookieParser from 'cookie-parser'
import express from 'express'
import request from 'supertest'
import { describe, expect, it, vi } from 'vitest'
import { errorHandler } from '@/core/error'
import type { Notification } from '@/core/notification'
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
import { NotificationChannel } from '@/shared/types'
import type { AppResponse } from '@/shared/types'
import { GOOGLE_FLOW_COOKIE, REFRESH_COOKIE } from './auth.const'
import { createAuthController } from './auth.controller'
import { createMemoryAuthRepository } from './auth.repository.memory'
import { createAuthRouter } from './auth.routes'
import { createAuthService } from './auth.service'
import type { GoogleSignIn } from './auth.service'
import type {
  AuthDeviceSessionData,
  AuthGoogleLinkData,
  AuthSessionData,
  AuthSessionsRevokedData,
  AuthUserData,
} from './auth.type'
import type { Express } from 'express'

// The HTTP side of Account › Security (auth spec rules 28–30): routes, validation, the link
// round trip's cookie and redirects. The rules themselves are in auth.service.security.test.ts.

const WEB = 'http://web.test'
const START = new Date('2026-10-19T00:00:00.000Z')
const MINUTE = 60_000

const account = (overrides: Partial<OidcIdentity> = {}): OidcIdentity => ({
  subject: 'google-sub-1',
  email: 'mom@gmail.com',
  emailVerified: true,
  name: 'Mom',
  picture: null,
  ...overrides,
})

const buildApp = () => {
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
  const sent: Notification[] = []
  const clock = { now: START }
  const authService = createAuthService({
    authRepo: createMemoryAuthRepository(),
    notifier: {
      send: vi.fn(async (notification: Notification) => {
        sent.push(notification)
      }),
    },
    accessTokens,
    breachChecker: skipBreachCheck,
    google: {
      oidc,
      flowBox: createSealedBox('controller-test-secret-0000000000', 'google-oidc-flow'),
    },
    config: {
      webOrigin: WEB,
      signupEnabled: true,
      emailDailyLimit: 100,
      startMinDurationMs: 0,
      phoneEnabled: true,
      smsDailyLimit: 100,
    },
    now: () => clock.now,
  })
  const app: Express = express()
  app.use(express.json())
  app.use(cookieParser())
  app.use('/auth', createAuthRouter(createAuthController(authService, { webOrigin: WEB }), WEB))
  app.use(errorHandler)
  const approve = (identity = account()) => {
    const code = randomToken()
    accounts.set(code, identity)
    return { code, state: pending?.state ?? '' }
  }
  const lastCode = () => {
    const mail = sent.at(-1)
    return mail?.channel === NotificationChannel.EMAIL
      ? (/^ {4}(\d{6})$/m.exec(mail.text)?.[1] ?? '')
      : ''
  }
  const advance = (ms: number) => {
    clock.now = new Date(clock.now.getTime() + ms)
  }
  return { app, approve, lastCode, advance, sent }
}
type Ctx = ReturnType<typeof buildApp>

const setCookies = (res: request.Response): string[] => {
  const header: unknown = res.headers['set-cookie']
  return Array.isArray(header) ? header.map(String) : []
}
const cookieNamed = (res: request.Response, name: string) =>
  setCookies(res).find((cookie) => cookie.startsWith(`${name}=`)) ?? ''
const cookieValue = (setCookie: string) => setCookie.split(';')[0]

/** Email-code sign-in from `userAgent`: the Bearer token and the refresh cookie. */
const signIn = async (ctx: Ctx, email = 'mom@example.com', userAgent = 'vitest') => {
  ctx.advance(MINUTE)
  await request(ctx.app).post('/auth/email/start').send({ email })
  const res = await request(ctx.app)
    .post('/auth/email/verify')
    .set('User-Agent', userAgent)
    .send({ email, code: ctx.lastCode() })
  const body = res.body as AppResponse<AuthSessionData>
  return {
    bearer: `Bearer ${body.data?.accessToken ?? ''}`,
    cookie: cookieValue(cookieNamed(res, REFRESH_COOKIE)),
  }
}

const listSessions = async (ctx: Ctx, bearer: string) => {
  const res = await request(ctx.app).get('/auth/sessions').set('Authorization', bearer)
  return (res.body as AppResponse<AuthDeviceSessionData[]>).data ?? []
}

/** POST link → the browser at Google → callback with the flow cookie. */
const linkRoundTrip = async (ctx: Ctx, bearer: string, identity = account()) => {
  const start = await request(ctx.app)
    .post('/auth/google/link')
    .set('Authorization', bearer)
    .send({ lang: 'en' })
  const flowCookie = cookieValue(cookieNamed(start, GOOGLE_FLOW_COOKIE))
  const callback = await request(ctx.app)
    .get('/auth/google/callback')
    .query(ctx.approve(identity))
    .set('Cookie', flowCookie)
  return { start, callback }
}

describe('GET /auth/sessions', () => {
  it('lists the signed-in devices with ISO dates and the current one flagged', async () => {
    const ctx = buildApp()
    await signIn(ctx, 'mom@example.com', 'Phone UA')
    const { bearer } = await signIn(ctx, 'mom@example.com', 'Laptop UA')

    const res = await request(ctx.app).get('/auth/sessions').set('Authorization', bearer)

    const body = res.body as AppResponse<AuthDeviceSessionData[]>
    expect(res.status).toBe(HttpStatus.OK)
    expect(body.data?.map(({ userAgent, current }) => ({ userAgent, current }))).toEqual([
      { userAgent: 'Laptop UA', current: true },
      { userAgent: 'Phone UA', current: false },
    ])
    expect(body.data?.[0].signedInAt).toBe(new Date(START.getTime() + 2 * MINUTE).toISOString())
  })

  it('needs a Bearer token', async () => {
    const res = await request(buildApp().app).get('/auth/sessions')

    expect(res.status).toBe(HttpStatus.UNAUTHORIZED)
  })
})

describe('DELETE /auth/sessions/:id', () => {
  it('signs the other device out; its refresh cookie then answers SESSION_REVOKED', async () => {
    const ctx = buildApp()
    const phone = await signIn(ctx)
    const { bearer } = await signIn(ctx)
    const other = (await listSessions(ctx, bearer)).find((session) => !session.current)

    const res = await request(ctx.app)
      .delete(`/auth/sessions/${other?.id ?? ''}`)
      .set('Authorization', bearer)
    const refresh = await request(ctx.app)
      .post('/auth/refresh')
      .set('Origin', WEB)
      .set('Cookie', phone.cookie)

    expect(res.status).toBe(HttpStatus.OK)
    expect(refresh.status).toBe(HttpStatus.UNAUTHORIZED)
    expect((refresh.body as { code?: string }).code).toBe('SESSION_REVOKED')
  })

  it('answers 400 CURRENT_SESSION for the caller’s own, 404 for an unknown one', async () => {
    const ctx = buildApp()
    const { bearer } = await signIn(ctx)
    const [own] = await listSessions(ctx, bearer)

    const mine = await request(ctx.app)
      .delete(`/auth/sessions/${own.id}`)
      .set('Authorization', bearer)
    const unknown = await request(ctx.app)
      .delete('/auth/sessions/01900000-0000-7000-8000-00000000dead')
      .set('Authorization', bearer)

    expect(mine.status).toBe(HttpStatus.BAD_REQUEST)
    expect((mine.body as { code?: string }).code).toBe('CURRENT_SESSION')
    expect(unknown.status).toBe(HttpStatus.NOT_FOUND)
  })

  it('refuses an id that isn’t a UUID before anything else', async () => {
    const ctx = buildApp()
    const { bearer } = await signIn(ctx)

    const res = await request(ctx.app).delete('/auth/sessions/nope').set('Authorization', bearer)

    expect(res.status).toBe(HttpStatus.UNPROCESSABLE_ENTITY)
  })
})

describe('DELETE /auth/sessions', () => {
  it('signs out every other device and says how many', async () => {
    const ctx = buildApp()
    await signIn(ctx)
    await signIn(ctx)
    const { bearer } = await signIn(ctx)

    const res = await request(ctx.app).delete('/auth/sessions').set('Authorization', bearer)

    expect(res.status).toBe(HttpStatus.OK)
    expect((res.body as AppResponse<AuthSessionsRevokedData>).data).toEqual({ revoked: 2 })
    expect(await listSessions(ctx, bearer)).toHaveLength(1)
  })
})

describe('POST /auth/google/link', () => {
  it('answers Google’s URL as JSON and sets the sealed Lax flow cookie', async () => {
    const ctx = buildApp()
    const { bearer } = await signIn(ctx)

    const res = await request(ctx.app)
      .post('/auth/google/link')
      .set('Authorization', bearer)
      .send({})

    const body = res.body as AppResponse<AuthGoogleLinkData>
    expect(res.status).toBe(HttpStatus.OK)
    expect(body.data?.authorizationUrl).toMatch(/^https:\/\/google\.test\/authorize\?state=/)
    expect(cookieNamed(res, GOOGLE_FLOW_COOKIE)).toMatch(
      /Max-Age=600.*HttpOnly; Secure; SameSite=Lax/
    )
  })

  it('answers 403 REAUTH_REQUIRED once the sign-in is no longer recent', async () => {
    const ctx = buildApp()
    const { bearer } = await signIn(ctx)
    ctx.advance(11 * MINUTE)

    const res = await request(ctx.app)
      .post('/auth/google/link')
      .set('Authorization', bearer)
      .send({ lang: 'th' })

    expect(res.status).toBe(HttpStatus.FORBIDDEN)
    expect((res.body as { code?: string }).code).toBe('REAUTH_REQUIRED')
    expect(cookieNamed(res, GOOGLE_FLOW_COOKIE)).toBe('')
  })
})

describe('GET /auth/google/callback in link mode', () => {
  it('links and goes back to the Security page, without a new refresh cookie', async () => {
    const ctx = buildApp()
    const { bearer } = await signIn(ctx)

    const { callback } = await linkRoundTrip(ctx, bearer)

    expect(callback.status).toBe(HttpStatus.FOUND)
    expect(callback.headers.location).toBe(`${WEB}/account/security?linked=google`)
    expect(cookieNamed(callback, REFRESH_COOKIE)).toBe('')
    expect(cookieNamed(callback, GOOGLE_FLOW_COOKIE)).toMatch(/^__Host-goidc=;/)
  })

  it('goes back with error=google_in_use when the account belongs to someone else', async () => {
    const ctx = buildApp()
    const dad = await signIn(ctx, 'dad@example.com')
    await linkRoundTrip(ctx, dad.bearer)
    const mom = await signIn(ctx)

    const { callback } = await linkRoundTrip(ctx, mom.bearer)

    expect(callback.headers.location).toBe(`${WEB}/account/security?error=google_in_use`)
  })

  it('goes back with no error after a cancel at Google', async () => {
    const ctx = buildApp()
    const { bearer } = await signIn(ctx)
    const start = await request(ctx.app)
      .post('/auth/google/link')
      .set('Authorization', bearer)
      .send({})

    const callback = await request(ctx.app)
      .get('/auth/google/callback')
      .query({ error: 'access_denied', state: 'x' })
      .set('Cookie', cookieValue(cookieNamed(start, GOOGLE_FLOW_COOKIE)))

    expect(callback.headers.location).toBe(`${WEB}/account/security`)
  })
})

describe('DELETE /auth/google/link', () => {
  it('unlinks and answers the user without the identity', async () => {
    const ctx = buildApp()
    const { bearer } = await signIn(ctx)
    await linkRoundTrip(ctx, bearer)

    // No body at all, as a DELETE may come.
    const res = await request(ctx.app).delete('/auth/google/link').set('Authorization', bearer)

    expect(res.status).toBe(HttpStatus.OK)
    expect((res.body as AppResponse<AuthUserData>).data?.identities).toEqual([])
  })
})
