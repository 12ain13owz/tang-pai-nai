import { describe, expect, it, vi } from 'vitest'
import type { Notification } from '@/core/notification'
import { createAccessTokens, skipBreachCheck } from '@/core/security'
import { NotificationChannel } from '@/shared/types'
import { AUTH_LIMITS, AuthErrorCode } from './auth.const'
import { createMemoryAuthRepository } from './auth.repository.memory'
import { createAuthService } from './auth.service'
import type { MailLanguage, User } from './auth.entity'
import type { MemoryAuthState } from './auth.repository.memory'
import type { AuthServiceConfig } from './auth.service'

const START = new Date('2026-10-19T00:00:00.000Z')
const MINUTE = 60_000
const DAY = 24 * 60 * MINUTE
const EMAIL = 'mom@example.com'
const CLIENT = { ip: '10.0.0.1', userAgent: 'vitest' }

const accessTokens = createAccessTokens({
  secret: 'service-test-secret-service-test-secret',
  issuer: 'test-api',
  audience: 'test-web',
  ttlSeconds: 600,
})

const disabledUser: User = {
  id: '01900000-0000-7000-8000-000000000001',
  email: 'gone@example.com',
  displayName: 'gone',
  avatarUrl: null,
  emailVerifiedAt: START,
  status: 'disabled',
  timezone: 'Asia/Bangkok',
  createdAt: START,
  updatedAt: START,
}

interface SetupOptions {
  seed?: Partial<MemoryAuthState>
  config?: Partial<AuthServiceConfig>
  repo?: ReturnType<typeof createMemoryAuthRepository>
  clock?: { now: Date }
}

// A fresh in-memory repo, a fake notifier and a controllable clock per test.
const setup = ({ seed, config, repo, clock = { now: START } }: SetupOptions = {}) => {
  const authRepo = repo ?? createMemoryAuthRepository(seed)
  const sent: Notification[] = []
  const send = vi.fn(async (notification: Notification) => {
    sent.push(notification)
  })
  const service = createAuthService({
    authRepo,
    notifier: { send },
    accessTokens,
    breachChecker: skipBreachCheck,
    config: {
      webOrigin: 'http://web.test',
      signupEnabled: true,
      emailDailyLimit: 100,
      startMinDurationMs: 0,
      ...config,
    },
    now: () => clock.now,
  })
  const advance = (ms: number) => {
    clock.now = new Date(clock.now.getTime() + ms)
  }
  const lastMail = () => {
    const mail = sent.at(-1)
    if (mail?.channel !== NotificationChannel.EMAIL) {
      throw new Error('no email sent')
    }
    return {
      ...mail,
      code: /^ {4}(\d{6})$/m.exec(mail.text)?.[1] ?? '',
      token: /#token=([\w-]+)/.exec(mail.text)?.[1] ?? '',
    }
  }
  return { service, repo: authRepo, sent, send, clock, advance, lastMail }
}

/** Starts and verifies with the mailed code: a signed-in user plus their session. */
const signIn = async (ctx: ReturnType<typeof setup>, email = EMAIL) => {
  await ctx.service.startEmailSignIn(email, 'th', CLIENT)
  return ctx.service.verifyEmailSignIn({ email, code: ctx.lastMail().code }, CLIENT)
}

const wrongCode = (code: string) => (code === '000000' ? '111111' : '000000')

describe('startEmailSignIn', () => {
  it.each<[MailLanguage, string]>([
    ['th', 'คือรหัสเข้าสู่ระบบ'],
    ['en', 'is your Tang Pai Nai sign-in code'],
  ])('mails one code and one magic link in the chosen language (%s)', async (lang, subject) => {
    const ctx = setup()
    await ctx.service.startEmailSignIn(EMAIL, lang, CLIENT)

    const mail = ctx.lastMail()
    expect(ctx.sent).toHaveLength(1)
    expect(mail.to).toBe(EMAIL)
    expect(mail.subject).toContain(subject)
    expect(mail.code).toMatch(/^\d{6}$/)
    expect(mail.text).toContain(`http://web.test/auth/link#token=${mail.token}`)
    expect(mail.token).toHaveLength(43)
  })

  it('stores only hashes of the code and the link token', async () => {
    const ctx = setup()
    await ctx.service.startEmailSignIn(EMAIL, 'th', CLIENT)

    const [challenge] = ctx.repo.state().challenges
    const { code, token } = ctx.lastMail()
    expect(challenge.codeHash).toMatch(/^[0-9a-f]{64}$/)
    expect(challenge.codeHash).not.toContain(code)
    expect(challenge.linkTokenHash).not.toBe(token)
    expect(challenge.expiresAt.getTime() - START.getTime()).toBe(AUTH_LIMITS.CHALLENGE_TTL_MS)
  })

  it('creates a challenge but sends nothing for an unknown email when sign-up is closed', async () => {
    const ctx = setup({ config: { signupEnabled: false } })
    await ctx.service.startEmailSignIn('stranger@example.com', 'th', CLIENT)

    expect(ctx.send).not.toHaveBeenCalled()
    expect(ctx.repo.state().challenges).toHaveLength(1)
  })

  it('still mails an existing user when sign-up is closed', async () => {
    const clock = { now: START }
    const open = setup({ clock })
    await signIn(open)
    open.advance(AUTH_LIMITS.RESEND_COOLDOWN_MS)

    const closed = setup({ repo: open.repo, config: { signupEnabled: false }, clock })
    await closed.service.startEmailSignIn(EMAIL, 'th', CLIENT)

    expect(closed.send).toHaveBeenCalledTimes(1)
  })

  it('refuses a second start within the 60 s cooldown, then allows it', async () => {
    const ctx = setup()
    await ctx.service.startEmailSignIn(EMAIL, 'th', CLIENT)

    await expect(ctx.service.startEmailSignIn(EMAIL, 'th', CLIENT)).rejects.toMatchObject({
      status: 429,
      code: AuthErrorCode.RATE_LIMITED,
      retryAfterSeconds: 60,
    })
    ctx.advance(AUTH_LIMITS.RESEND_COOLDOWN_MS)
    await expect(ctx.service.startEmailSignIn(EMAIL, 'th', CLIENT)).resolves.toBeUndefined()
  })

  it('allows 5 starts per email per hour', async () => {
    const ctx = setup()
    for (let i = 0; i < 5; i++) {
      await ctx.service.startEmailSignIn(EMAIL, 'th', CLIENT)
      ctx.advance(AUTH_LIMITS.RESEND_COOLDOWN_MS)
    }

    await expect(ctx.service.startEmailSignIn(EMAIL, 'th', CLIENT)).rejects.toMatchObject({
      status: 429,
    })
  })

  it('allows 20 starts per IP per hour', async () => {
    const ctx = setup()
    for (let i = 0; i < 20; i++) {
      await ctx.service.startEmailSignIn(`user${i}@example.com`, 'th', CLIENT)
    }

    await expect(
      ctx.service.startEmailSignIn('user20@example.com', 'th', CLIENT)
    ).rejects.toMatchObject({ status: 429 })
    await expect(
      ctx.service.startEmailSignIn('user21@example.com', 'th', { ip: '10.0.0.2' })
    ).resolves.toBeUndefined()
  })

  it('stops at the global daily email cap', async () => {
    const ctx = setup({ config: { emailDailyLimit: 2 } })
    await ctx.service.startEmailSignIn('a@example.com', 'th', { ip: '1.1.1.1' })
    await ctx.service.startEmailSignIn('b@example.com', 'th', { ip: '2.2.2.2' })

    await expect(
      ctx.service.startEmailSignIn('c@example.com', 'th', { ip: '3.3.3.3' })
    ).rejects.toMatchObject({ status: 429, code: AuthErrorCode.RATE_LIMITED })
    expect(ctx.sent).toHaveLength(2)
  })

  it('waits at least the minimum duration even when nothing is mailed', async () => {
    const ctx = setup({ config: { signupEnabled: false, startMinDurationMs: 50 } })
    const started = Date.now()
    await ctx.service.startEmailSignIn('stranger@example.com', 'th', CLIENT)

    expect(Date.now() - started).toBeGreaterThanOrEqual(45)
  })
})

describe('verifyEmailSignIn', () => {
  it('creates the user on first sign-in, named after the email local part', async () => {
    const ctx = setup()
    const result = await signIn(ctx)

    expect(result.user).toMatchObject({ email: EMAIL, displayName: 'mom', status: 'active' })
    expect(result.user.emailVerifiedAt).toEqual(START)
    expect(ctx.repo.state().users).toHaveLength(1)
  })

  it('signs an existing user in without creating another', async () => {
    const ctx = setup()
    const first = await signIn(ctx)
    ctx.advance(AUTH_LIMITS.RESEND_COOLDOWN_MS)
    const second = await signIn(ctx)

    expect(second.user.id).toBe(first.user.id)
    expect(ctx.repo.state().users).toHaveLength(1)
  })

  it('issues an access token for the user and session family, and a hashed refresh token', async () => {
    const ctx = setup()
    const result = await signIn(ctx)

    const [session] = ctx.repo.state().sessions
    await expect(accessTokens.verify(result.accessToken)).resolves.toEqual({
      sub: result.user.id,
      sid: session.familyId,
    })
    expect(result.expiresIn).toBe(600)
    expect(session.tokenHash).not.toBe(result.refreshToken)
    expect(session.authTime).toEqual(START)
    expect(session.userAgent).toBe('vitest')
    expect(result.refreshExpiresAt.getTime() - START.getTime()).toBe(AUTH_LIMITS.SESSION_IDLE_MS)
    expect(session.absoluteExpiresAt.getTime() - START.getTime()).toBe(
      AUTH_LIMITS.SESSION_ABSOLUTE_MS
    )
  })

  it('signs in with the magic-link token', async () => {
    const ctx = setup()
    await ctx.service.startEmailSignIn(EMAIL, 'th', CLIENT)

    const result = await ctx.service.verifyEmailSignIn({ token: ctx.lastMail().token }, CLIENT)
    expect(result.user.email).toBe(EMAIL)
  })

  it('answers OTP_INVALID for a wrong code and counts the attempt', async () => {
    const ctx = setup()
    await ctx.service.startEmailSignIn(EMAIL, 'th', CLIENT)

    await expect(
      ctx.service.verifyEmailSignIn({ email: EMAIL, code: wrongCode(ctx.lastMail().code) }, CLIENT)
    ).rejects.toMatchObject({ status: 400, code: AuthErrorCode.OTP_INVALID })
    expect(ctx.repo.state().challenges[0].attempts).toBe(1)
  })

  it('locks the challenge on the 5th wrong code, even for the right code afterwards', async () => {
    const ctx = setup()
    await ctx.service.startEmailSignIn(EMAIL, 'th', CLIENT)
    const { code } = ctx.lastMail()
    const codes: (string | undefined)[] = []
    for (let i = 0; i < AUTH_LIMITS.MAX_CODE_ATTEMPTS; i++) {
      const error: unknown = await ctx.service
        .verifyEmailSignIn({ email: EMAIL, code: wrongCode(code) }, CLIENT)
        .catch((caught: unknown) => caught)
      codes.push((error as { code?: string }).code)
    }

    expect(codes).toEqual([
      'OTP_INVALID',
      'OTP_INVALID',
      'OTP_INVALID',
      'OTP_INVALID',
      'OTP_LOCKED',
    ])
    await expect(
      ctx.service.verifyEmailSignIn({ email: EMAIL, code }, CLIENT)
    ).rejects.toMatchObject({ code: AuthErrorCode.OTP_LOCKED })
  })

  it('answers OTP_EXPIRED after 10 minutes', async () => {
    const ctx = setup()
    await ctx.service.startEmailSignIn(EMAIL, 'th', CLIENT)
    ctx.advance(AUTH_LIMITS.CHALLENGE_TTL_MS)

    await expect(
      ctx.service.verifyEmailSignIn({ email: EMAIL, code: ctx.lastMail().code }, CLIENT)
    ).rejects.toMatchObject({ status: 400, code: AuthErrorCode.OTP_EXPIRED })
  })

  it('accepts a code only once', async () => {
    const ctx = setup()
    await signIn(ctx)

    await expect(
      ctx.service.verifyEmailSignIn({ email: EMAIL, code: ctx.lastMail().code }, CLIENT)
    ).rejects.toMatchObject({ code: AuthErrorCode.OTP_EXPIRED })
    await expect(
      ctx.service.verifyEmailSignIn({ token: ctx.lastMail().token }, CLIENT)
    ).rejects.toMatchObject({ code: AuthErrorCode.OTP_EXPIRED })
  })

  it('answers OTP_EXPIRED when there is no challenge or the token is unknown', async () => {
    const ctx = setup()

    await expect(
      ctx.service.verifyEmailSignIn({ email: EMAIL, code: '123456' }, CLIENT)
    ).rejects.toMatchObject({ code: AuthErrorCode.OTP_EXPIRED })
    await expect(
      ctx.service.verifyEmailSignIn({ token: 'x'.repeat(43) }, CLIENT)
    ).rejects.toMatchObject({ code: AuthErrorCode.OTP_EXPIRED })
  })

  it('replaces the earlier challenge when a new code is requested', async () => {
    const ctx = setup()
    await ctx.service.startEmailSignIn(EMAIL, 'th', CLIENT)
    const first = ctx.lastMail()
    ctx.advance(AUTH_LIMITS.RESEND_COOLDOWN_MS)
    await ctx.service.startEmailSignIn(EMAIL, 'th', CLIENT)

    await expect(
      ctx.service.verifyEmailSignIn({ token: first.token }, CLIENT)
    ).rejects.toMatchObject({ code: AuthErrorCode.OTP_EXPIRED })
    await expect(
      ctx.service.verifyEmailSignIn({ email: EMAIL, code: ctx.lastMail().code }, CLIENT)
    ).resolves.toMatchObject({ user: { email: EMAIL } })
  })

  it('creates no user when sign-up closed after the code was sent', async () => {
    const clock = { now: START }
    const open = setup({ clock })
    await open.service.startEmailSignIn(EMAIL, 'th', CLIENT)
    const closed = setup({ repo: open.repo, config: { signupEnabled: false }, clock })

    await expect(
      closed.service.verifyEmailSignIn({ email: EMAIL, code: open.lastMail().code }, CLIENT)
    ).rejects.toMatchObject({ code: AuthErrorCode.OTP_EXPIRED })
    expect(open.repo.state().users).toHaveLength(0)
  })

  it('refuses a disabled user with 403 after the code is checked', async () => {
    const ctx = setup({ seed: { users: [disabledUser] } })
    await ctx.service.startEmailSignIn(disabledUser.email, 'th', CLIENT)

    await expect(
      ctx.service.verifyEmailSignIn(
        { email: disabledUser.email, code: ctx.lastMail().code },
        CLIENT
      )
    ).rejects.toMatchObject({ status: 403, code: AuthErrorCode.USER_DISABLED })
    expect(ctx.repo.state().sessions).toHaveLength(0)
    expect(ctx.repo.state().challenges[0].consumedAt).toEqual(START)
  })

  it('allows 30 verifies per IP per 15 minutes', async () => {
    const ctx = setup()
    for (let i = 0; i < 30; i++) {
      await ctx.service
        .verifyEmailSignIn({ email: EMAIL, code: '123456' }, CLIENT)
        .catch(() => null)
    }

    await expect(
      ctx.service.verifyEmailSignIn({ email: EMAIL, code: '123456' }, CLIENT)
    ).rejects.toMatchObject({ status: 429 })
  })
})

describe('refresh', () => {
  it('rotates the refresh token within the same family and keeps authTime', async () => {
    const ctx = setup()
    const signedIn = await signIn(ctx)
    ctx.advance(MINUTE)

    const refreshed = await ctx.service.refresh(signedIn.refreshToken, CLIENT)

    const [old, current] = ctx.repo.state().sessions
    expect(refreshed.refreshToken).not.toBe(signedIn.refreshToken)
    expect(old.revokedAt).toEqual(ctx.clock.now)
    expect(old.replacedById).toBe(current.id)
    expect(current.familyId).toBe(old.familyId)
    expect(current.authTime).toEqual(START)
    expect(refreshed.refreshExpiresAt.getTime() - ctx.clock.now.getTime()).toBe(
      AUTH_LIMITS.SESSION_IDLE_MS
    )
  })

  it('treats a reused refresh token as theft and revokes the whole family', async () => {
    const ctx = setup()
    const signedIn = await signIn(ctx)
    const refreshed = await ctx.service.refresh(signedIn.refreshToken, CLIENT)

    await expect(ctx.service.refresh(signedIn.refreshToken, CLIENT)).rejects.toMatchObject({
      status: 401,
      code: AuthErrorCode.SESSION_REVOKED,
    })
    await expect(ctx.service.refresh(refreshed.refreshToken, CLIENT)).rejects.toMatchObject({
      code: AuthErrorCode.SESSION_REVOKED,
    })
    expect(ctx.repo.state().sessions.every((session) => session.revokedAt)).toBe(true)
  })

  it('answers SESSION_EXPIRED without a token or for an unknown one', async () => {
    const ctx = setup()

    await expect(ctx.service.refresh(undefined, CLIENT)).rejects.toMatchObject({
      status: 401,
      code: AuthErrorCode.SESSION_EXPIRED,
    })
    await expect(ctx.service.refresh('unknown-token', CLIENT)).rejects.toMatchObject({
      code: AuthErrorCode.SESSION_EXPIRED,
    })
  })

  it('answers SESSION_EXPIRED after 30 idle days', async () => {
    const ctx = setup()
    const signedIn = await signIn(ctx)
    ctx.advance(AUTH_LIMITS.SESSION_IDLE_MS)

    await expect(ctx.service.refresh(signedIn.refreshToken, CLIENT)).rejects.toMatchObject({
      code: AuthErrorCode.SESSION_EXPIRED,
    })
  })

  it('caps a session at 180 days even when refreshed in time', async () => {
    const ctx = setup()
    let { refreshToken } = await signIn(ctx)
    const absolute = START.getTime() + AUTH_LIMITS.SESSION_ABSOLUTE_MS
    for (let day = 29; day < 180; day += 29) {
      ctx.advance(29 * DAY)
      const refreshed = await ctx.service.refresh(refreshToken, CLIENT)
      expect(refreshed.refreshExpiresAt.getTime()).toBeLessThanOrEqual(absolute)
      refreshToken = refreshed.refreshToken
    }
    ctx.clock.now = new Date(absolute)

    await expect(ctx.service.refresh(refreshToken, CLIENT)).rejects.toMatchObject({
      code: AuthErrorCode.SESSION_EXPIRED,
    })
  })

  it('refuses a user disabled after signing in', async () => {
    const ctx = setup()
    const signedIn = await signIn(ctx)
    ctx.repo.state().users[0].status = 'disabled'

    await expect(ctx.service.refresh(signedIn.refreshToken, CLIENT)).rejects.toMatchObject({
      status: 403,
      code: AuthErrorCode.USER_DISABLED,
    })
  })
})

describe('signOut', () => {
  it('revokes the session family, so its token no longer refreshes', async () => {
    const ctx = setup()
    const signedIn = await signIn(ctx)

    await ctx.service.signOut(signedIn.refreshToken)

    await expect(ctx.service.refresh(signedIn.refreshToken, CLIENT)).rejects.toMatchObject({
      code: AuthErrorCode.SESSION_REVOKED,
    })
  })

  it('leaves other sign-ins of the same user alone', async () => {
    const ctx = setup()
    const phone = await signIn(ctx)
    ctx.advance(AUTH_LIMITS.RESEND_COOLDOWN_MS)
    const laptop = await signIn(ctx)

    await ctx.service.signOut(phone.refreshToken)

    await expect(ctx.service.refresh(laptop.refreshToken, CLIENT)).resolves.toMatchObject({
      user: { email: EMAIL },
    })
  })

  it('does nothing for a missing or unknown token', async () => {
    const ctx = setup()

    await expect(ctx.service.signOut(undefined)).resolves.toBeUndefined()
    await expect(ctx.service.signOut('unknown')).resolves.toBeUndefined()
  })
})

describe('getMe', () => {
  it('returns the user', async () => {
    const ctx = setup()
    const { user } = await signIn(ctx)

    await expect(ctx.service.getMe(user.id)).resolves.toMatchObject({ email: EMAIL })
  })

  it('answers 401 for an unknown user and 403 for a disabled one', async () => {
    const ctx = setup({ seed: { users: [disabledUser] } })

    await expect(ctx.service.getMe('missing')).rejects.toMatchObject({ status: 401 })
    await expect(ctx.service.getMe(disabledUser.id)).rejects.toMatchObject({ status: 403 })
  })
})

describe('cleanup', () => {
  it('deletes only rows that ended more than 7 days ago', async () => {
    const ctx = setup()
    const signedIn = await signIn(ctx)
    await ctx.service.signOut(signedIn.refreshToken)
    ctx.advance(AUTH_LIMITS.CLEANUP_AFTER_MS)

    await expect(ctx.service.cleanup()).resolves.toEqual({
      challenges: 0,
      sessions: 0,
      rateLimitBuckets: 0,
    })
    ctx.advance(AUTH_LIMITS.CHALLENGE_TTL_MS + 1)
    const removed = await ctx.service.cleanup()

    expect(removed.challenges).toBe(1)
    expect(removed.sessions).toBe(1)
    expect(removed.rateLimitBuckets).toBeGreaterThan(0)
  })
})
