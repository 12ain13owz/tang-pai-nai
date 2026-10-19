import cookieParser from 'cookie-parser'
import express from 'express'
import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { errorHandler } from '@/core/error'
import type { Notification } from '@/core/notification'
import { accessTokens } from '@/core/security'
import { HttpStatus } from '@/shared/constants'
import { NotificationChannel } from '@/shared/types'
import type { AppResponse } from '@/shared/types'
import { REFRESH_COOKIE } from './auth.const'
import { createAuthController } from './auth.controller'
import { createMemoryAuthRepository } from './auth.repository.memory'
import { createAuthRouter } from './auth.routes'
import { createAuthService } from './auth.service'
import type { AuthSessionData, AuthUserData } from './auth.type'
import type { Express } from 'express'

const WEB = 'http://web.test'
const EMAIL = 'mom@example.com'

// The feature wired to its own in-memory repo per test (index.ts keeps one for the process).
// accessTokens is the shared instance, because `authenticate` verifies with it.
const buildApp = () => {
  const sent: Notification[] = []
  const authService = createAuthService({
    authRepo: createMemoryAuthRepository(),
    notifier: {
      send: async (notification) => {
        sent.push(notification)
      },
    },
    accessTokens,
    config: { webOrigin: WEB, signupEnabled: true, emailDailyLimit: 100, startMinDurationMs: 0 },
  })
  const app: Express = express()
  app.use(express.json())
  app.use(cookieParser())
  app.use('/auth', createAuthRouter(createAuthController(authService), WEB))
  app.use(errorHandler)
  const lastCode = () => {
    const mail = sent.at(-1)
    return mail?.channel === NotificationChannel.EMAIL
      ? (/^ {4}(\d{6})$/m.exec(mail.text)?.[1] ?? '')
      : ''
  }
  return { app, sent, lastCode }
}

const setCookies = (res: request.Response): string[] => {
  const header: unknown = res.headers['set-cookie']
  return Array.isArray(header) ? header.map(String) : []
}

const refreshCookie = (res: request.Response) =>
  setCookies(res).find((cookie) => cookie.startsWith(`${REFRESH_COOKIE}=`)) ?? ''

const cookieValue = (setCookie: string) => setCookie.split(';')[0]

/** Start + verify through HTTP: the session body and the cookie to send back. */
const signIn = async (ctx: ReturnType<typeof buildApp>) => {
  await request(ctx.app).post('/auth/email/start').send({ email: EMAIL })
  const res = await request(ctx.app)
    .post('/auth/email/verify')
    .send({ email: EMAIL, code: ctx.lastCode() })
  return { res, cookie: cookieValue(refreshCookie(res)) }
}

describe('POST /auth/email/start', () => {
  it('answers 202 with the same body whatever the email', async () => {
    const { app } = buildApp()

    const first = await request(app).post('/auth/email/start').send({ email: 'a@example.com' })
    const second = await request(app).post('/auth/email/start').send({ email: 'b@example.com' })

    expect(first.status).toBe(HttpStatus.ACCEPTED)
    expect(second.status).toBe(HttpStatus.ACCEPTED)
    expect((first.body as AppResponse<undefined>).message).toBe(
      (second.body as AppResponse<undefined>).message
    )
  })

  it('trims and lowercases the email before using it', async () => {
    const ctx = buildApp()

    await request(ctx.app).post('/auth/email/start').send({ email: '  Mom@Example.COM ' })

    expect(ctx.sent[0]).toMatchObject({ to: EMAIL })
  })

  it('answers 422 for an invalid email or language', async () => {
    const { app } = buildApp()

    const badEmail = await request(app).post('/auth/email/start').send({ email: 'nope' })
    const badLang = await request(app).post('/auth/email/start').send({ email: EMAIL, lang: 'fr' })

    expect(badEmail.status).toBe(HttpStatus.UNPROCESSABLE_ENTITY)
    expect(badLang.status).toBe(HttpStatus.UNPROCESSABLE_ENTITY)
  })

  it('answers 429 with Retry-After and a code during the cooldown', async () => {
    const { app } = buildApp()
    await request(app).post('/auth/email/start').send({ email: EMAIL })

    const res = await request(app).post('/auth/email/start').send({ email: EMAIL })

    expect(res.status).toBe(HttpStatus.TOO_MANY_REQUESTS)
    expect(res.headers['retry-after']).toBe('60')
    expect(res.body).toMatchObject({ code: 'RATE_LIMITED' })
  })
})

describe('POST /auth/email/verify', () => {
  it('returns the access token and user, and the refresh token only as a __Host- cookie', async () => {
    const { res } = await signIn(buildApp())
    const body = res.body as AppResponse<AuthSessionData>
    const cookie = refreshCookie(res)

    expect(res.status).toBe(HttpStatus.OK)
    expect(body.data?.user).toMatchObject({ email: EMAIL, displayName: 'mom' })
    expect(body.data?.expiresIn).toBe(600)
    expect(Object.keys(body.data ?? {}).sort()).toEqual(['accessToken', 'expiresIn', 'user'])
    expect(cookie).toMatch(/HttpOnly/)
    expect(cookie).toMatch(/Secure/)
    expect(cookie).toMatch(/SameSite=Strict/)
    expect(cookie).toMatch(/Path=\//)
    expect(cookie).not.toMatch(/Domain=/)
    expect(cookie).toMatch(/Expires=/)
  })

  it('answers 400 with OTP_INVALID for a wrong code', async () => {
    const ctx = buildApp()
    await request(ctx.app).post('/auth/email/start').send({ email: EMAIL })

    const res = await request(ctx.app)
      .post('/auth/email/verify')
      .send({ email: EMAIL, code: ctx.lastCode() === '000000' ? '111111' : '000000' })

    expect(res.status).toBe(HttpStatus.BAD_REQUEST)
    expect(res.body).toMatchObject({ code: 'OTP_INVALID' })
  })

  it('answers 422 for a malformed code without echoing it back', async () => {
    const { app } = buildApp()

    const res = await request(app).post('/auth/email/verify').send({ email: EMAIL, code: '12ab56' })

    expect(res.status).toBe(HttpStatus.UNPROCESSABLE_ENTITY)
    expect(JSON.stringify(res.body)).not.toContain('12ab56')
  })
})

describe('POST /auth/refresh', () => {
  it('refuses a request without the web origin', async () => {
    const ctx = buildApp()
    const { cookie } = await signIn(ctx)

    const missing = await request(ctx.app).post('/auth/refresh').set('Cookie', cookie)
    const other = await request(ctx.app)
      .post('/auth/refresh')
      .set('Cookie', cookie)
      .set('Origin', 'http://evil.test')

    expect(missing.status).toBe(HttpStatus.FORBIDDEN)
    expect(other.status).toBe(HttpStatus.FORBIDDEN)
  })

  it('rotates the cookie and returns a new access token', async () => {
    const ctx = buildApp()
    const { cookie } = await signIn(ctx)

    const res = await request(ctx.app)
      .post('/auth/refresh')
      .set('Cookie', cookie)
      .set('Origin', WEB)

    expect(res.status).toBe(HttpStatus.OK)
    expect((res.body as AppResponse<AuthSessionData>).data?.accessToken).toBeTruthy()
    expect(cookieValue(refreshCookie(res))).not.toBe(cookie)
  })

  it('answers 401 SESSION_EXPIRED without a cookie and clears a dead one', async () => {
    const { app } = buildApp()

    const none = await request(app).post('/auth/refresh').set('Origin', WEB)
    const dead = await request(app)
      .post('/auth/refresh')
      .set('Origin', WEB)
      .set('Cookie', `${REFRESH_COOKIE}=unknown`)

    expect(none.status).toBe(HttpStatus.UNAUTHORIZED)
    expect(none.body).toMatchObject({ code: 'SESSION_EXPIRED' })
    expect(refreshCookie(dead)).toMatch(/Expires=Thu, 01 Jan 1970/)
  })
})

describe('POST /auth/sign-out', () => {
  it('clears the cookie, after which the old cookie no longer refreshes', async () => {
    const ctx = buildApp()
    const { cookie } = await signIn(ctx)

    const res = await request(ctx.app)
      .post('/auth/sign-out')
      .set('Cookie', cookie)
      .set('Origin', WEB)
    const after = await request(ctx.app)
      .post('/auth/refresh')
      .set('Cookie', cookie)
      .set('Origin', WEB)

    expect(res.status).toBe(HttpStatus.OK)
    expect(refreshCookie(res)).toMatch(/Expires=Thu, 01 Jan 1970/)
    expect(after.status).toBe(HttpStatus.UNAUTHORIZED)
    expect(after.body).toMatchObject({ code: 'SESSION_REVOKED' })
  })

  it('refuses a request without the web origin', async () => {
    const { app } = buildApp()

    const res = await request(app).post('/auth/sign-out')

    expect(res.status).toBe(HttpStatus.FORBIDDEN)
  })
})

describe('GET /auth/me', () => {
  it('returns the user for a valid bearer token', async () => {
    const ctx = buildApp()
    const { res: signedIn } = await signIn(ctx)
    const token = (signedIn.body as AppResponse<AuthSessionData>).data?.accessToken ?? ''

    const res = await request(ctx.app).get('/auth/me').set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(HttpStatus.OK)
    expect((res.body as AppResponse<AuthUserData>).data).toMatchObject({ email: EMAIL })
  })

  it('answers 401 without a token or with a bad one', async () => {
    const { app } = buildApp()

    const none = await request(app).get('/auth/me')
    const bad = await request(app).get('/auth/me').set('Authorization', 'Bearer nope')

    expect(none.status).toBe(HttpStatus.UNAUTHORIZED)
    expect(bad.status).toBe(HttpStatus.UNAUTHORIZED)
  })
})
