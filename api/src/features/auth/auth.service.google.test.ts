import { describe, expect, it, vi } from 'vitest'
import { logger } from '@/core/logger'
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
import { AUTH_LIMITS, AuthErrorCode } from './auth.const'
import { createMemoryAuthRepository } from './auth.repository.memory'
import { createAuthService } from './auth.service'
import type { GoogleCallback, User } from './auth.entity'
import type { MemoryAuthState } from './auth.repository.memory'
import type { AuthServiceConfig, GoogleSignIn } from './auth.service'

// Google sign-in (auth spec rule 14) against a fake provider. The provider itself (discovery,
// JWKS, token checks) is covered by core/security/oidc-client.test.ts.

const START = new Date('2026-10-19T00:00:00.000Z')
const CLIENT = { ip: '10.0.0.1', userAgent: 'vitest' }

const accessTokens = createAccessTokens({
  secret: 'service-test-secret-service-test-secret',
  issuer: 'test-api',
  audience: 'test-web',
  ttlSeconds: 600,
})

const account = (overrides: Partial<OidcIdentity> = {}): OidcIdentity => ({
  subject: 'google-sub-1',
  email: 'Somchai@Gmail.com',
  emailVerified: true,
  name: 'Somchai Jaidee',
  picture: 'https://lh3.googleusercontent.com/a/somchai',
  ...overrides,
})

const existingUser = (overrides: Partial<User> = {}): User => ({
  id: '01900000-0000-7000-8000-000000000001',
  email: 'somchai@gmail.com',
  displayName: 'somchai',
  avatarUrl: null,
  emailVerifiedAt: START,
  phone: null,
  phoneVerifiedAt: null,
  status: 'active',
  timezone: 'Asia/Bangkok',
  createdAt: START,
  updatedAt: START,
  ...overrides,
})

/**
 * Stands in for Google: remembers the authorization request, hands out a code for the account
 * the user "picks", and checks PKCE and the nonce the way the real exchange + ID token would.
 */
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
  /** The user picks `identity` at Google: the query Google sends back. */
  const approve = (identity: OidcIdentity): GoogleCallback => {
    const code = randomToken()
    accounts.set(code, identity)
    return { code, state: request?.state }
  }
  return { oidc, approve, request: () => request }
}

interface SetupOptions {
  seed?: Partial<MemoryAuthState>
  config?: Partial<AuthServiceConfig>
  google?: boolean
}

const setup = ({ seed, config, google = true }: SetupOptions = {}) => {
  const repo = createMemoryAuthRepository(seed)
  const provider = fakeGoogle()
  const flowBox = createSealedBox('service-test-secret-service-test-secret', 'google-oidc-flow')
  const service = createAuthService({
    authRepo: repo,
    notifier: { send: vi.fn() },
    accessTokens,
    breachChecker: skipBreachCheck,
    google: google ? { oidc: provider.oidc, flowBox } : null,
    config: {
      webOrigin: 'http://web.test',
      signupEnabled: true,
      emailDailyLimit: 100,
      phoneEnabled: true,
      smsDailyLimit: 100,
      startMinDurationMs: 0,
      ...config,
    },
    now: () => START,
  })
  /** Start → pick `identity` at Google → callback, the way the browser goes through it. */
  const signInWithGoogle = async (identity = account(), returnUrl = '/wallets') => {
    const { flowToken } = await service.startGoogleSignIn(returnUrl)
    return service.finishGoogleSignIn(provider.approve(identity), flowToken, CLIENT)
  }
  return { service, repo, provider, flowBox, signInWithGoogle }
}

describe('Google sign-in switched off', () => {
  it('is not found, and says so to the providers check', async () => {
    const ctx = setup({ google: false })

    expect(ctx.service.googleEnabled).toBe(false)
    await expect(ctx.service.startGoogleSignIn('/')).rejects.toMatchObject({ status: 404 })
    await expect(
      ctx.service.finishGoogleSignIn({ code: 'c', state: 's' }, 'flow', CLIENT)
    ).rejects.toMatchObject({ status: 404 })
  })
})

describe('startGoogleSignIn', () => {
  it('sends a PKCE S256 challenge and seals state, nonce and verifier into the flow cookie', async () => {
    const ctx = setup()

    const { authorizationUrl, flowToken } = await ctx.service.startGoogleSignIn('/reports')

    const request = ctx.provider.request()
    const flow = await ctx.flowBox.open(flowToken)
    expect(authorizationUrl).toContain('https://google.test/authorize')
    expect(flow).toMatchObject({
      state: request?.state,
      nonce: request?.nonce,
      returnUrl: '/reports',
    })
    expect(request?.codeChallenge).toBe(pkceChallenge(String(flow?.verifier)))
    // The verifier itself never leaves in the URL.
    expect(authorizationUrl).not.toContain(String(flow?.verifier))
    expect(flowToken).not.toContain(String(flow?.verifier))
  })

  it.each(['//evil.example', 'https://evil.example/x', '/\\evil.example', 'wallets', ''])(
    'only keeps an in-app return path (%s → /)',
    async (returnUrl) => {
      const ctx = setup()
      const { flowToken } = await ctx.service.startGoogleSignIn(returnUrl)

      await expect(ctx.flowBox.open(flowToken)).resolves.toMatchObject({ returnUrl: '/' })
    }
  )

  it('makes fresh state, nonce and verifier every time', async () => {
    const ctx = setup()
    const first = await ctx.flowBox.open((await ctx.service.startGoogleSignIn('/')).flowToken)
    const second = await ctx.flowBox.open((await ctx.service.startGoogleSignIn('/')).flowToken)

    expect(second?.state).not.toBe(first?.state)
    expect(second?.nonce).not.toBe(first?.nonce)
    expect(second?.verifier).not.toBe(first?.verifier)
  })
})

describe('finishGoogleSignIn: who signs in', () => {
  it('creates a verified user from a new Google account, with its name and picture', async () => {
    const ctx = setup()

    const result = await ctx.signInWithGoogle()

    expect(result).toMatchObject({ returnUrl: '/wallets', linked: false, expiresIn: 600 })
    expect(result.user).toMatchObject({
      email: 'somchai@gmail.com',
      displayName: 'Somchai Jaidee',
      avatarUrl: 'https://lh3.googleusercontent.com/a/somchai',
      emailVerifiedAt: START,
      hasPassword: false,
      identities: [{ provider: 'google', email: 'somchai@gmail.com' }],
    })
    expect(result.refreshToken).toHaveLength(43)
    const [session] = ctx.repo.state().sessions
    expect(session).toMatchObject({ userId: result.user.id, authTime: START })
  })

  it('falls back to the email’s local part for the name and drops a non-https picture', async () => {
    const ctx = setup()

    const result = await ctx.signInWithGoogle(
      account({ name: null, picture: 'http://example.com/me.png' })
    )

    expect(result.user).toMatchObject({ displayName: 'somchai', avatarUrl: null })
  })

  it('cuts a very long Google name to the display-name limit', async () => {
    const ctx = setup()

    const result = await ctx.signInWithGoogle(account({ name: 'ก'.repeat(150) }))

    expect([...result.user.displayName]).toHaveLength(AUTH_LIMITS.DISPLAY_NAME_MAX)
  })

  it('finds the same user by sub next time, and never overwrites the name or picture', async () => {
    const ctx = setup()
    const first = await ctx.signInWithGoogle()

    const second = await ctx.signInWithGoogle(
      account({ name: 'New Name', picture: 'https://lh3.googleusercontent.com/a/new' })
    )

    expect(second.user.id).toBe(first.user.id)
    expect(second.linked).toBe(false)
    expect(second.user).toMatchObject({
      displayName: 'Somchai Jaidee',
      avatarUrl: 'https://lh3.googleusercontent.com/a/somchai',
    })
    expect(ctx.repo.state().users).toHaveLength(1)
    expect(ctx.repo.state().identities).toHaveLength(1)
  })

  it('matches on sub, not email: a changed Google email still reaches the same user', async () => {
    const ctx = setup()
    const first = await ctx.signInWithGoogle()

    const second = await ctx.signInWithGoogle(account({ email: 'renamed@gmail.com' }))

    expect(second.user.id).toBe(first.user.id)
    expect(second.user.email).toBe('somchai@gmail.com')
  })

  it('links a new Google account to the user with that verified email', async () => {
    const info = vi.spyOn(logger, 'info')
    const ctx = setup({ seed: { users: [existingUser()] } })

    const result = await ctx.signInWithGoogle()

    expect(result.linked).toBe(true)
    expect(result.user).toMatchObject({
      id: existingUser().id,
      displayName: 'somchai',
      avatarUrl: 'https://lh3.googleusercontent.com/a/somchai',
      identities: [{ provider: 'google', email: 'somchai@gmail.com' }],
    })
    expect(ctx.repo.state().users).toHaveLength(1)
    expect(info).toHaveBeenCalledWith(LOG.AUTH.identityLinked('google'), {
      userId: existingUser().id,
    })
    info.mockRestore()
  })

  it('keeps an avatar the user already has when linking', async () => {
    const ctx = setup({ seed: { users: [existingUser({ avatarUrl: 'https://me.test/a.png' })] } })

    const result = await ctx.signInWithGoogle()

    expect(result.user.avatarUrl).toBe('https://me.test/a.png')
  })

  it('refuses an unverified email when there is no identity yet, and links nothing', async () => {
    const ctx = setup({ seed: { users: [existingUser()] } })

    await expect(ctx.signInWithGoogle(account({ emailVerified: false }))).rejects.toMatchObject({
      code: AuthErrorCode.EMAIL_UNVERIFIED,
    })
    await expect(ctx.signInWithGoogle(account({ email: null }))).rejects.toMatchObject({
      code: AuthErrorCode.EMAIL_UNVERIFIED,
    })
    expect(ctx.repo.state().identities).toHaveLength(0)
    expect(ctx.repo.state().sessions).toHaveLength(0)
  })

  it('lets an identity that already exists in even if Google no longer vouches for the email', async () => {
    const ctx = setup()
    const first = await ctx.signInWithGoogle()

    const second = await ctx.signInWithGoogle(account({ emailVerified: false }))

    expect(second.user.id).toBe(first.user.id)
  })

  it('refuses a new account while sign-up is closed, but still signs in and links existing users', async () => {
    const ctx = setup({ config: { signupEnabled: false }, seed: { users: [existingUser()] } })

    await expect(
      ctx.signInWithGoogle(account({ subject: 'stranger', email: 'stranger@gmail.com' }))
    ).rejects.toMatchObject({ status: 403, code: AuthErrorCode.SIGNUP_CLOSED })
    const linked = await ctx.signInWithGoogle()

    expect(linked).toMatchObject({ linked: true, user: { id: existingUser().id } })
    expect(ctx.repo.state().users).toHaveLength(1)
  })

  it('refuses a disabled user after the Google checks, with no session', async () => {
    const ctx = setup({ seed: { users: [existingUser({ status: 'disabled' })] } })

    await expect(ctx.signInWithGoogle()).rejects.toMatchObject({
      status: 403,
      code: AuthErrorCode.USER_DISABLED,
    })
    expect(ctx.repo.state().sessions).toHaveLength(0)
  })
})

describe('finishGoogleSignIn: the round trip', () => {
  it('calls a refusal at Google a cancel, and any other provider error a failure', async () => {
    const ctx = setup()
    const { flowToken } = await ctx.service.startGoogleSignIn('/')

    await expect(
      ctx.service.finishGoogleSignIn({ error: 'access_denied' }, flowToken, CLIENT)
    ).rejects.toMatchObject({ code: AuthErrorCode.GOOGLE_CANCELLED })
    await expect(
      ctx.service.finishGoogleSignIn({ error: 'server_error' }, flowToken, CLIENT)
    ).rejects.toMatchObject({ code: AuthErrorCode.GOOGLE_FAILED })
  })

  it('fails without the flow cookie, or with one that was changed or sealed for something else', async () => {
    const ctx = setup()
    const { flowToken } = await ctx.service.startGoogleSignIn('/')
    const callback = ctx.provider.approve(account())
    const otherBox = createSealedBox('service-test-secret-service-test-secret', 'other-purpose')
    const foreign = await otherBox.seal((await ctx.flowBox.open(flowToken)) ?? {}, 600)
    const tampered = `${flowToken.slice(0, -4)}AAAA`

    for (const cookie of [undefined, tampered, foreign]) {
      await expect(ctx.service.finishGoogleSignIn(callback, cookie, CLIENT)).rejects.toMatchObject({
        status: 400,
        code: AuthErrorCode.GOOGLE_FAILED,
      })
    }
    expect(ctx.provider.oidc.exchangeCode).not.toHaveBeenCalled()
  })

  it('fails when the state does not match the cookie, before any code exchange', async () => {
    const ctx = setup()
    const { flowToken } = await ctx.service.startGoogleSignIn('/')
    const callback = ctx.provider.approve(account())

    await expect(
      ctx.service.finishGoogleSignIn({ ...callback, state: 'forged' }, flowToken, CLIENT)
    ).rejects.toMatchObject({ code: AuthErrorCode.GOOGLE_FAILED })
    await expect(
      ctx.service.finishGoogleSignIn({ code: callback.code }, flowToken, CLIENT)
    ).rejects.toMatchObject({ code: AuthErrorCode.GOOGLE_FAILED })
    expect(ctx.provider.oidc.exchangeCode).not.toHaveBeenCalled()
  })

  it('fails without a code', async () => {
    const ctx = setup()
    const { flowToken } = await ctx.service.startGoogleSignIn('/')
    const { state } = ctx.provider.approve(account())

    await expect(
      ctx.service.finishGoogleSignIn({ state }, flowToken, CLIENT)
    ).rejects.toMatchObject({ code: AuthErrorCode.GOOGLE_FAILED })
  })

  it('pairs the cookie with its own sign-in: another tab’s cookie fails the PKCE check', async () => {
    const ctx = setup()
    const first = await ctx.service.startGoogleSignIn('/')
    const firstFlow = await ctx.flowBox.open(first.flowToken)
    // A second start replaces the request at "Google"; the first cookie no longer fits it.
    await ctx.service.startGoogleSignIn('/')
    const callback = { ...ctx.provider.approve(account()), state: String(firstFlow?.state) }

    await expect(
      ctx.service.finishGoogleSignIn(callback, first.flowToken, CLIENT)
    ).rejects.toMatchObject({ code: AuthErrorCode.GOOGLE_FAILED })
  })

  it('turns a failed code exchange or a rejected ID token into one generic failure', async () => {
    const warn = vi.spyOn(logger, 'warn')
    const ctx = setup()
    const { flowToken } = await ctx.service.startGoogleSignIn('/')
    const callback = ctx.provider.approve(account())
    vi.mocked(ctx.provider.oidc.verifyIdToken).mockRejectedValueOnce(
      new OidcError('id token rejected: unexpected "aud" claim value')
    )

    await expect(ctx.service.finishGoogleSignIn(callback, flowToken, CLIENT)).rejects.toMatchObject(
      {
        status: 400,
        code: AuthErrorCode.GOOGLE_FAILED,
        message: 'Google sign-in failed. Try again',
      }
    )
    expect(warn).toHaveBeenCalledWith(LOG.AUTH.signInFailed('google'), {
      reason: 'code exchange or id token',
      detail: 'OIDC: id token rejected: unexpected "aud" claim value',
    })
    expect(ctx.repo.state().users).toHaveLength(0)
    warn.mockRestore()
  })

  it('counts every callback toward the per-IP verify limit', async () => {
    const ctx = setup()
    for (let i = 0; i < AUTH_LIMITS.VERIFIES_PER_IP.limit; i++) {
      await ctx.service
        .finishGoogleSignIn({ code: 'x', state: 'y' }, undefined, CLIENT)
        .catch(() => undefined)
    }

    await expect(ctx.signInWithGoogle()).rejects.toMatchObject({
      status: 429,
      code: AuthErrorCode.RATE_LIMITED,
    })
  })
})

describe('identities in responses', () => {
  it('shows the linked Google account through getMe and refresh', async () => {
    const ctx = setup({ seed: { users: [existingUser()] } })
    await expect(ctx.service.getMe(existingUser().id)).resolves.toMatchObject({ identities: [] })

    const result = await ctx.signInWithGoogle()

    const me = await ctx.service.getMe(existingUser().id)
    expect(me.identities).toEqual([
      { provider: 'google', email: 'somchai@gmail.com', linkedAt: me.identities[0]?.linkedAt },
    ])
    expect(me.identities[0]?.linkedAt).toBeInstanceOf(Date)
    const refreshed = await ctx.service.refresh(result.refreshToken, CLIENT)
    expect(refreshed.user.identities).toHaveLength(1)
  })
})
