import { describe, expect, it, vi } from 'vitest'
import { logger } from '@/core/logger'
import type { Notification } from '@/core/notification'
import { createAccessTokens, skipBreachCheck } from '@/core/security'
import { LOG } from '@/shared/constants'
import { NotificationChannel } from '@/shared/types'
import { AUTH_LIMITS, AuthErrorCode } from './auth.const'
import { buildCredentialChangeMail, buildPhoneSms } from './auth.mail'
import { createMemoryAuthRepository } from './auth.repository.memory'
import { createAuthService } from './auth.service'
import type { Caller } from './auth.entity'

// Phone OTP (auth spec rules 21–27, part 4.4b): adding, changing and removing a verified number,
// signing in with an SMS code, the SMS limits and the mail on a phone change (rule 31).

const START = new Date('2026-10-20T00:00:00.000Z')
const MINUTE = 60_000
const EMAIL = 'mom@example.com'
const PHONE = '+66812345678'
const CLIENT = { ip: '10.0.0.1', userAgent: 'vitest' }
const PASSWORD = 'Gr33n Mango Tree'

const accessTokens = createAccessTokens({
  secret: 'service-test-secret-service-test-secret',
  issuer: 'test-api',
  audience: 'test-web',
  ttlSeconds: 600,
})

const setup = ({ smsDailyLimit = 100, startMinDurationMs = 0 } = {}) => {
  const repo = createMemoryAuthRepository()
  const clock = { now: START }
  const sent: Notification[] = []
  const send = vi.fn(async (notification: Notification) => {
    sent.push(notification)
  })
  const service = createAuthService({
    authRepo: repo,
    notifier: { send },
    accessTokens,
    breachChecker: skipBreachCheck,
    config: {
      webOrigin: 'http://web.test',
      signupEnabled: true,
      emailDailyLimit: 100,
      startMinDurationMs,
      phoneEnabled: true,
      smsDailyLimit,
    },
    now: () => clock.now,
  })
  const advance = (ms: number) => {
    clock.now = new Date(clock.now.getTime() + ms)
  }
  const mails = () =>
    sent.flatMap((notification) =>
      notification.channel === NotificationChannel.EMAIL ? [notification] : []
    )
  const texts = () =>
    sent.flatMap((notification) =>
      notification.channel === NotificationChannel.SMS ? [notification] : []
    )
  const lastMailCode = () => /^ {4}(\d{6})$/m.exec(mails().at(-1)?.text ?? '')?.[1] ?? ''
  const lastSmsCode = () => /: (\d{6}) /.exec(texts().at(-1)?.text ?? '')?.[1] ?? ''
  return { service, repo, clock, advance, sent, mails, texts, lastMailCode, lastSmsCode }
}
type Ctx = ReturnType<typeof setup>

const callerOf = async (accessToken: string): Promise<Caller> => {
  const claims = await accessTokens.verify(accessToken)
  if (!claims) {
    throw new Error('invalid access token')
  }
  return { userId: claims.sub, sessionFamilyId: claims.sid }
}

/** Email-code sign-in: a fresh session (recent auth for the next 10 minutes). */
const signIn = async (ctx: Ctx, email = EMAIL) => {
  ctx.advance(MINUTE)
  await ctx.service.startEmailSignIn(email, 'th', CLIENT)
  const session = await ctx.service.verifyEmailSignIn({ email, code: ctx.lastMailCode() }, CLIENT)
  return { session, caller: await callerOf(session.accessToken) }
}

/** Adds (or changes to) `phone` for the caller: start, then confirm the SMS code. */
const addPhone = async (ctx: Ctx, caller: Caller, phone = PHONE, lang: 'th' | 'en' = 'th') => {
  ctx.advance(MINUTE)
  await ctx.service.startPhoneChange(caller, phone, undefined, CLIENT)
  return ctx.service.confirmPhone(caller, ctx.lastSmsCode(), lang, CLIENT)
}

const goStale = (ctx: Ctx) => ctx.advance(AUTH_LIMITS.RECENT_AUTH_MS + 1)

const disable = (ctx: Ctx, userId: string) => {
  const user = ctx.repo.state().users.find((candidate) => candidate.id === userId)
  if (user) {
    user.status = 'disabled'
  }
}

/** A user who has `phone` saved, signed out of nothing. */
const userWithPhone = async (ctx: Ctx, email = EMAIL, phone = PHONE) => {
  const { caller } = await signIn(ctx, email)
  await addPhone(ctx, caller, phone)
  return caller
}

describe('startPhoneChange + confirmPhone', () => {
  it('texts a verify_phone code to the new number and saves it once confirmed', async () => {
    const ctx = setup()
    const { caller } = await signIn(ctx)

    await ctx.service.startPhoneChange(caller, PHONE, undefined, CLIENT)

    expect(ctx.texts()).toEqual([
      {
        channel: NotificationChannel.SMS,
        to: PHONE,
        text: expect.stringMatching(/^รหัสยืนยันเบอร์ ตังค์ไปไหน: \d{6} ใช้ได้ 5 นาที/) as string,
      },
    ])
    expect((await ctx.service.getMe(caller.userId)).phone).toBeNull()

    const user = await ctx.service.confirmPhone(caller, ctx.lastSmsCode(), 'th', CLIENT)

    expect(user.phone).toBe(PHONE)
    expect(user.phoneVerifiedAt).toEqual(ctx.clock.now)
  })

  it('refuses the number already saved before any SMS', async () => {
    const ctx = setup()
    const caller = await userWithPhone(ctx)
    const before = ctx.texts().length

    await expect(
      ctx.service.startPhoneChange(caller, PHONE, undefined, CLIENT)
    ).rejects.toMatchObject({ status: 422, code: AuthErrorCode.PHONE_UNCHANGED })
    expect(ctx.texts()).toHaveLength(before)
  })

  it('needs recent auth to start, by time, the current password or a step-up code', async () => {
    const ctx = setup()
    const { caller } = await signIn(ctx)
    await ctx.service.setPassword(caller, { newPassword: PASSWORD }, CLIENT)
    goStale(ctx)

    await expect(
      ctx.service.startPhoneChange(caller, PHONE, undefined, CLIENT)
    ).rejects.toMatchObject({ status: 403, code: AuthErrorCode.REAUTH_REQUIRED })
    await expect(
      ctx.service.startPhoneChange(caller, PHONE, 'Wrong pass 1!', CLIENT)
    ).rejects.toMatchObject({ status: 400, code: AuthErrorCode.CURRENT_PASSWORD_INVALID })
    expect(ctx.texts()).toHaveLength(0)

    await ctx.service.startPhoneChange(caller, PHONE, PASSWORD, CLIENT)
    expect(ctx.texts()).toHaveLength(1)

    ctx.advance(MINUTE)
    await ctx.service.startReauth(caller, 'th', CLIENT)
    await ctx.service.verifyReauth(caller, ctx.lastMailCode(), CLIENT)
    await ctx.service.startPhoneChange(caller, '+66898765432', undefined, CLIENT)
    expect(ctx.texts()).toHaveLength(2)
  })

  it('confirms without recent auth: the code was only sent after it', async () => {
    const ctx = setup()
    const { caller } = await signIn(ctx)
    // Started just inside the 10 minutes of recent auth, confirmed just after them.
    ctx.advance(AUTH_LIMITS.RECENT_AUTH_MS - MINUTE)
    await ctx.service.startPhoneChange(caller, PHONE, undefined, CLIENT)
    ctx.advance(2 * MINUTE)

    const user = await ctx.service.confirmPhone(caller, ctx.lastSmsCode(), 'th', CLIENT)
    expect(user.phone).toBe(PHONE)
  })

  it('keeps the saved number until the new one is confirmed', async () => {
    const ctx = setup()
    const caller = await userWithPhone(ctx)

    ctx.advance(MINUTE)
    await ctx.service.startPhoneChange(caller, '+66898765432', undefined, CLIENT)

    expect((await ctx.service.getMe(caller.userId)).phone).toBe(PHONE)
    const user = await ctx.service.confirmPhone(caller, ctx.lastSmsCode(), 'th', CLIENT)
    expect(user.phone).toBe('+66898765432')
  })

  it('checks the code like rule 24: wrong, locked, expired, single use', async () => {
    const ctx = setup()
    const { caller } = await signIn(ctx)
    await ctx.service.startPhoneChange(caller, PHONE, undefined, CLIENT)
    const code = ctx.lastSmsCode()
    const wrong = code === '000000' ? '111111' : '000000'

    for (let attempt = 1; attempt < AUTH_LIMITS.MAX_CODE_ATTEMPTS; attempt += 1) {
      await expect(ctx.service.confirmPhone(caller, wrong, 'th', CLIENT)).rejects.toMatchObject({
        code: AuthErrorCode.OTP_INVALID,
      })
    }
    await expect(ctx.service.confirmPhone(caller, wrong, 'th', CLIENT)).rejects.toMatchObject({
      code: AuthErrorCode.OTP_LOCKED,
    })
    await expect(ctx.service.confirmPhone(caller, code, 'th', CLIENT)).rejects.toMatchObject({
      code: AuthErrorCode.OTP_LOCKED,
    })

    ctx.advance(MINUTE)
    await ctx.service.startPhoneChange(caller, PHONE, undefined, CLIENT)
    ctx.advance(AUTH_LIMITS.SMS_CHALLENGE_TTL_MS)
    await expect(
      ctx.service.confirmPhone(caller, ctx.lastSmsCode(), 'th', CLIENT)
    ).rejects.toMatchObject({ status: 400, code: AuthErrorCode.OTP_EXPIRED })
  })

  it('ends the earlier code when a new number is started', async () => {
    const ctx = setup()
    const { caller } = await signIn(ctx)
    await ctx.service.startPhoneChange(caller, PHONE, undefined, CLIENT)
    const first = ctx.lastSmsCode()
    ctx.advance(MINUTE)
    await ctx.service.startPhoneChange(caller, '+66898765432', undefined, CLIENT)

    if (first !== ctx.lastSmsCode()) {
      await expect(ctx.service.confirmPhone(caller, first, 'th', CLIENT)).rejects.toMatchObject({
        code: AuthErrorCode.OTP_INVALID,
      })
    }
    const user = await ctx.service.confirmPhone(caller, ctx.lastSmsCode(), 'th', CLIENT)
    expect(user.phone).toBe('+66898765432')
  })

  it('never lets one user confirm another user’s code', async () => {
    const ctx = setup()
    const mom = await signIn(ctx)
    const dad = await signIn(ctx, 'dad@example.com')
    await ctx.service.startPhoneChange(mom.caller, PHONE, undefined, CLIENT)

    await expect(
      ctx.service.confirmPhone(dad.caller, ctx.lastSmsCode(), 'th', CLIENT)
    ).rejects.toMatchObject({ code: AuthErrorCode.OTP_EXPIRED })
  })

  it('answers a generic 409 for a number another user holds, and uses the code up', async () => {
    const ctx = setup()
    await userWithPhone(ctx)
    const dad = await signIn(ctx, 'dad@example.com')
    ctx.advance(MINUTE)
    await ctx.service.startPhoneChange(dad.caller, PHONE, undefined, CLIENT)
    const code = ctx.lastSmsCode()

    await expect(ctx.service.confirmPhone(dad.caller, code, 'th', CLIENT)).rejects.toMatchObject({
      status: 409,
      code: AuthErrorCode.PHONE_IN_USE,
    })
    await expect(ctx.service.confirmPhone(dad.caller, code, 'th', CLIENT)).rejects.toMatchObject({
      code: AuthErrorCode.OTP_EXPIRED,
    })
    expect((await ctx.service.getMe(dad.caller.userId)).phone).toBeNull()
  })

  it('refuses a caller whose session was revoked (its access token still verifies)', async () => {
    const ctx = setup()
    const { session, caller } = await signIn(ctx)
    await ctx.service.signOut(session.refreshToken)

    await expect(
      ctx.service.startPhoneChange(caller, PHONE, undefined, CLIENT)
    ).rejects.toMatchObject({ status: 401 })
  })
})

describe('removePhone', () => {
  it('needs recent auth, removes the number and mails the change', async () => {
    const ctx = setup()
    const caller = await userWithPhone(ctx)
    await ctx.service.setPassword(caller, { newPassword: PASSWORD }, CLIENT)
    goStale(ctx)

    await expect(ctx.service.removePhone(caller, undefined, 'en', CLIENT)).rejects.toMatchObject({
      code: AuthErrorCode.REAUTH_REQUIRED,
    })

    const user = await ctx.service.removePhone(caller, PASSWORD, 'en', CLIENT)

    expect(user.phone).toBeNull()
    expect(user.phoneVerifiedAt).toBeNull()
    expect(ctx.mails().at(-1)?.subject).toBe(
      'Your phone number was removed on your Tang Pai Nai account'
    )
    expect(ctx.mails().at(-1)?.text).toContain('(ending in 5678)')
  })

  it('is a no-op without a number: no proof asked, no mail', async () => {
    const ctx = setup()
    const { caller } = await signIn(ctx)
    goStale(ctx)
    const before = ctx.mails().length

    const user = await ctx.service.removePhone(caller, undefined, 'th', CLIENT)

    expect(user.phone).toBeNull()
    expect(ctx.mails()).toHaveLength(before)
  })

  it('frees the number for another user', async () => {
    const ctx = setup()
    const mom = await userWithPhone(ctx)
    await ctx.service.removePhone(mom, undefined, 'th', CLIENT)
    const dad = await signIn(ctx, 'dad@example.com')

    expect((await addPhone(ctx, dad.caller)).phone).toBe(PHONE)
  })
})

describe('startPhoneSignIn', () => {
  it('texts a sign-in code to an active user’s verified number', async () => {
    const ctx = setup()
    await userWithPhone(ctx)
    ctx.advance(MINUTE)

    await ctx.service.startPhoneSignIn(PHONE, CLIENT)

    expect(ctx.texts().at(-1)).toEqual({
      channel: NotificationChannel.SMS,
      to: PHONE,
      text: expect.stringMatching(/^รหัสเข้าสู่ระบบ ตังค์ไปไหน: \d{6} ใช้ได้ 5 นาที/) as string,
    })
  })

  it('sends nothing and stores nothing for an unknown number or a disabled user', async () => {
    const ctx = setup()
    const caller = await userWithPhone(ctx)
    const challenges = ctx.repo.state().challenges.length
    const texts = ctx.texts().length

    await ctx.service.startPhoneSignIn('+66899999999', CLIENT)
    disable(ctx, caller.userId)
    ctx.advance(MINUTE)
    await ctx.service.startPhoneSignIn(PHONE, CLIENT)

    expect(ctx.texts()).toHaveLength(texts)
    expect(ctx.repo.state().challenges).toHaveLength(challenges)
  })

  it('takes at least the minimum time, SMS or not', async () => {
    const ctx = setup({ startMinDurationMs: 50 })
    const started = Date.now()

    await ctx.service.startPhoneSignIn('+66899999999', CLIENT)

    expect(Date.now() - started).toBeGreaterThanOrEqual(45)
  })

  it('limits starts: 60 s cooldown and 3 per number per hour', async () => {
    const ctx = setup()
    await ctx.service.startPhoneSignIn(PHONE, CLIENT)
    await expect(ctx.service.startPhoneSignIn(PHONE, CLIENT)).rejects.toMatchObject({
      status: 429,
      code: AuthErrorCode.RATE_LIMITED,
      retryAfterSeconds: 60,
    })
    ctx.advance(MINUTE)
    await ctx.service.startPhoneSignIn(PHONE, CLIENT)
    ctx.advance(MINUTE)
    await expect(ctx.service.startPhoneSignIn(PHONE, CLIENT)).rejects.toMatchObject({
      status: 429,
    })
    ctx.advance(AUTH_LIMITS.STARTS_PER_PHONE.windowMs)
    await ctx.service.startPhoneSignIn(PHONE, CLIENT)
  })

  it('limits starts per IP (10 per hour), unknown numbers included', async () => {
    const ctx = setup()
    for (let i = 0; i < AUTH_LIMITS.SMS_STARTS_PER_IP.limit; i += 1) {
      await ctx.service.startPhoneSignIn(`+6689000000${i}`, CLIENT)
    }
    await expect(ctx.service.startPhoneSignIn('+66891111111', CLIENT)).rejects.toMatchObject({
      status: 429,
    })
    await ctx.service.startPhoneSignIn('+66892222222', { ...CLIENT, ip: '10.0.0.2' })
  })

  it('shares the per-number buckets with adding a number', async () => {
    const ctx = setup()
    const { caller } = await signIn(ctx)
    await ctx.service.startPhoneSignIn(PHONE, CLIENT)

    await expect(
      ctx.service.startPhoneChange(caller, PHONE, undefined, CLIENT)
    ).rejects.toMatchObject({ status: 429 })
  })

  it('refuses every start at the daily SMS cap, known number or not, and logs a warning', async () => {
    const warn = vi.spyOn(logger, 'warn')
    const ctx = setup({ smsDailyLimit: 1 })
    await userWithPhone(ctx)
    ctx.advance(MINUTE)

    await expect(ctx.service.startPhoneSignIn(PHONE, CLIENT)).rejects.toMatchObject({
      status: 429,
    })
    await expect(
      ctx.service.startPhoneSignIn('+66899999999', { ...CLIENT, ip: '10.0.0.9' })
    ).rejects.toMatchObject({ status: 429 })
    expect(warn).toHaveBeenCalledWith(LOG.AUTH.smsDailyLimit(1))
    warn.mockRestore()
  })

  it('counts the daily cap only for SMS that went out', async () => {
    const ctx = setup({ smsDailyLimit: 1 })
    for (let i = 0; i < 3; i += 1) {
      await ctx.service.startPhoneSignIn(`+6689000000${i}`, CLIENT)
    }
    const { caller } = await signIn(ctx)

    await ctx.service.startPhoneChange(caller, PHONE, undefined, CLIENT)
    expect(ctx.texts()).toHaveLength(1)
  })
})

describe('verifyPhoneSignIn', () => {
  it('signs the number’s owner in with a fresh session (recent auth)', async () => {
    const ctx = setup()
    const owner = await userWithPhone(ctx)
    ctx.advance(MINUTE)
    await ctx.service.startPhoneSignIn(PHONE, CLIENT)

    const result = await ctx.service.verifyPhoneSignIn(PHONE, ctx.lastSmsCode(), CLIENT)

    expect(result.user).toMatchObject({ id: owner.userId, phone: PHONE })
    expect(result.refreshToken).not.toBe('')
    const caller = await callerOf(result.accessToken)
    expect(caller.sessionFamilyId).not.toBe(owner.sessionFamilyId)
    // Signing in with the phone counts as recent auth (rule 13).
    await ctx.service.removePhone(caller, undefined, 'th', CLIENT)
  })

  it('answers OTP_EXPIRED for an unknown number and a used code', async () => {
    const ctx = setup()
    await userWithPhone(ctx)
    ctx.advance(MINUTE)
    await ctx.service.startPhoneSignIn(PHONE, CLIENT)
    const code = ctx.lastSmsCode()

    await expect(ctx.service.verifyPhoneSignIn('+66899999999', code, CLIENT)).rejects.toMatchObject(
      { status: 400, code: AuthErrorCode.OTP_EXPIRED }
    )
    await ctx.service.verifyPhoneSignIn(PHONE, code, CLIENT)
    await expect(ctx.service.verifyPhoneSignIn(PHONE, code, CLIENT)).rejects.toMatchObject({
      code: AuthErrorCode.OTP_EXPIRED,
    })
  })

  it('expires the code after 5 minutes and locks it after 5 wrong tries', async () => {
    const ctx = setup()
    await userWithPhone(ctx)
    ctx.advance(MINUTE)
    await ctx.service.startPhoneSignIn(PHONE, CLIENT)
    const code = ctx.lastSmsCode()
    const wrong = code === '000000' ? '111111' : '000000'

    for (let attempt = 1; attempt <= AUTH_LIMITS.MAX_CODE_ATTEMPTS; attempt += 1) {
      await expect(ctx.service.verifyPhoneSignIn(PHONE, wrong, CLIENT)).rejects.toMatchObject({
        code:
          attempt === AUTH_LIMITS.MAX_CODE_ATTEMPTS
            ? AuthErrorCode.OTP_LOCKED
            : AuthErrorCode.OTP_INVALID,
      })
    }

    ctx.advance(MINUTE)
    await ctx.service.startPhoneSignIn(PHONE, CLIENT)
    ctx.advance(AUTH_LIMITS.SMS_CHALLENGE_TTL_MS)
    await expect(
      ctx.service.verifyPhoneSignIn(PHONE, ctx.lastSmsCode(), CLIENT)
    ).rejects.toMatchObject({ code: AuthErrorCode.OTP_EXPIRED })
  })

  it('refuses a user disabled after the code was sent, after the code check', async () => {
    const ctx = setup()
    const owner = await userWithPhone(ctx)
    ctx.advance(MINUTE)
    await ctx.service.startPhoneSignIn(PHONE, CLIENT)
    disable(ctx, owner.userId)

    await expect(
      ctx.service.verifyPhoneSignIn(PHONE, ctx.lastSmsCode(), CLIENT)
    ).rejects.toMatchObject({ status: 403, code: AuthErrorCode.USER_DISABLED })
  })

  it('refuses a code whose number was removed meanwhile', async () => {
    const ctx = setup()
    const owner = await userWithPhone(ctx)
    ctx.advance(MINUTE)
    await ctx.service.startPhoneSignIn(PHONE, CLIENT)
    await ctx.service.removePhone(owner, undefined, 'th', CLIENT)

    await expect(
      ctx.service.verifyPhoneSignIn(PHONE, ctx.lastSmsCode(), CLIENT)
    ).rejects.toMatchObject({ code: AuthErrorCode.OTP_EXPIRED })
  })

  it('shares the per-IP verify limit (30 per 15 min)', async () => {
    const ctx = setup()
    for (let i = 0; i < AUTH_LIMITS.VERIFIES_PER_IP.limit; i += 1) {
      await expect(ctx.service.verifyPhoneSignIn(PHONE, '000000', CLIENT)).rejects.toMatchObject({
        status: 400,
      })
    }
    await expect(ctx.service.verifyPhoneSignIn(PHONE, '000000', CLIENT)).rejects.toMatchObject({
      status: 429,
    })
  })
})

describe('phone logs (rule 27)', () => {
  it('logs numbers masked, never in full', async () => {
    const info = vi.spyOn(logger, 'info')
    const ctx = setup()
    await userWithPhone(ctx)
    ctx.advance(MINUTE)
    await ctx.service.startPhoneSignIn(PHONE, CLIENT)
    await ctx.service.verifyPhoneSignIn(PHONE, ctx.lastSmsCode(), CLIENT)

    const logged = JSON.stringify(info.mock.calls)
    expect(logged).not.toContain(PHONE)
    expect(logged).toContain('+66*****5678')
    expect(info).toHaveBeenCalledWith(LOG.AUTH.phoneAdded, expect.anything())
    expect(info).toHaveBeenCalledWith(LOG.AUTH.signedIn('phone'), expect.anything())
    info.mockRestore()
  })
})

describe('mail on a phone change (rule 31)', () => {
  it('mails an added and a changed number with its last 4 digits, in the request’s language', async () => {
    const ctx = setup()
    const { caller } = await signIn(ctx)

    await addPhone(ctx, caller, PHONE, 'th')
    expect(ctx.mails().at(-1)).toMatchObject({
      to: EMAIL,
      subject: 'มีการเพิ่มเบอร์มือถือ ในบัญชีผู้ใช้ ตังค์ไปไหน',
      text: expect.stringContaining('(ลงท้าย 5678)') as string,
    })

    await addPhone(ctx, caller, '+66898765432', 'en')
    expect(ctx.mails().at(-1)).toMatchObject({
      subject: 'Your phone number was changed on your Tang Pai Nai account',
      text: expect.stringContaining('(ending in 5432)') as string,
    })
  })
})

describe('buildPhoneSms', () => {
  it('fits one UCS-2 segment (≤ 70 UTF-16 units) and holds no link (rule 26)', () => {
    for (const purpose of ['sign_in', 'verify_phone'] as const) {
      const text = buildPhoneSms(purpose, '123456', 5)
      expect(text.length).toBeLessThanOrEqual(70)
      expect(text).toContain('ตังค์ไปไหน')
      expect(text).toContain('123456')
      expect(text).not.toMatch(/https?:|www\./)
    }
  })
})

describe('buildCredentialChangeMail (phone)', () => {
  it('names the number by its last 4 digits only', () => {
    const mail = buildCredentialChangeMail({
      change: 'phone_added',
      lang: 'en',
      at: START,
      timeZone: 'Asia/Bangkok',
      phoneLastDigits: '5678',
    })

    expect(mail.subject).toBe('A phone number was added on your Tang Pai Nai account')
    expect(mail.text).toContain('A phone number was added (ending in 5678) on your')
    expect(mail.text).not.toContain('812345678')
  })
})
