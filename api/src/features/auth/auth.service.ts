import { setTimeout as sleep } from 'node:timers/promises'
import { v7 as uuidv7 } from 'uuid'
import {
  BadRequestError,
  BusinessRuleError,
  ForbiddenError,
  TooManyRequestsError,
  UnauthorizedError,
} from '@/core/error'
import { logger } from '@/core/logger'
import type { Notifier } from '@/core/notification'
import {
  hashCode,
  hashPassword,
  passwordNeedsRehash,
  randomCode,
  randomToken,
  safeEqualHex,
  sha256,
  verifyDummyPassword,
  verifyPassword,
} from '@/core/security'
import type { AccessTokens, BreachedPasswordChecker } from '@/core/security'
import { ERRORS, LOG } from '@/shared/constants'
import { NotificationChannel } from '@/shared/types'
import { AUTH_LIMITS, AUTH_MESSAGE, AuthErrorCode, PASSWORD_POLICY } from './auth.const'
import { buildReauthMail, buildSignInMail } from './auth.mail'
import type {
  Caller,
  CleanupResult,
  ClientContext,
  EmailVerification,
  MailLanguage,
  OtpChallenge,
  PasswordChange,
  Session,
  SignInResult,
  User,
  UserProfile,
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
  /** HIBP, or a stand-in that never reports a breach (`PASSWORD_BREACH_CHECK=off`, tests). */
  breachChecker: BreachedPasswordChecker
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
const invalidCredentials = () =>
  new BadRequestError(AUTH_MESSAGE.INVALID_CREDENTIALS).withCode(AuthErrorCode.INVALID_CREDENTIALS)
const currentPasswordInvalid = () =>
  new BadRequestError(AUTH_MESSAGE.CURRENT_PASSWORD_INVALID).withCode(
    AuthErrorCode.CURRENT_PASSWORD_INVALID
  )
const reauthRequired = () =>
  new ForbiddenError(AUTH_MESSAGE.REAUTH_REQUIRED).withCode(AuthErrorCode.REAUTH_REQUIRED)
const passwordRefused = (
  code: Extract<
    AuthErrorCode,
    | AuthErrorCode.PASSWORD_TOO_SHORT
    | AuthErrorCode.PASSWORD_TOO_LONG
    | AuthErrorCode.PASSWORD_TOO_WEAK
    | AuthErrorCode.PASSWORD_MATCHES_EMAIL
    | AuthErrorCode.PASSWORD_BREACHED
  >
) =>
  // eslint-disable-next-line security/detect-object-injection -- `code` is one of five enum values
  new BusinessRuleError(AUTH_MESSAGE[code]).withCode(code)

type PasswordRefusal = Parameters<typeof passwordRefused>[0]

/** Rule 11: the first rule the password breaks, or `null` when it may be used. */
const passwordPolicyRefusal = (password: string, email: string): PasswordRefusal | null => {
  const length = [...password].length
  if (length < PASSWORD_POLICY.MIN_LENGTH) {
    return AuthErrorCode.PASSWORD_TOO_SHORT
  }
  if (length > PASSWORD_POLICY.MAX_LENGTH) {
    return AuthErrorCode.PASSWORD_TOO_LONG
  }
  if (!PASSWORD_POLICY.REQUIRED_CLASSES.every((pattern) => pattern.test(password))) {
    return AuthErrorCode.PASSWORD_TOO_WEAK
  }
  const lowered = password.toLowerCase()
  if (lowered === email || lowered === email.split('@')[0]) {
    return AuthErrorCode.PASSWORD_MATCHES_EMAIL
  }
  return null
}

const isOpen = (challenge: OtpChallenge, at: Date) =>
  !challenge.consumedAt && challenge.expiresAt.getTime() > at.getTime()

export const createAuthService = ({
  authRepo,
  notifier,
  accessTokens,
  breachChecker,
  config,
  now = () => new Date(),
}: AuthServiceDeps) => {
  const tooManyRequests = (retryAfterMs: number, operation: string) =>
    new TooManyRequestsError(ERRORS.TOO_MANY_REQUESTS, Math.ceil(retryAfterMs / 1000))
      .withCode(AuthErrorCode.RATE_LIMITED)
      .withOperation(operation)

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
      throw tooManyRequests(retryAfterMs, operation)
    }
  }

  /** Failure-counting limits (rule 12): refuses once a bucket is full, without counting a hit. */
  const ensureUnderLimits = async (checks: RateLimitCheck[], at: Date, operation: string) => {
    let retryAfterMs = 0
    for (const { key, limit, windowMs } of checks) {
      const bucket = await authRepo.peekRateLimit(key, windowMs, at)
      if (bucket && bucket.count >= limit) {
        const waitMs = bucket.windowStart.getTime() + windowMs - at.getTime()
        retryAfterMs = Math.max(retryAfterMs, waitMs)
      }
    }
    if (retryAfterMs > 0) {
      throw tooManyRequests(retryAfterMs, operation)
    }
  }

  const recordFailures = async (checks: RateLimitCheck[], at: Date) => {
    for (const { key, windowMs } of checks) {
      await authRepo.hitRateLimit(key, windowMs, at)
    }
  }

  const passwordFailureChecks = (email: string, client: ClientContext): RateLimitCheck[] => [
    { key: `pw:email:${sha256(email)}`, ...L.PASSWORD_FAILURES_PER_EMAIL },
    { key: `pw:ip:${ipKey(client.ip)}`, ...L.PASSWORD_FAILURES_PER_IP },
  ]

  /** Rule 6: the global cap on mails per day, shared by every mail auth sends. */
  const countDailyEmail = async (at: Date, operation: string) => {
    const daily = await authRepo.hitRateLimit('email:global:day', L.EMAILS_PER_DAY_WINDOW_MS, at)
    if (daily.count > config.emailDailyLimit) {
      logger.warn(LOG.AUTH.emailDailyLimit(config.emailDailyLimit))
      const retryAfterMs = daily.windowStart.getTime() + L.EMAILS_PER_DAY_WINDOW_MS - at.getTime()
      throw tooManyRequests(retryAfterMs, operation)
    }
  }

  const emailStartChecks = (email: string, client: ClientContext): RateLimitCheck[] => {
    const emailKey = sha256(email)
    return [
      { key: `otp:cooldown:${emailKey}`, limit: 1, windowMs: L.RESEND_COOLDOWN_MS },
      { key: `otp:email:${emailKey}`, ...L.STARTS_PER_EMAIL },
      { key: `otp:ip:${ipKey(client.ip)}`, ...L.STARTS_PER_IP },
    ]
  }

  const profileOf = async (user: User): Promise<UserProfile> => ({
    ...user,
    hasPassword: (await authRepo.findPasswordHash(user.id)) !== null,
  })

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

  /** A new sign-in: a new session family whose credential was checked just now. */
  const startSession = async (
    repo: AuthRepository,
    userId: string,
    client: ClientContext,
    at: Date
  ): Promise<{ familyId: string; refresh: { refreshToken: string; refreshExpiresAt: Date } }> => {
    const familyId = uuidv7()
    const refresh = await issueSession(
      repo,
      {
        id: uuidv7(),
        userId,
        familyId,
        authTime: at,
        absoluteExpiresAt: new Date(at.getTime() + L.SESSION_ABSOLUTE_MS),
        userAgent: client.userAgent ?? null,
      },
      at
    )
    return { familyId, refresh }
  }

  const signedIn = async (
    user: UserProfile,
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
    // Real elapsed time for the minimum duration; `now()` is the business clock (tests move it).
    const startedAt = Date.now()
    const at = now()

    await enforceLimits(emailStartChecks(email, client), at, 'startEmailSignIn')
    await countDailyEmail(at, 'startEmailSignIn')

    const user = await authRepo.findUserByEmail(email)
    const shouldSend = user !== null || config.signupEnabled

    const code = randomCode(L.CODE_DIGITS)
    const linkToken = randomToken()
    // Created even when no mail goes out, so verify answers the same for every email.
    const challenge = await authRepo.transaction(async (repo) => {
      await repo.expireOpenChallenges(email, 'sign_in', at)
      return repo.createChallenge({
        purpose: 'sign_in',
        destination: email,
        userId: null,
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

    const remainingMs = startedAt + config.startMinDurationMs - Date.now()
    if (remainingMs > 0) {
      await sleep(remainingMs)
    }
  }

  const findChallenge = async (input: EmailVerification) =>
    'token' in input
      ? authRepo.findChallengeByLinkTokenHash(sha256(input.token))
      : authRepo.findLatestChallenge(input.email, 'sign_in')

  /** Rule 7: a challenge allows 5 wrong codes; each one is counted before the error. */
  const checkCode = async (
    challenge: OtpChallenge,
    code: string | undefined,
    failedLog: string,
    operation: string
  ) => {
    if (challenge.attempts >= L.MAX_CODE_ATTEMPTS) {
      throw codeLocked().withOperation(operation)
    }
    if (code !== undefined && !safeEqualHex(hashCode(code), challenge.codeHash)) {
      const attempts = (await authRepo.recordFailedAttempt(challenge.id)) ?? L.MAX_CODE_ATTEMPTS
      logger.warn(failedLog, { challengeId: challenge.id, attempts })
      const error = attempts >= L.MAX_CODE_ATTEMPTS ? codeLocked() : codeInvalid()
      throw error.withOperation(operation)
    }
  }

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
    const code = 'code' in input ? input.code : undefined
    await checkCode(challenge, code, LOG.AUTH.signInFailed('email'), 'verifyEmailSignIn')

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
      const { familyId, refresh } = await startSession(repo, user.id, client, at)
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
    return signedIn(await profileOf(outcome.user), outcome.familyId, outcome.refresh)
  }

  /** Rule 12: one answer for unknown email, wrong password and no password; same timing. */
  const signInWithPassword = async (
    email: string,
    password: string,
    client: ClientContext
  ): Promise<SignInResult> => {
    const at = now()
    const failureChecks = passwordFailureChecks(email, client)
    await ensureUnderLimits(failureChecks, at, 'signInWithPassword')

    const user = await authRepo.findUserByEmail(email)
    const passwordHash = user ? await authRepo.findPasswordHash(user.id) : null
    const matches = passwordHash
      ? await verifyPassword(passwordHash, password)
      : await verifyDummyPassword(password)
    if (!user || !passwordHash || !matches) {
      await recordFailures(failureChecks, at)
      logger.warn(LOG.AUTH.signInFailed('password'), { userId: user?.id })
      throw invalidCredentials().withOperation('signInWithPassword')
    }
    // Checked after the credential, so a stranger can't learn the account's state (rule 3).
    if (user.status === 'disabled') {
      logger.warn(LOG.AUTH.signInFailed('password'), { userId: user.id, reason: 'disabled' })
      throw userDisabled().withOperation('signInWithPassword')
    }
    // Rule 10: upgrade a hash made with older parameters while the password is at hand.
    if (passwordNeedsRehash(passwordHash)) {
      await authRepo.savePasswordHash(user.id, await hashPassword(password), at)
      logger.info(LOG.AUTH.passwordRehashed, { userId: user.id })
    }

    const { familyId, refresh } = await authRepo.transaction(async (repo) =>
      startSession(repo, user.id, client, at)
    )
    logger.info(LOG.AUTH.signedIn('password'), { userId: user.id, sessionFamilyId: familyId })
    return signedIn({ ...user, hasPassword: true }, familyId, refresh)
  }

  /**
   * The caller's user and session. An access token outlives a revoked session by up to 10 min,
   * so routes that change credentials check the session itself.
   */
  const activeCaller = async (
    caller: Caller,
    at: Date,
    operation: string
  ): Promise<{ user: User; session: Session }> => {
    const user = await authRepo.findUserById(caller.userId)
    if (!user) {
      throw new UnauthorizedError(ERRORS.UNAUTHORIZED).withOperation(operation)
    }
    if (user.status === 'disabled') {
      throw userDisabled().withOperation(operation)
    }
    const session = await authRepo.findActiveSession(caller.sessionFamilyId)
    const end = session
      ? Math.min(session.expiresAt.getTime(), session.absoluteExpiresAt.getTime())
      : 0
    if (!session || session.userId !== user.id || end <= at.getTime()) {
      throw new UnauthorizedError(ERRORS.UNAUTHORIZED).withOperation(operation)
    }
    return { user, session }
  }

  /** Rule 13: a credential checked ≤ 10 min ago on this session, or the current password now. */
  const requireRecentAuth = async (
    { user, session }: { user: User; session: Session },
    currentPassword: string | undefined,
    client: ClientContext,
    at: Date,
    operation: string
  ) => {
    if (at.getTime() - session.authTime.getTime() <= L.RECENT_AUTH_MS) {
      return
    }
    const passwordHash =
      currentPassword === undefined ? null : await authRepo.findPasswordHash(user.id)
    if (currentPassword === undefined || !passwordHash) {
      throw reauthRequired().withOperation(operation)
    }
    const failureChecks = passwordFailureChecks(user.email, client)
    await ensureUnderLimits(failureChecks, at, operation)
    if (!(await verifyPassword(passwordHash, currentPassword))) {
      await recordFailures(failureChecks, at)
      logger.warn(LOG.AUTH.reauthFailed('password'), { userId: user.id })
      throw currentPasswordInvalid().withOperation(operation)
    }
    logger.info(LOG.AUTH.reauthenticated('password'), {
      userId: user.id,
      sessionFamilyId: session.familyId,
    })
  }

  /** Rule 11: breached passwords are refused; an unreachable checker lets them through. */
  const rejectBreached = async (password: string) => {
    const breached = await breachChecker(password)
    if (breached === null) {
      logger.warn(LOG.AUTH.breachCheckUnavailable)
    }
    if (breached) {
      throw passwordRefused(AuthErrorCode.PASSWORD_BREACHED).withOperation('setPassword')
    }
  }

  /** Rule 13: set or change the password, then sign out every other session family. */
  const setPassword = async (
    caller: Caller,
    { newPassword, currentPassword }: PasswordChange,
    client: ClientContext
  ): Promise<UserProfile> => {
    const at = now()
    const access = await activeCaller(caller, at, 'setPassword')
    const { user, session } = access
    // The password is judged before asking for proof, so a refused one doesn't cost a re-auth.
    const refusal = passwordPolicyRefusal(newPassword, user.email)
    if (refusal) {
      throw passwordRefused(refusal).withOperation('setPassword')
    }
    await rejectBreached(newPassword)
    await requireRecentAuth(access, currentPassword, client, at, 'setPassword')

    const passwordHash = await hashPassword(newPassword)
    const { hadPassword, revokedSessions } = await authRepo.transaction(async (repo) => {
      const had = (await repo.findPasswordHash(user.id)) !== null
      await repo.savePasswordHash(user.id, passwordHash, at)
      const revoked = await repo.revokeOtherFamilies(user.id, session.familyId, at)
      return { hadPassword: had, revokedSessions: revoked }
    })
    logger.info(hadPassword ? LOG.AUTH.passwordChanged : LOG.AUTH.passwordSet, {
      userId: user.id,
      sessionFamilyId: session.familyId,
      revokedSessions,
    })
    return { ...user, hasPassword: true }
  }

  /** Rule 13: remove the password (recent auth). Without one it's a no-op. */
  const removePassword = async (
    caller: Caller,
    currentPassword: string | undefined,
    client: ClientContext
  ): Promise<UserProfile> => {
    const at = now()
    const access = await activeCaller(caller, at, 'removePassword')
    const { user } = access
    if ((await authRepo.findPasswordHash(user.id)) === null) {
      return { ...user, hasPassword: false }
    }
    await requireRecentAuth(access, currentPassword, client, at, 'removePassword')
    await authRepo.deletePasswordHash(user.id)
    logger.info(LOG.AUTH.passwordRemoved, {
      userId: user.id,
      sessionFamilyId: caller.sessionFamilyId,
    })
    return { ...user, hasPassword: false }
  }

  /** Rule 13: mail a code-only step-up challenge to the caller's own email. */
  const startReauth = async (
    caller: Caller,
    lang: MailLanguage,
    client: ClientContext
  ): Promise<void> => {
    const at = now()
    const { user } = await activeCaller(caller, at, 'startReauth')
    await enforceLimits(emailStartChecks(user.email, client), at, 'startReauth')
    await countDailyEmail(at, 'startReauth')

    const code = randomCode(L.CODE_DIGITS)
    const challenge = await authRepo.transaction(async (repo) => {
      await repo.expireOpenChallenges(user.email, 'reauth', at)
      return repo.createChallenge({
        purpose: 'reauth',
        destination: user.email,
        userId: user.id,
        codeHash: hashCode(code),
        linkTokenHash: null,
        expiresAt: new Date(at.getTime() + L.CHALLENGE_TTL_MS),
      })
    })
    const mail = buildReauthMail({ code, lang, expiresInMinutes: minutes(L.CHALLENGE_TTL_MS) })
    await notifier.send({ channel: NotificationChannel.EMAIL, to: user.email, ...mail })
    logger.info(LOG.AUTH.reauthRequested, { challengeId: challenge.id, userId: user.id })
  }

  /** Rule 13: a right step-up code marks the caller's session family as just checked. */
  const verifyReauth = async (caller: Caller, code: string, client: ClientContext) => {
    const at = now()
    await enforceLimits(
      [{ key: `verify:ip:${ipKey(client.ip)}`, ...L.VERIFIES_PER_IP }],
      at,
      'verifyReauth'
    )
    const { user, session } = await activeCaller(caller, at, 'verifyReauth')
    const challenge = await authRepo.findLatestChallenge(user.email, 'reauth')
    if (!challenge || challenge.userId !== user.id || !isOpen(challenge, at)) {
      throw codeExpired().withOperation('verifyReauth')
    }
    await checkCode(challenge, code, LOG.AUTH.reauthFailed('email'), 'verifyReauth')

    const confirmed = await authRepo.transaction(async (repo) => {
      if (!(await repo.consumeChallenge(challenge.id, at))) {
        return false
      }
      await repo.setFamilyAuthTime(session.familyId, at)
      return true
    })
    if (!confirmed) {
      throw codeExpired().withOperation('verifyReauth')
    }
    logger.info(LOG.AUTH.reauthenticated('email'), {
      userId: user.id,
      sessionFamilyId: session.familyId,
    })
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
    return signedIn(await profileOf(user), session.familyId, rotated)
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

  const getMe = async (userId: string): Promise<UserProfile> => {
    const user = await authRepo.findUserById(userId)
    if (!user) {
      throw new UnauthorizedError(ERRORS.UNAUTHORIZED).withOperation('getMe')
    }
    if (user.status === 'disabled') {
      throw userDisabled().withOperation('getMe')
    }
    return profileOf(user)
  }

  /** Rule 20: drop rows that ended more than 7 days ago. */
  const cleanup = async (): Promise<CleanupResult> =>
    authRepo.deleteExpired(new Date(now().getTime() - L.CLEANUP_AFTER_MS))

  return {
    startEmailSignIn,
    verifyEmailSignIn,
    signInWithPassword,
    setPassword,
    removePassword,
    startReauth,
    verifyReauth,
    refresh,
    signOut,
    getMe,
    cleanup,
  }
}

export type AuthService = ReturnType<typeof createAuthService>
