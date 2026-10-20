import cookieParser from 'cookie-parser'
import express from 'express'
import request from 'supertest'
import { describe, expect, it, vi } from 'vitest'
import { errorHandler } from '@/core/error'
import type { Notification } from '@/core/notification'
import { accessTokens, skipBreachCheck } from '@/core/security'
import { HttpStatus } from '@/shared/constants'
import { NotificationChannel } from '@/shared/types'
import type { AppResponse } from '@/shared/types'
import { AUTH_LIMITS, AuthErrorCode, REFRESH_COOKIE } from './auth.const'
import { createAuthController } from './auth.controller'
import { createMemoryAuthRepository } from './auth.repository.memory'
import { createAuthRouter } from './auth.routes'
import { createAuthService } from './auth.service'
import type { AuthProvidersData, AuthSessionData, AuthUserData } from './auth.type'
import type { Express } from 'express'

// The HTTP side of phone OTP (auth spec rules 21–25, 4.4b): routes, validation, the 503 gate
// and the shapes. The rules themselves are in auth.service.phone.test.ts.

const WEB = 'http://web.test'
const START = new Date('2026-10-20T00:00:00.000Z')
const MINUTE = 60_000

const buildApp = ({ phoneEnabled = true } = {}) => {
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
    config: {
      webOrigin: WEB,
      signupEnabled: true,
      emailDailyLimit: 100,
      startMinDurationMs: 0,
      phoneEnabled,
      smsDailyLimit: 100,
    },
    now: () => clock.now,
  })
  const app: Express = express()
  app.use(express.json())
  app.use(cookieParser())
  app.use('/auth', createAuthRouter(createAuthController(authService, { webOrigin: WEB }), WEB))
  app.use(errorHandler)
  const lastCode = () => {
    const last = sent.at(-1)
    if (last?.channel === NotificationChannel.SMS) {
      return /: (\d{6}) /.exec(last.text)?.[1] ?? ''
    }
    return last ? (/^ {4}(\d{6})$/m.exec(last.text)?.[1] ?? '') : ''
  }
  const advance = (ms: number) => {
    clock.now = new Date(clock.now.getTime() + ms)
  }
  return { app, lastCode, advance, sent }
}
type Ctx = ReturnType<typeof buildApp>

const signIn = async (ctx: Ctx, email = 'mom@example.com') => {
  ctx.advance(MINUTE)
  await request(ctx.app).post('/auth/email/start').send({ email })
  const res = await request(ctx.app)
    .post('/auth/email/verify')
    .send({ email, code: ctx.lastCode() })
  const body = res.body as AppResponse<AuthSessionData>
  return `Bearer ${body.data?.accessToken ?? ''}`
}

/** POST /auth/phone → the SMS code → POST /auth/phone/confirm. */
const addPhone = async (ctx: Ctx, bearer: string, phone = '081-234-5678') => {
  ctx.advance(MINUTE)
  await request(ctx.app).post('/auth/phone').set('Authorization', bearer).send({ phone })
  return request(ctx.app)
    .post('/auth/phone/confirm')
    .set('Authorization', bearer)
    .send({ code: ctx.lastCode(), lang: 'en' })
}

describe('GET /auth/providers', () => {
  it('says whether phone sign-in is on', async () => {
    for (const phoneEnabled of [true, false]) {
      const res = await request(buildApp({ phoneEnabled }).app).get('/auth/providers')
      const body = res.body as AppResponse<AuthProvidersData>
      expect(body.data).toEqual({ google: false, phone: phoneEnabled })
    }
  })
})

describe('/auth/phone* with SMS off', () => {
  it('answers 503 PHONE_DISABLED before the token or the body is looked at', async () => {
    const ctx = buildApp({ phoneEnabled: false })
    const calls = [
      request(ctx.app).post('/auth/phone/start').send({ phone: '0812345678' }),
      request(ctx.app).post('/auth/phone/start').send({ phone: 'not a number' }),
      request(ctx.app).post('/auth/phone/verify').send({}),
      request(ctx.app).post('/auth/phone').send({}),
      request(ctx.app).post('/auth/phone/confirm').send({}),
      request(ctx.app).delete('/auth/phone'),
    ]
    for (const res of await Promise.all(calls)) {
      expect(res.status).toBe(HttpStatus.SERVICE_UNAVAILABLE)
      expect((res.body as { code?: string }).code).toBe(AuthErrorCode.PHONE_DISABLED)
    }
    expect(ctx.sent).toHaveLength(0)
  })
})

describe('POST /auth/phone + /auth/phone/confirm', () => {
  it('normalises the number, answers 202, then saves it and answers the user', async () => {
    const ctx = buildApp()
    const bearer = await signIn(ctx)

    const start = await request(ctx.app)
      .post('/auth/phone')
      .set('Authorization', bearer)
      .send({ phone: '+66 81-234-5678' })

    expect(start.status).toBe(HttpStatus.ACCEPTED)
    expect(ctx.sent.at(-1)).toMatchObject({ channel: NotificationChannel.SMS, to: '+66812345678' })

    const confirm = await request(ctx.app)
      .post('/auth/phone/confirm')
      .set('Authorization', bearer)
      .send({ code: ctx.lastCode(), lang: 'en' })

    const body = confirm.body as AppResponse<AuthUserData>
    expect(confirm.status).toBe(HttpStatus.OK)
    expect(body.data?.phone).toBe('+66812345678')
    expect(ctx.sent.at(-1)).toMatchObject({ channel: NotificationChannel.EMAIL })
  })

  it('refuses a number that isn’t a Thai mobile with 422', async () => {
    const ctx = buildApp()
    const bearer = await signIn(ctx)

    for (const phone of ['021234567', '+1 555 123 4567', '081234567', '']) {
      const res = await request(ctx.app)
        .post('/auth/phone')
        .set('Authorization', bearer)
        .send({ phone })
      expect(res.status).toBe(HttpStatus.UNPROCESSABLE_ENTITY)
    }
  })

  it('answers 422 PHONE_UNCHANGED for the saved number and 409 PHONE_IN_USE for another user’s', async () => {
    const ctx = buildApp()
    const mom = await signIn(ctx)
    await addPhone(ctx, mom)

    const same = await request(ctx.app)
      .post('/auth/phone')
      .set('Authorization', mom)
      .send({ phone: '0812345678' })
    expect(same.status).toBe(HttpStatus.UNPROCESSABLE_ENTITY)
    expect((same.body as { code?: string }).code).toBe(AuthErrorCode.PHONE_UNCHANGED)

    const dad = await signIn(ctx, 'dad@example.com')
    const taken = await addPhone(ctx, dad)
    expect(taken.status).toBe(HttpStatus.CONFLICT)
    expect((taken.body as { code?: string }).code).toBe(AuthErrorCode.PHONE_IN_USE)
  })

  it('answers 403 REAUTH_REQUIRED once the sign-in is no longer recent', async () => {
    const ctx = buildApp()
    const bearer = await signIn(ctx)
    ctx.advance(AUTH_LIMITS.RECENT_AUTH_MS + 1)

    const res = await request(ctx.app)
      .post('/auth/phone')
      .set('Authorization', bearer)
      .send({ phone: '0812345678' })

    expect(res.status).toBe(HttpStatus.FORBIDDEN)
    expect((res.body as { code?: string }).code).toBe(AuthErrorCode.REAUTH_REQUIRED)
  })

  it('needs a Bearer token and a 6-digit code', async () => {
    const ctx = buildApp()
    const bearer = await signIn(ctx)

    const noToken = await request(ctx.app).post('/auth/phone').send({ phone: '0812345678' })
    const badCode = await request(ctx.app)
      .post('/auth/phone/confirm')
      .set('Authorization', bearer)
      .send({ code: '12' })

    expect(noToken.status).toBe(HttpStatus.UNAUTHORIZED)
    expect(badCode.status).toBe(HttpStatus.UNPROCESSABLE_ENTITY)
  })
})

describe('DELETE /auth/phone', () => {
  it('removes the number and answers the user, also without a body', async () => {
    const ctx = buildApp()
    const bearer = await signIn(ctx)
    await addPhone(ctx, bearer)

    const res = await request(ctx.app).delete('/auth/phone').set('Authorization', bearer)

    const body = res.body as AppResponse<AuthUserData>
    expect(res.status).toBe(HttpStatus.OK)
    expect(body.data?.phone).toBeNull()
  })
})

describe('POST /auth/phone/start + /auth/phone/verify', () => {
  it('always answers 202, then signs in with the SMS code and sets the refresh cookie', async () => {
    const ctx = buildApp()
    await addPhone(ctx, await signIn(ctx))
    ctx.advance(MINUTE)

    const unknown = await request(ctx.app).post('/auth/phone/start').send({ phone: '0899999999' })
    const known = await request(ctx.app).post('/auth/phone/start').send({ phone: '0812345678' })
    expect(unknown.status).toBe(HttpStatus.ACCEPTED)
    expect(known.status).toBe(HttpStatus.ACCEPTED)
    expect(unknown.body).toMatchObject({ message: (known.body as { message: string }).message })

    const res = await request(ctx.app)
      .post('/auth/phone/verify')
      .send({ phone: '081-234-5678', code: ctx.lastCode() })

    const body = res.body as AppResponse<AuthSessionData>
    expect(res.status).toBe(HttpStatus.OK)
    expect(body.data?.user.phone).toBe('+66812345678')
    expect(body.data?.accessToken).toBeTruthy()
    expect(JSON.stringify(body)).not.toContain('refreshToken')
    const cookies: unknown = res.headers['set-cookie']
    expect(String(cookies)).toContain(`${REFRESH_COOKIE}=`)
  })

  it('answers 400 OTP_EXPIRED for a number with no code', async () => {
    const ctx = buildApp()

    const res = await request(ctx.app)
      .post('/auth/phone/verify')
      .send({ phone: '0812345678', code: '123456' })

    expect(res.status).toBe(HttpStatus.BAD_REQUEST)
    expect((res.body as { code?: string }).code).toBe(AuthErrorCode.OTP_EXPIRED)
  })

  it('answers 429 with Retry-After inside the resend cooldown', async () => {
    const ctx = buildApp()
    await request(ctx.app).post('/auth/phone/start').send({ phone: '0812345678' })

    const res = await request(ctx.app).post('/auth/phone/start').send({ phone: '0812345678' })

    expect(res.status).toBe(HttpStatus.TOO_MANY_REQUESTS)
    expect(res.headers['retry-after']).toBe('60')
  })

  it('never echoes the number in an error response body', async () => {
    const ctx = buildApp()

    const res = await request(ctx.app).post('/auth/phone/start').send({ phone: '02-123-4567' })

    expect(res.status).toBe(HttpStatus.UNPROCESSABLE_ENTITY)
    expect(JSON.stringify(res.body)).not.toContain('02-123-4567')
  })
})
