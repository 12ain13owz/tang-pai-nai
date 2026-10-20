import cookieParser from 'cookie-parser'
import express from 'express'
import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { errorHandler } from '@/core/error'
import type { Notification } from '@/core/notification'
import { accessTokens, skipBreachCheck } from '@/core/security'
import { HttpStatus } from '@/shared/constants'
import { NotificationChannel } from '@/shared/types'
import type { AppResponse } from '@/shared/types'
import { AUTH_LIMITS, REFRESH_COOKIE } from './auth.const'
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
  // Real time by default; `advance` moves past cooldowns without waiting.
  let offsetMs = 0
  const advance = (ms: number) => {
    offsetMs += ms
  }
  const authService = createAuthService({
    authRepo: createMemoryAuthRepository(),
    notifier: {
      send: async (notification) => {
        sent.push(notification)
      },
    },
    accessTokens,
    breachChecker: skipBreachCheck,
    config: {
      webOrigin: WEB,
      signupEnabled: true,
      emailDailyLimit: 100,
      startMinDurationMs: 0,
      phoneEnabled: true,
      smsDailyLimit: 100,
    },
    now: () => new Date(Date.now() + offsetMs),
  })
  const app: Express = express()
  app.use(express.json())
  app.use(cookieParser())
  app.use('/auth', createAuthRouter(createAuthController(authService, { webOrigin: WEB }), WEB))
  app.use(errorHandler)
  const lastCode = () => {
    const mail = sent.at(-1)
    return mail?.channel === NotificationChannel.EMAIL
      ? (/^ {4}(\d{6})$/m.exec(mail.text)?.[1] ?? '')
      : ''
  }
  return { app, sent, lastCode, advance }
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
    expect((res.body as AppResponse<AuthUserData>).data).toMatchObject({
      email: EMAIL,
      hasPassword: false,
    })
  })

  it('answers 401 without a token or with a bad one', async () => {
    const { app } = buildApp()

    const none = await request(app).get('/auth/me')
    const bad = await request(app).get('/auth/me').set('Authorization', 'Bearer nope')

    expect(none.status).toBe(HttpStatus.UNAUTHORIZED)
    expect(bad.status).toBe(HttpStatus.UNAUTHORIZED)
  })
})

const PASSWORD = 'Gr33n Mango Tree'

/** Signs in with a code and returns the bearer header for the new session. */
const bearerFor = async (ctx: ReturnType<typeof buildApp>) => {
  const { res, cookie } = await signIn(ctx)
  const token = (res.body as AppResponse<AuthSessionData>).data?.accessToken ?? ''
  return { auth: `Bearer ${token}`, cookie }
}

describe('PUT /auth/password', () => {
  it('saves the password and answers the user with hasPassword', async () => {
    const ctx = buildApp()
    const { auth } = await bearerFor(ctx)

    const res = await request(ctx.app)
      .put('/auth/password')
      .set('Authorization', auth)
      .send({ newPassword: PASSWORD })

    expect(res.status).toBe(HttpStatus.OK)
    expect((res.body as AppResponse<AuthUserData>).data).toMatchObject({ hasPassword: true })
  })

  it('answers 401 without a bearer token', async () => {
    const { app } = buildApp()

    const res = await request(app).put('/auth/password').send({ newPassword: PASSWORD })

    expect(res.status).toBe(HttpStatus.UNAUTHORIZED)
  })

  it('answers 422 with a code for a refused password, and for a missing one', async () => {
    const ctx = buildApp()
    const { auth } = await bearerFor(ctx)

    const weak = await request(ctx.app)
      .put('/auth/password')
      .set('Authorization', auth)
      .send({ newPassword: 'abcdefgh' })
    const missing = await request(ctx.app).put('/auth/password').set('Authorization', auth).send({})

    expect(weak.status).toBe(HttpStatus.UNPROCESSABLE_ENTITY)
    expect(weak.body).toMatchObject({ code: 'PASSWORD_TOO_WEAK' })
    expect(missing.status).toBe(HttpStatus.UNPROCESSABLE_ENTITY)
  })

  it('signs out the other devices of the user, and keeps this one', async () => {
    const ctx = buildApp()
    const other = await bearerFor(ctx)
    ctx.advance(AUTH_LIMITS.RESEND_COOLDOWN_MS)
    const current = await bearerFor(ctx)

    await request(ctx.app)
      .put('/auth/password')
      .set('Authorization', current.auth)
      .send({ newPassword: PASSWORD })
    const refresh = async (cookie: string) =>
      request(ctx.app).post('/auth/refresh').set('Origin', WEB).set('Cookie', cookie)
    const signedOut = await refresh(other.cookie)
    const stillIn = await refresh(current.cookie)

    expect(signedOut.status).toBe(HttpStatus.UNAUTHORIZED)
    expect(signedOut.body).toMatchObject({ code: 'SESSION_REVOKED' })
    expect(stillIn.status).toBe(HttpStatus.OK)
  })

  it('answers 403 REAUTH_REQUIRED once the sign-in is over 10 minutes old', async () => {
    const ctx = buildApp()
    const { auth } = await bearerFor(ctx)
    ctx.advance(AUTH_LIMITS.RECENT_AUTH_MS + 1)

    // The access token itself would have expired by now in real time; it's only the API clock
    // that moved, so the same token still authenticates.
    const res = await request(ctx.app)
      .put('/auth/password')
      .set('Authorization', auth)
      .send({ newPassword: PASSWORD })

    expect(res.status).toBe(HttpStatus.FORBIDDEN)
    expect(res.body).toMatchObject({ code: 'REAUTH_REQUIRED' })
  })
})

describe('POST /auth/password/sign-in', () => {
  it('signs in with the password: access token in the body, refresh token in the cookie', async () => {
    const ctx = buildApp()
    const { auth } = await bearerFor(ctx)
    await request(ctx.app)
      .put('/auth/password')
      .set('Authorization', auth)
      .send({ newPassword: PASSWORD })

    const res = await request(ctx.app)
      .post('/auth/password/sign-in')
      .send({ email: ' Mom@Example.com ', password: PASSWORD })
    const body = res.body as AppResponse<AuthSessionData>

    expect(res.status).toBe(HttpStatus.OK)
    expect(body.data?.user).toMatchObject({ email: EMAIL, hasPassword: true })
    expect(JSON.stringify(body)).not.toContain('refreshToken')
    expect(refreshCookie(res)).toContain('HttpOnly')
  })

  it('answers the same 400 for a wrong password and an unknown email', async () => {
    const ctx = buildApp()
    const { auth } = await bearerFor(ctx)
    await request(ctx.app)
      .put('/auth/password')
      .set('Authorization', auth)
      .send({ newPassword: PASSWORD })

    const wrong = await request(ctx.app)
      .post('/auth/password/sign-in')
      .send({ email: EMAIL, password: 'Wrong.pass1' })
    const unknown = await request(ctx.app)
      .post('/auth/password/sign-in')
      .send({ email: 'nobody@example.com', password: PASSWORD })

    expect(wrong.status).toBe(HttpStatus.BAD_REQUEST)
    expect(unknown.status).toBe(HttpStatus.BAD_REQUEST)
    const message = (res: request.Response) => res.body as { message: string; code: string }
    expect(message(wrong).message).toBe(message(unknown).message)
    expect(message(wrong).code).toBe('INVALID_CREDENTIALS')
    expect(message(unknown).code).toBe('INVALID_CREDENTIALS')
    expect(setCookies(wrong)).toEqual([])
  })

  it('answers 422 for an empty password', async () => {
    const { app } = buildApp()

    const res = await request(app)
      .post('/auth/password/sign-in')
      .send({ email: EMAIL, password: '' })

    expect(res.status).toBe(HttpStatus.UNPROCESSABLE_ENTITY)
  })
})

describe('DELETE /auth/password', () => {
  it('removes the password, with or without a body', async () => {
    const ctx = buildApp()
    const { auth } = await bearerFor(ctx)
    await request(ctx.app)
      .put('/auth/password')
      .set('Authorization', auth)
      .send({ newPassword: PASSWORD })

    const res = await request(ctx.app).delete('/auth/password').set('Authorization', auth)
    const again = await request(ctx.app)
      .delete('/auth/password')
      .set('Authorization', auth)
      .send({})

    expect(res.status).toBe(HttpStatus.OK)
    expect((res.body as AppResponse<AuthUserData>).data).toMatchObject({ hasPassword: false })
    expect(again.status).toBe(HttpStatus.OK)
  })
})

describe('POST /auth/reauth/start + verify', () => {
  it('answers 202, then 400 for a wrong code and 200 for the mailed one', async () => {
    const ctx = buildApp()
    const { auth } = await bearerFor(ctx)
    ctx.advance(AUTH_LIMITS.RECENT_AUTH_MS + 1)

    const start = await request(ctx.app).post('/auth/reauth/start').set('Authorization', auth)
    const code = ctx.lastCode()
    const wrong = await request(ctx.app)
      .post('/auth/reauth/verify')
      .set('Authorization', auth)
      .send({ code: code === '000000' ? '111111' : '000000' })
    const right = await request(ctx.app)
      .post('/auth/reauth/verify')
      .set('Authorization', auth)
      .send({ code })
    const saved = await request(ctx.app)
      .put('/auth/password')
      .set('Authorization', auth)
      .send({ newPassword: PASSWORD })

    expect(start.status).toBe(HttpStatus.ACCEPTED)
    expect(wrong.status).toBe(HttpStatus.BAD_REQUEST)
    expect(wrong.body).toMatchObject({ code: 'OTP_INVALID' })
    expect(right.status).toBe(HttpStatus.OK)
    expect(saved.status).toBe(HttpStatus.OK)
  })

  it('shares the sign-in email’s 60 s cooldown', async () => {
    const ctx = buildApp()
    const { auth } = await bearerFor(ctx)

    const res = await request(ctx.app).post('/auth/reauth/start').set('Authorization', auth)

    expect(res.status).toBe(HttpStatus.TOO_MANY_REQUESTS)
    expect(res.headers['retry-after']).toBeDefined()
  })

  it('answers 401 without a bearer token', async () => {
    const { app } = buildApp()

    const start = await request(app).post('/auth/reauth/start')
    const verify = await request(app).post('/auth/reauth/verify').send({ code: '123456' })

    expect(start.status).toBe(HttpStatus.UNAUTHORIZED)
    expect(verify.status).toBe(HttpStatus.UNAUTHORIZED)
  })

  it('answers 422 for a malformed code', async () => {
    const ctx = buildApp()
    const { auth } = await bearerFor(ctx)

    const res = await request(ctx.app)
      .post('/auth/reauth/verify')
      .set('Authorization', auth)
      .send({ code: '12ab' })

    expect(res.status).toBe(HttpStatus.UNPROCESSABLE_ENTITY)
  })
})
