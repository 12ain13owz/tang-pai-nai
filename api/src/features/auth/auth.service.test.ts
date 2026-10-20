import { hash } from '@node-rs/argon2'
import { describe, expect, it, vi } from 'vitest'
import { logger } from '@/core/logger'
import type { Notification } from '@/core/notification'
import {
  createAccessTokens,
  hashPassword,
  passwordNeedsRehash,
  skipBreachCheck,
} from '@/core/security'
import type { BreachedPasswordChecker } from '@/core/security'
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
  phone: null,
  phoneVerifiedAt: null,
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
  breachChecker?: BreachedPasswordChecker
}

// A fresh in-memory repo, a fake notifier and a controllable clock per test.
const setup = ({
  seed,
  config,
  repo,
  clock = { now: START },
  breachChecker = skipBreachCheck,
}: SetupOptions = {}) => {
  const authRepo = repo ?? createMemoryAuthRepository(seed)
  const sent: Notification[] = []
  const send = vi.fn(async (notification: Notification) => {
    sent.push(notification)
  })
  const service = createAuthService({
    authRepo,
    notifier: { send },
    accessTokens,
    breachChecker,
    config: {
      webOrigin: 'http://web.test',
      signupEnabled: true,
      emailDailyLimit: 100,
      phoneEnabled: true,
      smsDailyLimit: 100,
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

// ── Password (4.2) ──────────────────────────────────────────────────────────────────────────

const PASSWORD = 'Gr33n Mango Tree'
const OTHER_PASSWORD = 'Blue.Sky.2026'

/** The caller an access token stands for, as `authenticate` would set it. */
const callerOf = async (accessToken: string) => {
  const claims = await accessTokens.verify(accessToken)
  if (!claims) {
    throw new Error('invalid access token')
  }
  return { userId: claims.sub, sessionFamilyId: claims.sid }
}

/** Signs in with a code and sets a password while the sign-in is still recent. */
const withPassword = async (ctx: ReturnType<typeof setup>, password = PASSWORD) => {
  const session = await signIn(ctx)
  const caller = await callerOf(session.accessToken)
  await ctx.service.setPassword(caller, { newPassword: password }, CLIENT)
  return { session, caller }
}

/** Moves the clock past the recent-auth window. */
const goStale = (ctx: ReturnType<typeof setup>) => ctx.advance(AUTH_LIMITS.RECENT_AUTH_MS + 1)

describe('signInWithPassword', () => {
  it('creates a new session family checked just now, for a user with a password', async () => {
    const ctx = setup()
    await withPassword(ctx)
    ctx.advance(DAY)

    const result = await ctx.service.signInWithPassword(EMAIL, PASSWORD, CLIENT)

    const caller = await callerOf(result.accessToken)
    const session = ctx.repo.state().sessions.find((row) => row.familyId === caller.sessionFamilyId)
    expect(result.user).toMatchObject({ email: EMAIL, hasPassword: true })
    expect(result.refreshToken).toHaveLength(43)
    expect(session?.authTime).toEqual(ctx.clock.now)
  })

  it.each([
    ['a wrong password', EMAIL, 'Wrong.pass1'],
    ['an unknown email', 'nobody@example.com', PASSWORD],
  ])('answers INVALID_CREDENTIALS for %s', async (_case, email, password) => {
    const ctx = setup()
    await withPassword(ctx)

    await expect(ctx.service.signInWithPassword(email, password, CLIENT)).rejects.toMatchObject({
      status: 400,
      code: AuthErrorCode.INVALID_CREDENTIALS,
    })
  })

  it('answers the same for a user who has no password', async () => {
    const ctx = setup()
    await signIn(ctx)

    await expect(ctx.service.signInWithPassword(EMAIL, PASSWORD, CLIENT)).rejects.toMatchObject({
      status: 400,
      code: AuthErrorCode.INVALID_CREDENTIALS,
    })
  })

  it('refuses every attempt after 5 failures for one email, even the right password', async () => {
    const ctx = setup()
    await withPassword(ctx)
    for (let i = 0; i < 5; i += 1) {
      await expect(
        ctx.service.signInWithPassword(EMAIL, 'Wrong.pass1', { ip: `10.0.1.${i}` })
      ).rejects.toMatchObject({ code: AuthErrorCode.INVALID_CREDENTIALS })
    }

    await expect(ctx.service.signInWithPassword(EMAIL, PASSWORD, CLIENT)).rejects.toMatchObject({
      status: 429,
      code: AuthErrorCode.RATE_LIMITED,
      retryAfterSeconds: 15 * 60,
    })
    ctx.advance(AUTH_LIMITS.PASSWORD_FAILURES_PER_EMAIL.windowMs)
    await expect(ctx.service.signInWithPassword(EMAIL, PASSWORD, CLIENT)).resolves.toBeDefined()
  })

  it('refuses every attempt from an IP after 30 failures there', async () => {
    const ctx = setup()
    await withPassword(ctx)
    for (let i = 0; i < 30; i += 1) {
      await expect(
        ctx.service.signInWithPassword(`u${i}@example.com`, 'Wrong.pass1', CLIENT)
      ).rejects.toMatchObject({ code: AuthErrorCode.INVALID_CREDENTIALS })
    }

    await expect(ctx.service.signInWithPassword(EMAIL, PASSWORD, CLIENT)).rejects.toMatchObject({
      status: 429,
    })
    await expect(
      ctx.service.signInWithPassword(EMAIL, PASSWORD, { ip: '10.0.0.2' })
    ).resolves.toBeDefined()
  })

  it('does not count successful sign-ins toward the limits', async () => {
    const ctx = setup()
    await withPassword(ctx)

    for (let i = 0; i < 6; i += 1) {
      await expect(ctx.service.signInWithPassword(EMAIL, PASSWORD, CLIENT)).resolves.toBeDefined()
    }
  })

  it('answers 403 for a disabled user only once the password is right', async () => {
    const passwordHash = await hashPassword(PASSWORD)
    const ctx = setup({
      seed: { users: [disabledUser], passwords: new Map([[disabledUser.id, passwordHash]]) },
    })

    await expect(
      ctx.service.signInWithPassword(disabledUser.email, 'Wrong.pass1', CLIENT)
    ).rejects.toMatchObject({ status: 400, code: AuthErrorCode.INVALID_CREDENTIALS })
    await expect(
      ctx.service.signInWithPassword(disabledUser.email, PASSWORD, CLIENT)
    ).rejects.toMatchObject({ status: 403, code: AuthErrorCode.USER_DISABLED })
  })

  it('upgrades a hash made with older parameters', async () => {
    const ctx = setup()
    const { caller } = await withPassword(ctx)
    const weaker = await hash(PASSWORD, { memoryCost: 8192, timeCost: 1, parallelism: 1 })
    ctx.repo.state().passwords.set(caller.userId, weaker)

    await ctx.service.signInWithPassword(EMAIL, PASSWORD, CLIENT)

    const stored = ctx.repo.state().passwords.get(caller.userId) ?? ''
    expect(stored).not.toBe(weaker)
    expect(passwordNeedsRehash(stored)).toBe(false)
  })
})

describe('setPassword', () => {
  it('stores an Argon2id hash, never the password, right after a sign-in', async () => {
    const ctx = setup()
    const session = await signIn(ctx)

    const user = await ctx.service.setPassword(
      await callerOf(session.accessToken),
      { newPassword: PASSWORD },
      CLIENT
    )

    const stored = ctx.repo.state().passwords.get(user.id) ?? ''
    expect(user.hasPassword).toBe(true)
    expect(stored.startsWith('$argon2id$')).toBe(true)
    expect(stored).not.toContain(PASSWORD)
  })

  it.each([
    ['Ab1!', AuthErrorCode.PASSWORD_TOO_SHORT],
    [`Aa1!${'x'.repeat(125)}`, AuthErrorCode.PASSWORD_TOO_LONG],
    ['abcdefgh12!', AuthErrorCode.PASSWORD_TOO_WEAK],
    ['ABCDEFGH12!', AuthErrorCode.PASSWORD_TOO_WEAK],
    ['Abcdefgh!!', AuthErrorCode.PASSWORD_TOO_WEAK],
    ['Abcdefgh12', AuthErrorCode.PASSWORD_TOO_WEAK],
  ])('refuses %j with %s', async (newPassword, code) => {
    const ctx = setup()
    const session = await signIn(ctx)

    await expect(
      ctx.service.setPassword(await callerOf(session.accessToken), { newPassword }, CLIENT)
    ).rejects.toMatchObject({ status: 422, code })
  })

  it('counts length in code points, and takes spaces and Thai as "other" characters', async () => {
    const ctx = setup()
    const session = await signIn(ctx)
    const caller = await callerOf(session.accessToken)

    // 7 code points (the emoji is 2 UTF-16 units): too short.
    await expect(
      ctx.service.setPassword(caller, { newPassword: 'Ab1 😀xy' }, CLIENT)
    ).rejects.toMatchObject({ code: AuthErrorCode.PASSWORD_TOO_SHORT })
    await expect(
      ctx.service.setPassword(caller, { newPassword: 'Ab1 ทองคำ' }, CLIENT)
    ).resolves.toMatchObject({ hasPassword: true })
  })

  it('refuses the email or its local part, whatever the case', async () => {
    const ctx = setup()
    const session = await signIn(ctx, 'mom.2024@example.com')
    const caller = await callerOf(session.accessToken)

    for (const newPassword of ['Mom.2024', 'Mom.2024@Example.com']) {
      await expect(ctx.service.setPassword(caller, { newPassword }, CLIENT)).rejects.toMatchObject({
        status: 422,
        code: AuthErrorCode.PASSWORD_MATCHES_EMAIL,
      })
    }
  })

  it('refuses a breached password, and allows it when the check is unavailable', async () => {
    const breached = setup({ breachChecker: async (password) => password === PASSWORD })
    const down = setup({ breachChecker: async () => null })

    const one = await signIn(breached)
    const two = await signIn(down)

    await expect(
      breached.service.setPassword(
        await callerOf(one.accessToken),
        { newPassword: PASSWORD },
        CLIENT
      )
    ).rejects.toMatchObject({ status: 422, code: AuthErrorCode.PASSWORD_BREACHED })
    await expect(
      down.service.setPassword(await callerOf(two.accessToken), { newPassword: PASSWORD }, CLIENT)
    ).resolves.toMatchObject({ hasPassword: true })
  })

  it('judges the password before asking for proof', async () => {
    const ctx = setup()
    const session = await signIn(ctx)
    goStale(ctx)

    await expect(
      ctx.service.setPassword(await callerOf(session.accessToken), { newPassword: 'short' }, CLIENT)
    ).rejects.toMatchObject({ code: AuthErrorCode.PASSWORD_TOO_SHORT })
  })

  it('asks for recent auth once the last credential check is over 10 minutes old', async () => {
    const ctx = setup()
    const session = await signIn(ctx)
    const caller = await callerOf(session.accessToken)
    ctx.advance(AUTH_LIMITS.RECENT_AUTH_MS)

    await expect(
      ctx.service.setPassword(caller, { newPassword: PASSWORD }, CLIENT)
    ).resolves.toBeDefined()
    ctx.advance(1)
    await expect(
      ctx.service.setPassword(caller, { newPassword: OTHER_PASSWORD }, CLIENT)
    ).rejects.toMatchObject({ status: 403, code: AuthErrorCode.REAUTH_REQUIRED })
  })

  it('keeps the original sign-in time across refreshes', async () => {
    const ctx = setup()
    const session = await signIn(ctx)
    goStale(ctx)
    const refreshed = await ctx.service.refresh(session.refreshToken, CLIENT)

    await expect(
      ctx.service.setPassword(
        await callerOf(refreshed.accessToken),
        { newPassword: PASSWORD },
        CLIENT
      )
    ).rejects.toMatchObject({ code: AuthErrorCode.REAUTH_REQUIRED })
  })

  it('takes the current password as proof, and counts a wrong one as a failure', async () => {
    const ctx = setup()
    const { caller } = await withPassword(ctx)
    goStale(ctx)

    await expect(
      ctx.service.setPassword(
        caller,
        { newPassword: OTHER_PASSWORD, currentPassword: 'Wrong.pass1' },
        CLIENT
      )
    ).rejects.toMatchObject({ status: 400, code: AuthErrorCode.CURRENT_PASSWORD_INVALID })
    await expect(
      ctx.service.setPassword(
        caller,
        { newPassword: OTHER_PASSWORD, currentPassword: PASSWORD },
        CLIENT
      )
    ).resolves.toMatchObject({ hasPassword: true })
    await expect(
      ctx.service.signInWithPassword(EMAIL, OTHER_PASSWORD, CLIENT)
    ).resolves.toBeDefined()
    expect([...ctx.repo.state().buckets.keys()].some((key) => key.startsWith('pw:email:'))).toBe(
      true
    )
  })

  it('ignores a current password for a user who has none', async () => {
    const ctx = setup()
    const session = await signIn(ctx)
    goStale(ctx)

    await expect(
      ctx.service.setPassword(
        await callerOf(session.accessToken),
        { newPassword: PASSWORD, currentPassword: PASSWORD },
        CLIENT
      )
    ).rejects.toMatchObject({ code: AuthErrorCode.REAUTH_REQUIRED })
  })

  it('signs out every other session family of the user, and keeps this one', async () => {
    const ctx = setup()
    const other = await signIn(ctx)
    ctx.advance(AUTH_LIMITS.RESEND_COOLDOWN_MS)
    const current = await signIn(ctx)

    await ctx.service.setPassword(
      await callerOf(current.accessToken),
      { newPassword: PASSWORD },
      CLIENT
    )

    await expect(ctx.service.refresh(other.refreshToken, CLIENT)).rejects.toMatchObject({
      code: AuthErrorCode.SESSION_REVOKED,
    })
    await expect(ctx.service.refresh(current.refreshToken, CLIENT)).resolves.toBeDefined()
  })

  it('answers 401 when the access token outlives its revoked session', async () => {
    const ctx = setup()
    const session = await signIn(ctx)
    await ctx.service.signOut(session.refreshToken)

    await expect(
      ctx.service.setPassword(
        await callerOf(session.accessToken),
        { newPassword: PASSWORD },
        CLIENT
      )
    ).rejects.toMatchObject({ status: 401 })
  })

  it('never logs the password', async () => {
    const lines: unknown[] = []
    const info = vi.spyOn(logger, 'info').mockImplementation((...args: unknown[]) => {
      lines.push(args)
      return logger
    })
    const warn = vi.spyOn(logger, 'warn').mockImplementation((...args: unknown[]) => {
      lines.push(args)
      return logger
    })
    try {
      const ctx = setup()
      await withPassword(ctx)
      await ctx.service.signInWithPassword(EMAIL, 'Wrong.pass1', CLIENT).catch(() => undefined)
      await ctx.service.signInWithPassword(EMAIL, PASSWORD, CLIENT)

      const logged = JSON.stringify(lines)
      expect(logged).toContain('[Auth] Password set')
      expect(logged).not.toContain(PASSWORD)
      expect(logged).not.toContain('Wrong.pass1')
    } finally {
      info.mockRestore()
      warn.mockRestore()
    }
  })
})

describe('removePassword', () => {
  it('removes the password while the sign-in is recent, and keeps other sessions', async () => {
    const ctx = setup()
    const other = await signIn(ctx)
    ctx.advance(AUTH_LIMITS.RESEND_COOLDOWN_MS)
    const { caller } = await withPassword(ctx)

    // setPassword already signed `other` out; a fresh one checks that removing doesn't.
    ctx.advance(AUTH_LIMITS.RESEND_COOLDOWN_MS)
    const later = await signIn(ctx)
    const user = await ctx.service.removePassword(caller, undefined, CLIENT)

    expect(user.hasPassword).toBe(false)
    expect(ctx.repo.state().passwords.size).toBe(0)
    await expect(ctx.service.refresh(later.refreshToken, CLIENT)).resolves.toBeDefined()
    await expect(ctx.service.refresh(other.refreshToken, CLIENT)).rejects.toMatchObject({
      code: AuthErrorCode.SESSION_REVOKED,
    })
  })

  it('asks for recent auth, and accepts the current password', async () => {
    const ctx = setup()
    const { caller } = await withPassword(ctx)
    goStale(ctx)

    await expect(ctx.service.removePassword(caller, undefined, CLIENT)).rejects.toMatchObject({
      code: AuthErrorCode.REAUTH_REQUIRED,
    })
    await expect(ctx.service.removePassword(caller, PASSWORD, CLIENT)).resolves.toMatchObject({
      hasPassword: false,
    })
  })

  it('is a no-op without a password, even when the sign-in is not recent', async () => {
    const ctx = setup()
    const session = await signIn(ctx)
    goStale(ctx)

    await expect(
      ctx.service.removePassword(await callerOf(session.accessToken), undefined, CLIENT)
    ).resolves.toMatchObject({ hasPassword: false })
  })
})

describe('startReauth / verifyReauth', () => {
  it.each<[MailLanguage, string]>([
    ['th', 'คือรหัสยืนยันตัวตน'],
    ['en', 'is your Tang Pai Nai confirmation code'],
  ])('mails a code, and no link, to the user’s own email (%s)', async (lang, subject) => {
    const ctx = setup()
    const session = await signIn(ctx)
    ctx.advance(AUTH_LIMITS.RESEND_COOLDOWN_MS)

    await ctx.service.startReauth(await callerOf(session.accessToken), lang, CLIENT)

    const mail = ctx.lastMail()
    expect(mail.to).toBe(EMAIL)
    expect(mail.subject).toContain(subject)
    expect(mail.code).toMatch(/^\d{6}$/)
    expect(mail.text).not.toContain('http')
  })

  it('makes the session recent again, without creating a session', async () => {
    const ctx = setup()
    const session = await signIn(ctx)
    const caller = await callerOf(session.accessToken)
    goStale(ctx)
    await ctx.service.startReauth(caller, 'th', CLIENT)
    const sessions = ctx.repo.state().sessions.length

    await ctx.service.verifyReauth(caller, ctx.lastMail().code, CLIENT)

    expect(ctx.repo.state().sessions).toHaveLength(sessions)
    await expect(
      ctx.service.setPassword(caller, { newPassword: PASSWORD }, CLIENT)
    ).resolves.toMatchObject({ hasPassword: true })
  })

  it('refuses a wrong, reused or someone else’s code', async () => {
    const ctx = setup()
    const mine = await callerOf((await signIn(ctx)).accessToken)
    const theirs = await callerOf((await signIn(ctx, 'dad@example.com')).accessToken)
    goStale(ctx)
    await ctx.service.startReauth(mine, 'th', CLIENT)
    const { code } = ctx.lastMail()

    await expect(ctx.service.verifyReauth(mine, wrongCode(code), CLIENT)).rejects.toMatchObject({
      status: 400,
      code: AuthErrorCode.OTP_INVALID,
    })
    await expect(ctx.service.verifyReauth(theirs, code, CLIENT)).rejects.toMatchObject({
      code: AuthErrorCode.OTP_EXPIRED,
    })
    await ctx.service.verifyReauth(mine, code, CLIENT)
    await expect(ctx.service.verifyReauth(mine, code, CLIENT)).rejects.toMatchObject({
      code: AuthErrorCode.OTP_EXPIRED,
    })
  })

  it('locks the code after 5 wrong attempts', async () => {
    const ctx = setup()
    const caller = await callerOf((await signIn(ctx)).accessToken)
    ctx.advance(AUTH_LIMITS.RESEND_COOLDOWN_MS)
    await ctx.service.startReauth(caller, 'th', CLIENT)
    const { code } = ctx.lastMail()
    for (let i = 0; i < 5; i += 1) {
      await ctx.service.verifyReauth(caller, wrongCode(code), CLIENT).catch(() => undefined)
    }

    await expect(ctx.service.verifyReauth(caller, code, CLIENT)).rejects.toMatchObject({
      code: AuthErrorCode.OTP_LOCKED,
    })
  })

  it('cannot be used to sign in, and a sign-in code cannot confirm', async () => {
    const ctx = setup()
    const caller = await callerOf((await signIn(ctx)).accessToken)
    ctx.advance(AUTH_LIMITS.RESEND_COOLDOWN_MS)
    await ctx.service.startReauth(caller, 'th', CLIENT)

    await expect(
      ctx.service.verifyEmailSignIn({ email: EMAIL, code: ctx.lastMail().code }, CLIENT)
    ).rejects.toMatchObject({ code: AuthErrorCode.OTP_EXPIRED })

    ctx.advance(AUTH_LIMITS.RESEND_COOLDOWN_MS)
    await ctx.service.startEmailSignIn(EMAIL, 'th', CLIENT)
    // Checked against the open step-up challenge, so it's just a wrong code there.
    await expect(
      ctx.service.verifyReauth(caller, ctx.lastMail().code, CLIENT)
    ).rejects.toMatchObject({ status: 400, code: AuthErrorCode.OTP_INVALID })
  })

  it('shares the 60 s cooldown with the sign-in email', async () => {
    const ctx = setup()
    const caller = await callerOf((await signIn(ctx)).accessToken)

    await expect(ctx.service.startReauth(caller, 'th', CLIENT)).rejects.toMatchObject({
      status: 429,
      code: AuthErrorCode.RATE_LIMITED,
    })
  })
})

describe('hasPassword in responses', () => {
  it('follows the password through getMe and refresh', async () => {
    const ctx = setup()
    const { session, caller } = await withPassword(ctx)

    await expect(ctx.service.getMe(caller.userId)).resolves.toMatchObject({ hasPassword: true })
    const refreshed = await ctx.service.refresh(session.refreshToken, CLIENT)
    expect(refreshed.user.hasPassword).toBe(true)
    await ctx.service.removePassword(caller, undefined, CLIENT)
    await expect(ctx.service.getMe(caller.userId)).resolves.toMatchObject({ hasPassword: false })
  })
})
