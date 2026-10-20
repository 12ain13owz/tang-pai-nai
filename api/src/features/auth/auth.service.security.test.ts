import { describe, expect, it, vi } from 'vitest'
import { logger } from '@/core/logger'
import type { Notification } from '@/core/notification'
import {
  createAccessTokens,
  createSealedBox,
  OidcError,
  pkceChallenge,
  randomToken,
  skipBreachCheck,
} from '@/core/security'
import type { AuthorizationRequest, OidcIdentity } from '@/core/security'
import { LOG } from '@/shared/constants'
import { NotificationChannel } from '@/shared/types'
import { AUTH_LIMITS, AuthErrorCode } from './auth.const'
import { buildCredentialChangeMail } from './auth.mail'
import { createMemoryAuthRepository } from './auth.repository.memory'
import { createAuthService } from './auth.service'
import type { Caller, GoogleCallback, MailLanguage } from './auth.entity'
import type { GoogleSignIn } from './auth.service'

// Account › Security (auth spec rules 28–31, part 4.4a): the session list, linking and unlinking
// Google while signed in, and the mail on every credential change.

const START = new Date('2026-10-19T00:00:00.000Z')
const MINUTE = 60_000
const EMAIL = 'mom@example.com'
const CLIENT = { ip: '10.0.0.1', userAgent: 'vitest' }
const PASSWORD = 'Gr33n Mango Tree'

const accessTokens = createAccessTokens({
  secret: 'service-test-secret-service-test-secret',
  issuer: 'test-api',
  audience: 'test-web',
  ttlSeconds: 600,
})

const account = (overrides: Partial<OidcIdentity> = {}): OidcIdentity => ({
  subject: 'google-sub-mom',
  email: 'Mom.Personal@Gmail.com',
  emailVerified: true,
  name: 'Mom',
  picture: 'https://lh3.googleusercontent.com/a/mom',
  ...overrides,
})

/** A fake Google that checks PKCE and the nonce like the real exchange + ID token would. */
const fakeGoogle = () => {
  let request: AuthorizationRequest | null = null
  const accounts = new Map<string, OidcIdentity>()
  const oidc: GoogleSignIn['oidc'] = {
    authorizationUrl: vi.fn(async (req: AuthorizationRequest) => {
      request = req
      return `https://google.test/authorize?state=${req.state}`
    }),
    exchangeCode: vi.fn(async (code: string, verifier: string) => {
      if (pkceChallenge(verifier) !== request?.codeChallenge || !accounts.has(code)) {
        throw new OidcError('token endpoint answered 400')
      }
      return code
    }),
    verifyIdToken: vi.fn(async (idToken: string, nonce: string) => {
      const identity = accounts.get(idToken)
      if (!identity || nonce !== request?.nonce) {
        throw new OidcError('id token rejected')
      }
      return identity
    }),
  }
  const approve = (identity: OidcIdentity): GoogleCallback => {
    const code = randomToken()
    accounts.set(code, identity)
    return { code, state: request?.state }
  }
  return { oidc, approve }
}

const setup = ({ emailDailyLimit = 100 } = {}) => {
  const repo = createMemoryAuthRepository()
  const google = fakeGoogle()
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
    google: {
      oidc: google.oidc,
      flowBox: createSealedBox('service-test-secret-service-test-secret', 'google-oidc-flow'),
    },
    config: {
      webOrigin: 'http://web.test',
      signupEnabled: true,
      emailDailyLimit,
      phoneEnabled: true,
      smsDailyLimit: 100,
      startMinDurationMs: 0,
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
  const lastCode = () => /^ {4}(\d{6})$/m.exec(mails().at(-1)?.text ?? '')?.[1] ?? ''
  return { service, repo, google, clock, advance, send, mails, lastCode }
}
type Ctx = ReturnType<typeof setup>

const callerOf = async (accessToken: string): Promise<Caller> => {
  const claims = await accessTokens.verify(accessToken)
  if (!claims) {
    throw new Error('invalid access token')
  }
  return { userId: claims.sub, sessionFamilyId: claims.sid }
}

/** Signs in with an email code (a new session family) from `userAgent`. */
const signIn = async (ctx: Ctx, email = EMAIL, userAgent = 'vitest') => {
  // Each sign-in is its own minute, so the resend cooldown never gets in the way.
  ctx.advance(MINUTE)
  const client = { ...CLIENT, userAgent }
  await ctx.service.startEmailSignIn(email, 'th', client)
  const session = await ctx.service.verifyEmailSignIn({ email, code: ctx.lastCode() }, client)
  return { session, caller: await callerOf(session.accessToken) }
}

const goStale = (ctx: Ctx) => ctx.advance(AUTH_LIMITS.RECENT_AUTH_MS + 1)

/** Start linking → pick `identity` at Google → callback. */
const link = async (ctx: Ctx, caller: Caller, identity = account(), lang: MailLanguage = 'th') => {
  const { flowToken } = await ctx.service.startGoogleLink(caller, undefined, lang, CLIENT)
  return ctx.service.finishGoogleLink(ctx.google.approve(identity), flowToken, CLIENT)
}

describe('listSessions', () => {
  it('lists one entry per active family, the last used first, and flags the caller', async () => {
    const ctx = setup()
    const phone = await signIn(ctx, EMAIL, 'phone-agent')
    const laptop = await signIn(ctx, EMAIL, 'laptop-agent')
    await signIn(ctx, 'dad@example.com')
    ctx.advance(MINUTE)
    // A refresh keeps the family (and its sign-in time) but marks it as just used.
    await ctx.service.refresh(phone.session.refreshToken, { ...CLIENT, userAgent: 'phone-2' })

    const list = await ctx.service.listSessions(laptop.caller)

    expect(list).toEqual([
      {
        familyId: phone.caller.sessionFamilyId,
        userAgent: 'phone-2',
        signedInAt: new Date(START.getTime() + MINUTE),
        lastUsedAt: ctx.clock.now,
        current: false,
      },
      {
        familyId: laptop.caller.sessionFamilyId,
        userAgent: 'laptop-agent',
        signedInAt: new Date(START.getTime() + 2 * MINUTE),
        lastUsedAt: new Date(START.getTime() + 2 * MINUTE),
        current: true,
      },
    ])
  })

  it('leaves out revoked and expired families', async () => {
    const ctx = setup()
    const signedOut = await signIn(ctx)
    await ctx.service.signOut(signedOut.session.refreshToken)
    const current = await signIn(ctx)

    const list = await ctx.service.listSessions(current.caller)
    expect(list.map((entry) => entry.familyId)).toEqual([current.caller.sessionFamilyId])

    ctx.advance(AUTH_LIMITS.SESSION_IDLE_MS)
    await expect(ctx.service.listSessions(current.caller)).rejects.toMatchObject({ status: 401 })
  })

  it('refuses a caller whose session was revoked (its access token still verifies)', async () => {
    const ctx = setup()
    const { session, caller } = await signIn(ctx)
    await ctx.service.signOut(session.refreshToken)

    await expect(ctx.service.listSessions(caller)).rejects.toMatchObject({ status: 401 })
  })
})

describe('revokeSession', () => {
  it('signs another device out without any recent auth', async () => {
    const ctx = setup()
    const other = await signIn(ctx, EMAIL, 'other')
    const current = await signIn(ctx)
    goStale(ctx)

    await ctx.service.revokeSession(current.caller, other.caller.sessionFamilyId)

    await expect(ctx.service.refresh(other.session.refreshToken, CLIENT)).rejects.toMatchObject({
      code: AuthErrorCode.SESSION_REVOKED,
    })
    const list = await ctx.service.listSessions(current.caller)
    expect(list.map((entry) => entry.familyId)).toEqual([current.caller.sessionFamilyId])
  })

  it('refuses the caller’s own session: that is a sign-out', async () => {
    const ctx = setup()
    const { caller } = await signIn(ctx)

    await expect(ctx.service.revokeSession(caller, caller.sessionFamilyId)).rejects.toMatchObject({
      status: 400,
      code: AuthErrorCode.CURRENT_SESSION,
    })
  })

  it('answers 404 for someone else’s, unknown or already ended sessions', async () => {
    const ctx = setup()
    const dad = await signIn(ctx, 'dad@example.com')
    const ended = await signIn(ctx)
    await ctx.service.signOut(ended.session.refreshToken)
    const { caller } = await signIn(ctx)

    for (const familyId of [
      dad.caller.sessionFamilyId,
      ended.caller.sessionFamilyId,
      '01900000-0000-7000-8000-00000000dead',
    ]) {
      await expect(ctx.service.revokeSession(caller, familyId)).rejects.toMatchObject({
        status: 404,
      })
    }
    // Dad is still signed in.
    await expect(ctx.service.refresh(dad.session.refreshToken, CLIENT)).resolves.toBeDefined()
  })
})

describe('revokeOtherSessions', () => {
  it('signs out every other device of the user, keeps this one and counts them', async () => {
    const ctx = setup()
    const one = await signIn(ctx)
    const two = await signIn(ctx)
    const dad = await signIn(ctx, 'dad@example.com')
    const current = await signIn(ctx)

    expect(await ctx.service.revokeOtherSessions(current.caller)).toBe(2)
    expect(await ctx.service.revokeOtherSessions(current.caller)).toBe(0)

    for (const other of [one, two]) {
      await expect(ctx.service.refresh(other.session.refreshToken, CLIENT)).rejects.toMatchObject({
        code: AuthErrorCode.SESSION_REVOKED,
      })
    }
    await expect(ctx.service.refresh(dad.session.refreshToken, CLIENT)).resolves.toBeDefined()
    await expect(ctx.service.refresh(current.session.refreshToken, CLIENT)).resolves.toBeDefined()
  })
})

describe('linking Google while signed in', () => {
  it('links the Google account to the caller without a new session, and mails the change', async () => {
    const ctx = setup()
    const { caller } = await signIn(ctx)
    const sessionsBefore = ctx.repo.state().sessions.length

    const result = await link(ctx, caller, account(), 'en')

    expect(result).toEqual({ returnUrl: '/account/security' })
    expect(ctx.repo.state().sessions).toHaveLength(sessionsBefore)
    const me = await ctx.service.getMe(caller.userId)
    // The Google email need not match the account's.
    expect(me.email).toBe(EMAIL)
    expect(me.identities).toEqual([
      { provider: 'google', email: 'mom.personal@gmail.com', linkedAt: expect.any(Date) as Date },
    ])
    // An empty avatar is filled, as with an automatic link.
    expect(me.avatarUrl).toBe('https://lh3.googleusercontent.com/a/mom')
    expect(ctx.mails().at(-1)).toMatchObject({
      to: EMAIL,
      subject: 'A Google account was linked on your Tang Pai Nai account',
    })
  })

  it('does not need email_verified: the user just proved both accounts', async () => {
    const ctx = setup()
    const { caller } = await signIn(ctx)

    await link(ctx, caller, account({ emailVerified: false }))

    expect((await ctx.service.getMe(caller.userId)).identities).toHaveLength(1)
  })

  it('needs recent auth, by time or the current password', async () => {
    const ctx = setup()
    const { caller } = await signIn(ctx)
    await ctx.service.setPassword(caller, { newPassword: PASSWORD }, CLIENT)
    goStale(ctx)

    await expect(
      ctx.service.startGoogleLink(caller, undefined, 'th', CLIENT)
    ).rejects.toMatchObject({ status: 403, code: AuthErrorCode.REAUTH_REQUIRED })
    await expect(
      ctx.service.startGoogleLink(caller, 'Wrong.pass1', 'th', CLIENT)
    ).rejects.toMatchObject({ code: AuthErrorCode.CURRENT_PASSWORD_INVALID })
    const { flowToken } = await ctx.service.startGoogleLink(caller, PASSWORD, 'th', CLIENT)

    expect(await ctx.service.googleFlowMode(flowToken)).toBe('link')
  })

  it('allows one Google account per user: unlink first', async () => {
    const ctx = setup()
    const { caller } = await signIn(ctx)
    await link(ctx, caller)

    await expect(
      ctx.service.startGoogleLink(caller, undefined, 'th', CLIENT)
    ).rejects.toMatchObject({ status: 409, code: AuthErrorCode.IDENTITY_ALREADY_LINKED })
  })

  it('never takes a Google account from another user (no merging)', async () => {
    const ctx = setup()
    const dad = await signIn(ctx, 'dad@example.com')
    await link(ctx, dad.caller)
    const mom = await signIn(ctx)
    const mailsBefore = ctx.mails().length

    await expect(link(ctx, mom.caller)).rejects.toMatchObject({
      status: 409,
      code: AuthErrorCode.GOOGLE_IN_USE,
    })
    expect((await ctx.service.getMe(mom.caller.userId)).identities).toEqual([])
    expect((await ctx.service.getMe(dad.caller.userId)).identities).toHaveLength(1)
    expect(ctx.mails()).toHaveLength(mailsBefore)
  })

  it('fails when the session ended or the user was disabled during the round trip', async () => {
    const ctx = setup()
    const { session, caller } = await signIn(ctx)
    const ended = await ctx.service.startGoogleLink(caller, undefined, 'th', CLIENT)
    await ctx.service.signOut(session.refreshToken)
    await expect(
      ctx.service.finishGoogleLink(ctx.google.approve(account()), ended.flowToken, CLIENT)
    ).rejects.toMatchObject({ code: AuthErrorCode.GOOGLE_FAILED })

    const other = await signIn(ctx)
    const pending = await ctx.service.startGoogleLink(other.caller, undefined, 'th', CLIENT)
    const user = ctx.repo.state().users.find((candidate) => candidate.id === other.caller.userId)
    if (user) {
      user.status = 'disabled'
    }
    await expect(
      ctx.service.finishGoogleLink(ctx.google.approve(account()), pending.flowToken, CLIENT)
    ).rejects.toMatchObject({ code: AuthErrorCode.USER_DISABLED })
    expect(ctx.repo.state().identities).toEqual([])
  })

  it('keeps the two kinds of round trip apart', async () => {
    const ctx = setup()
    const { caller } = await signIn(ctx)
    const signInFlow = await ctx.service.startGoogleSignIn('/')
    expect(await ctx.service.googleFlowMode(signInFlow.flowToken)).toBe('signIn')
    await expect(
      ctx.service.finishGoogleLink(ctx.google.approve(account()), signInFlow.flowToken, CLIENT)
    ).rejects.toMatchObject({ code: AuthErrorCode.GOOGLE_FAILED })

    const linkFlow = await ctx.service.startGoogleLink(caller, undefined, 'th', CLIENT)
    await expect(
      ctx.service.finishGoogleSignIn(ctx.google.approve(account()), linkFlow.flowToken, CLIENT)
    ).rejects.toMatchObject({ code: AuthErrorCode.GOOGLE_FAILED })
    expect(await ctx.service.googleFlowMode(undefined)).toBe('signIn')
  })

  it('reports a cancel at Google as such', async () => {
    const ctx = setup()
    const { caller } = await signIn(ctx)
    const { flowToken } = await ctx.service.startGoogleLink(caller, undefined, 'th', CLIENT)

    await expect(
      ctx.service.finishGoogleLink({ error: 'access_denied' }, flowToken, CLIENT)
    ).rejects.toMatchObject({ code: AuthErrorCode.GOOGLE_CANCELLED })
  })
})

describe('unlinkGoogle', () => {
  it('needs recent auth, removes the identity and mails the change', async () => {
    const ctx = setup()
    const { caller } = await signIn(ctx)
    await link(ctx, caller)
    goStale(ctx)

    await expect(ctx.service.unlinkGoogle(caller, undefined, 'th', CLIENT)).rejects.toMatchObject({
      code: AuthErrorCode.REAUTH_REQUIRED,
    })

    await ctx.service.startReauth(caller, 'th', CLIENT)
    await ctx.service.verifyReauth(caller, ctx.lastCode(), CLIENT)
    const user = await ctx.service.unlinkGoogle(caller, undefined, 'th', CLIENT)

    expect(user.identities).toEqual([])
    expect(ctx.mails().at(-1)?.subject).toBe('มีการยกเลิกการเชื่อม Google ในบัญชีผู้ใช้ ตังค์ไปไหน')
  })

  it('is a no-op without a Google identity: no proof asked, no mail', async () => {
    const ctx = setup()
    const { caller } = await signIn(ctx)
    goStale(ctx)
    const mailsBefore = ctx.mails().length

    const user = await ctx.service.unlinkGoogle(caller, undefined, 'th', CLIENT)

    expect(user.identities).toEqual([])
    expect(ctx.mails()).toHaveLength(mailsBefore)
  })
})

describe('mail on credential change (rule 31)', () => {
  it('mails a password set, change and removal in the request’s language', async () => {
    const ctx = setup()
    const { caller } = await signIn(ctx)

    await ctx.service.setPassword(caller, { newPassword: PASSWORD, lang: 'en' }, CLIENT)
    await ctx.service.setPassword(caller, { newPassword: 'Blue.Sky.2026' }, CLIENT)
    await ctx.service.removePassword(caller, undefined, CLIENT, 'en')

    expect(
      ctx
        .mails()
        .slice(-3)
        .map((mail) => mail.subject)
    ).toEqual([
      'A password was set on your Tang Pai Nai account',
      'มีการเปลี่ยนรหัสผ่าน ในบัญชีผู้ใช้ ตังค์ไปไหน',
      'Your password was removed on your Tang Pai Nai account',
    ])
  })

  it('mails an automatic link at Google sign-in in the language of the start', async () => {
    const ctx = setup()
    await signIn(ctx)
    const { flowToken } = await ctx.service.startGoogleSignIn('/', 'en')

    const result = await ctx.service.finishGoogleSignIn(
      ctx.google.approve(account({ email: EMAIL })),
      flowToken,
      CLIENT
    )

    expect(result.linked).toBe(true)
    expect(ctx.mails().at(-1)?.subject).toBe(
      'A Google account was linked on your Tang Pai Nai account'
    )
  })

  it('skips the mail at the daily cap, and the change still goes through', async () => {
    const ctx = setup({ emailDailyLimit: 1 })
    const warn = vi.spyOn(logger, 'warn')
    const { caller } = await signIn(ctx)

    const user = await ctx.service.setPassword(caller, { newPassword: PASSWORD }, CLIENT)

    expect(user.hasPassword).toBe(true)
    expect(ctx.mails()).toHaveLength(1)
    expect(warn).toHaveBeenCalledWith(
      LOG.AUTH.credentialMailSkipped('daily cap'),
      expect.objectContaining({ change: 'password_set' })
    )
  })

  it('skips the mail when sending fails, and the change still goes through', async () => {
    const ctx = setup()
    const warn = vi.spyOn(logger, 'warn')
    const { caller } = await signIn(ctx)
    ctx.send.mockRejectedValueOnce(new Error('smtp down'))

    const user = await ctx.service.setPassword(caller, { newPassword: PASSWORD }, CLIENT)

    expect(user.hasPassword).toBe(true)
    expect(warn).toHaveBeenCalledWith(
      LOG.AUTH.credentialMailSkipped('send failed'),
      expect.objectContaining({ change: 'password_set', detail: 'smtp down' })
    )
  })
})

describe('buildCredentialChangeMail', () => {
  it('says what changed and when, in the user’s timezone, Thai with the Buddhist year', () => {
    const at = new Date('2026-10-20T05:17:00.000Z')
    const th = buildCredentialChangeMail({
      change: 'google_unlinked',
      lang: 'th',
      at,
      timeZone: 'Asia/Bangkok',
    })
    const en = buildCredentialChangeMail({
      change: 'password_changed',
      lang: 'en',
      at,
      timeZone: 'Asia/Bangkok',
    })

    expect(th.text).toContain('20 ตุลาคม 2569 เวลา 12:17')
    expect(en.text).toContain('on 20 October 2026 at 12:17')
    expect(en.subject).toBe('Your password was changed on your Tang Pai Nai account')
  })

  it('carries no link and no code', () => {
    for (const lang of ['th', 'en'] as const) {
      const mail = buildCredentialChangeMail({
        change: 'password_set',
        lang,
        at: START,
        timeZone: 'Asia/Bangkok',
      })
      expect(mail.text).not.toMatch(/https?:|\d{6}/)
    }
  })
})
