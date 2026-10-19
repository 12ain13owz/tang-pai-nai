import { setTimeout as sleep } from 'node:timers/promises'
import { v7 as uuidv7 } from 'uuid'
import {
  BadRequestError,
  ForbiddenError,
  TooManyRequestsError,
  UnauthorizedError,
} from '@/core/error'
import { logger } from '@/core/logger'
import type { Notifier } from '@/core/notification'
import { hashCode, randomCode, randomToken, safeEqualHex, sha256 } from '@/core/security'
import type { AccessTokens } from '@/core/security'
import { ERRORS, LOG } from '@/shared/constants'
import { NotificationChannel } from '@/shared/types'
import { AUTH_LIMITS, AUTH_MESSAGE, AuthErrorCode } from './auth.const'
import { buildSignInMail } from './auth.mail'
import type {
  CleanupResult,
  ClientContext,
  EmailVerification,
  MailLanguage,
  OtpChallenge,
  SignInResult,
  User,
} from './auth.entity'
import type { AuthRepository } from './auth.repository'

export interface AuthServiceConfig {
  webOrigin: string
  signupEnabled: boolean
  emailDailyLimit: number
  /** Floor for `/email/start` (rule 5). Tests pass 0. */
  startMinDurationMs: number
}

export interface AuthServiceDeps {
  authRepo: AuthRepository
  notifier: Pick<Notifier, 'send'>
  accessTokens: AccessTokens
  config: AuthServiceConfig
  now?: () => Date
}

interface RateLimitCheck {
  key: string
  limit: number
  windowMs: number
}

interface SessionGrant {
  id: string
  userId: string
  familyId: string
  authTime: Date
  absoluteExpiresAt: Date
  userAgent: string | null
}

const L = AUTH_LIMITS
const ipKey = (ip: string | undefined) => sha256(ip ?? 'unknown')
const minutes = (ms: number) => Math.round(ms / 60_000)

const codeExpired = () =>
  new BadRequestError(AUTH_MESSAGE.CODE_EXPIRED).withCode(AuthErrorCode.OTP_EXPIRED)
const codeLocked = () =>
  new BadRequestError(AUTH_MESSAGE.CODE_LOCKED).withCode(AuthErrorCode.OTP_LOCKED)
const codeInvalid = () =>
  new BadRequestError(AUTH_MESSAGE.CODE_INVALID).withCode(AuthErrorCode.OTP_INVALID)
const sessionExpired = () =>
  new UnauthorizedError(AUTH_MESSAGE.SESSION_EXPIRED).withCode(AuthErrorCode.SESSION_EXPIRED)
const sessionRevoked = () =>
  new UnauthorizedError(AUTH_MESSAGE.SESSION_REVOKED).withCode(AuthErrorCode.SESSION_REVOKED)
const userDisabled = () =>
  new ForbiddenError(AUTH_MESSAGE.USER_DISABLED).withCode(AuthErrorCode.USER_DISABLED)

const isOpen = (challenge: OtpChallenge, at: Date) =>
  !challenge.consumedAt && challenge.expiresAt.getTime() > at.getTime()

export const createAuthService = ({
  authRepo,
  notifier,
  accessTokens,
  config,
  now = () => new Date(),
}: AuthServiceDeps) => {
  /** Counts a hit on every check, then fails with the longest wait if any is over its limit. */
  const enforceLimits = async (checks: RateLimitCheck[], at: Date, operation: string) => {
    let retryAfterMs = 0
    for (const { key, limit, windowMs } of checks) {
      const hit = await authRepo.hitRateLimit(key, windowMs, at)
      if (hit.count > limit) {
        const waitMs = hit.windowStart.getTime() + windowMs - at.getTime()
        retryAfterMs = Math.max(retryAfterMs, waitMs)
      }
    }
    if (retryAfterMs > 0) {
      throw new TooManyRequestsError(ERRORS.TOO_MANY_REQUESTS, Math.ceil(retryAfterMs / 1000))
        .withCode(AuthErrorCode.RATE_LIMITED)
        .withOperation(operation)
    }
  }

  const issueSession = async (
    repo: AuthRepository,
    grant: SessionGrant,
    at: Date
  ): Promise<{ refreshToken: string; refreshExpiresAt: Date }> => {
    const refreshToken = randomToken()
    const idleExpiry = at.getTime() + L.SESSION_IDLE_MS
    const refreshExpiresAt = new Date(Math.min(idleExpiry, grant.absoluteExpiresAt.getTime()))
    await repo.createSession({
      ...grant,
      tokenHash: sha256(refreshToken),
      expiresAt: refreshExpiresAt,
      lastUsedAt: at,
    })
    return { refreshToken, refreshExpiresAt }
  }

  const signedIn = async (
    user: User,
    familyId: string,
    refresh: { refreshToken: string; refreshExpiresAt: Date }
  ): Promise<SignInResult> => ({
    user,
    accessToken: await accessTokens.sign({ sub: user.id, sid: familyId }),
    expiresIn: accessTokens.ttlSeconds,
    ...refresh,
  })

  /** Rules 4–6: always the same answer; mail only goes to someone who may sign in. */
  const startEmailSignIn = async (
    email: string,
    lang: MailLanguage,
    client: ClientContext
  ): Promise<void> => {
    const at = now()
    const emailKey = sha256(email)

    await enforceLimits(
      [
        { key: `otp:cooldown:${emailKey}`, limit: 1, windowMs: L.RESEND_COOLDOWN_MS },
        { key: `otp:email:${emailKey}`, ...L.STARTS_PER_EMAIL },
        { key: `otp:ip:${ipKey(client.ip)}`, ...L.STARTS_PER_IP },
      ],
      at,
      'startEmailSignIn'
    )
    const daily = await authRepo.hitRateLimit('email:global:day', L.EMAILS_PER_DAY_WINDOW_MS, at)
    if (daily.count > config.emailDailyLimit) {
      logger.warn(LOG.AUTH.emailDailyLimit(config.emailDailyLimit))
      const retryAfterMs = daily.windowStart.getTime() + L.EMAILS_PER_DAY_WINDOW_MS - at.getTime()
      throw new TooManyRequestsError(ERRORS.TOO_MANY_REQUESTS, Math.ceil(retryAfterMs / 1000))
        .withCode(AuthErrorCode.RATE_LIMITED)
        .withOperation('startEmailSignIn')
    }

    const user = await authRepo.findUserByEmail(email)
    const shouldSend = user !== null || config.signupEnabled

    const code = randomCode(L.CODE_DIGITS)
    const linkToken = randomToken()
    // Created even when no mail goes out, so verify answers the same for every email.
    const challenge = await authRepo.transaction(async (repo) => {
      await repo.expireOpenChallenges(email, at)
      return repo.createChallenge({
        destination: email,
        codeHash: hashCode(code),
        linkTokenHash: sha256(linkToken),
        expiresAt: new Date(at.getTime() + L.CHALLENGE_TTL_MS),
      })
    })

    if (shouldSend) {
      const mail = buildSignInMail({
        code,
        link: `${config.webOrigin}/auth/link#token=${linkToken}`,
        lang,
        expiresInMinutes: minutes(L.CHALLENGE_TTL_MS),
      })
      await notifier.send({ channel: NotificationChannel.EMAIL, to: email, ...mail })
    }
    logger.info(LOG.AUTH.codeRequested, { challengeId: challenge.id, sent: shouldSend })

    const remainingMs = at.getTime() + config.startMinDurationMs - Date.now()
    if (remainingMs > 0) {
      await sleep(remainingMs)
    }
  }

  const findChallenge = async (input: EmailVerification) =>
    'token' in input
      ? authRepo.findChallengeByLinkTokenHash(sha256(input.token))
      : authRepo.findLatestChallenge(input.email)

  /** Rules 7 and 9: one code or link → a session (and the user, on first sign-in). */
  const verifyEmailSignIn = async (
    input: EmailVerification,
    client: ClientContext
  ): Promise<SignInResult> => {
    const at = now()
    await enforceLimits(
      [{ key: `verify:ip:${ipKey(client.ip)}`, ...L.VERIFIES_PER_IP }],
      at,
      'verifyEmailSignIn'
    )

    const challenge = await findChallenge(input)
    if (!challenge || !isOpen(challenge, at)) {
      throw codeExpired().withOperation('verifyEmailSignIn')
    }
    if (challenge.attempts >= L.MAX_CODE_ATTEMPTS) {
      throw codeLocked().withOperation('verifyEmailSignIn')
    }
    if ('code' in input && !safeEqualHex(hashCode(input.code), challenge.codeHash)) {
      const attempts = (await authRepo.recordFailedAttempt(challenge.id)) ?? L.MAX_CODE_ATTEMPTS
      logger.warn(LOG.AUTH.signInFailed('email'), { challengeId: challenge.id, attempts })
      const error = attempts >= L.MAX_CODE_ATTEMPTS ? codeLocked() : codeInvalid()
      throw error.withOperation('verifyEmailSignIn')
    }

    const outcome = await authRepo.transaction(async (repo) => {
      if (!(await repo.consumeChallenge(challenge.id, at))) {
        return { kind: 'expired' } as const
      }
      let user = await repo.findUserByEmail(challenge.destination)
      if (!user) {
        if (!config.signupEnabled) {
          return { kind: 'expired' } as const
        }
        const displayName = challenge.destination.split('@')[0]
        user = await repo.createUser({ email: challenge.destination, displayName })
        logger.info(LOG.AUTH.userCreated, { userId: user.id })
      }
      // Checked after the credential, so a stranger can't learn the account's state (rule 3).
      if (user.status === 'disabled') {
        return { kind: 'disabled', userId: user.id } as const
      }
      if (!user.emailVerifiedAt) {
        user = (await repo.markEmailVerified(user.id, at)) ?? user
      }
      const familyId = uuidv7()
      const refresh = await issueSession(
        repo,
        {
          id: uuidv7(),
          userId: user.id,
          familyId,
          authTime: at,
          absoluteExpiresAt: new Date(at.getTime() + L.SESSION_ABSOLUTE_MS),
          userAgent: client.userAgent ?? null,
        },
        at
      )
      return { kind: 'signedIn', user, familyId, refresh } as const
    })

    if (outcome.kind === 'expired') {
      throw codeExpired().withOperation('verifyEmailSignIn')
    }
    if (outcome.kind === 'disabled') {
      logger.warn(LOG.AUTH.signInFailed('email'), { userId: outcome.userId, reason: 'disabled' })
      throw userDisabled().withOperation('verifyEmailSignIn')
    }
    logger.info(LOG.AUTH.signedIn('email'), {
      userId: outcome.user.id,
      sessionFamilyId: outcome.familyId,
    })
    return signedIn(outcome.user, outcome.familyId, outcome.refresh)
  }

  const revokeForReuse = async (familyId: string, userId: string, at: Date) => {
    await authRepo.revokeFamily(familyId, at)
    logger.warn(LOG.AUTH.refreshReuse, { userId, sessionFamilyId: familyId })
  }

  /** Rotation + reuse detection (Tokens & session). */
  const refresh = async (
    refreshToken: string | undefined,
    client: ClientContext
  ): Promise<SignInResult> => {
    const at = now()
    const session = refreshToken
      ? await authRepo.findSessionByTokenHash(sha256(refreshToken))
      : null
    if (!session) {
      throw sessionExpired().withOperation('refresh')
    }
    if (session.revokedAt) {
      if (session.replacedById) {
        await revokeForReuse(session.familyId, session.userId, at)
      }
      throw sessionRevoked().withOperation('refresh')
    }
    const end = Math.min(session.expiresAt.getTime(), session.absoluteExpiresAt.getTime())
    if (end <= at.getTime()) {
      throw sessionExpired().withOperation('refresh')
    }

    const user = await authRepo.findUserById(session.userId)
    if (!user) {
      throw sessionRevoked().withOperation('refresh')
    }
    if (user.status === 'disabled') {
      throw userDisabled().withOperation('refresh')
    }

    const rotated = await authRepo.transaction(async (repo) => {
      const id = uuidv7()
      if (!(await repo.markSessionRotated(session.id, id, at))) {
        return null
      }
      return issueSession(
        repo,
        {
          id,
          userId: user.id,
          familyId: session.familyId,
          authTime: session.authTime,
          absoluteExpiresAt: session.absoluteExpiresAt,
          userAgent: client.userAgent ?? session.userAgent,
        },
        at
      )
    })
    // Another request rotated this token first: the same token was used twice.
    if (!rotated) {
      await revokeForReuse(session.familyId, session.userId, at)
      throw sessionRevoked().withOperation('refresh')
    }
    return signedIn(user, session.familyId, rotated)
  }

  /** Rule 17: revokes the whole family of the presented token. Unknown tokens are a no-op. */
  const signOut = async (refreshToken: string | undefined): Promise<void> => {
    const session = refreshToken
      ? await authRepo.findSessionByTokenHash(sha256(refreshToken))
      : null
    if (!session) {
      return
    }
    await authRepo.revokeFamily(session.familyId, now())
    logger.info(LOG.AUTH.signedOut, { userId: session.userId, sessionFamilyId: session.familyId })
  }

  const getMe = async (userId: string): Promise<User> => {
    const user = await authRepo.findUserById(userId)
    if (!user) {
      throw new UnauthorizedError(ERRORS.UNAUTHORIZED).withOperation('getMe')
    }
    if (user.status === 'disabled') {
      throw userDisabled().withOperation('getMe')
    }
    return user
  }

  /** Rule 20: drop rows that ended more than 7 days ago. */
  const cleanup = async (): Promise<CleanupResult> =>
    authRepo.deleteExpired(new Date(now().getTime() - L.CLEANUP_AFTER_MS))

  return { startEmailSignIn, verifyEmailSignIn, refresh, signOut, getMe, cleanup }
}

export type AuthService = ReturnType<typeof createAuthService>
