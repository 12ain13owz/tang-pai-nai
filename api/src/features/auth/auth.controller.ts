import { AppError, ErrorLogger } from '@/core/error'
import { ERRORS, ErrorSeverity, HttpStatus } from '@/shared/constants'
import { createResponse } from '@/shared/utils'
import {
  AUTH_LIMITS,
  AUTH_MESSAGE,
  AuthErrorCode,
  GOOGLE_FLOW_COOKIE,
  REFRESH_COOKIE,
} from './auth.const'
import type {
  Caller,
  ClientContext,
  SessionSummary,
  SignInResult,
  UserProfile,
} from './auth.entity'
import type {
  EmailStartInput,
  EmailVerifyInput,
  GoogleCallbackQuery,
  GoogleStartQuery,
  PasswordSetInput,
  PasswordSignInInput,
  PhoneChangeInput,
  PhoneConfirmInput,
  PhoneStartInput,
  PhoneVerifyInput,
  ReauthStartInput,
  ReauthVerifyInput,
  RecentAuthInput,
  SessionParams,
} from './auth.schema'
import type { AuthService } from './auth.service'
import type {
  AuthDeviceSessionData,
  AuthGoogleLinkData,
  AuthProvidersData,
  AuthSessionData,
  AuthSessionsRevokedData,
  AuthUserData,
} from './auth.type'
import type { CookieOptions, NextFunction, Request, Response } from 'express'

// `__Host-` requires Secure, Path=/ and no Domain (auth spec → Tokens & session).
const COOKIE_OPTIONS: CookieOptions = {
  httpOnly: true,
  secure: true,
  sameSite: 'strict',
  path: '/',
}

// The Google round-trip cookie must come back on Google's cross-site redirect, so it's Lax.
const GOOGLE_FLOW_COOKIE_OPTIONS: CookieOptions = {
  httpOnly: true,
  secure: true,
  sameSite: 'lax',
  path: '/',
}

/** `/auth/callback?error=<reason>` on the web app (auth spec rule 14). */
const GOOGLE_FAILURE_REASONS = new Map<string, string>([
  [AuthErrorCode.GOOGLE_CANCELLED, 'cancelled'],
  [AuthErrorCode.EMAIL_UNVERIFIED, 'email_unverified'],
  [AuthErrorCode.SIGNUP_CLOSED, 'signup_closed'],
  [AuthErrorCode.USER_DISABLED, 'disabled'],
  [AuthErrorCode.RATE_LIMITED, 'rate_limited'],
])

/** `/account/security?error=<reason>` after linking Google (auth spec rule 29). */
const GOOGLE_LINK_FAILURE_REASONS = new Map<string, string>([
  [AuthErrorCode.GOOGLE_CANCELLED, 'cancelled'],
  [AuthErrorCode.GOOGLE_IN_USE, 'google_in_use'],
  [AuthErrorCode.IDENTITY_ALREADY_LINKED, 'already_linked'],
  [AuthErrorCode.USER_DISABLED, 'disabled'],
  [AuthErrorCode.RATE_LIMITED, 'rate_limited'],
])

const toUserData = (user: UserProfile): AuthUserData => ({
  id: user.id,
  email: user.email,
  displayName: user.displayName,
  avatarUrl: user.avatarUrl,
  timezone: user.timezone,
  hasPassword: user.hasPassword,
  identities: user.identities.map((identity) => ({
    provider: identity.provider,
    email: identity.email,
    linkedAt: identity.linkedAt.toISOString(),
  })),
  phone: user.phone,
})

const toDeviceSessionData = (session: SessionSummary): AuthDeviceSessionData => ({
  id: session.familyId,
  userAgent: session.userAgent,
  signedInAt: session.signedInAt.toISOString(),
  lastUsedAt: session.lastUsedAt.toISOString(),
  current: session.current,
})

/** `req.auth`, set by `authenticate` in front of every Bearer route. */
const callerOf = <P, B>(req: Request<P, unknown, B>): Caller => {
  if (!req.auth) {
    throw new AppError(ERRORS.UNAUTHORIZED, HttpStatus.UNAUTHORIZED, ErrorSeverity.WARN)
  }
  return req.auth
}

const clientOf = <P, B>(req: Request<P, unknown, B>): ClientContext => ({
  ip: req.ip,
  userAgent: req.get('user-agent')?.slice(0, AUTH_LIMITS.USER_AGENT_MAX),
})

const refreshTokenOf = (req: Request): string | undefined => {
  const cookies = req.cookies as Record<string, unknown> | undefined
  // eslint-disable-next-line security/detect-object-injection -- a constant key
  const value = cookies?.[REFRESH_COOKIE]
  return typeof value === 'string' && value !== '' ? value : undefined
}

export interface AuthControllerConfig {
  /** Where Google sign-in sends the browser back to (`/auth/callback`). */
  webOrigin: string
}

export const createAuthController = (authService: AuthService, config: AuthControllerConfig) => {
  const setRefreshCookie = (res: Response, { refreshToken, refreshExpiresAt }: SignInResult) => {
    res.cookie(REFRESH_COOKIE, refreshToken, { ...COOKIE_OPTIONS, expires: refreshExpiresAt })
  }

  const webUrl = (path: string, params: Record<string, string | null>): string => {
    const url = new URL(path, config.webOrigin)
    for (const [key, value] of Object.entries(params)) {
      if (value !== null) {
        url.searchParams.set(key, value)
      }
    }
    return url.toString()
  }

  const webCallbackUrl = (params: Record<string, string | null>): string =>
    webUrl('/auth/callback', params)

  const notFoundGoogle = () =>
    new AppError(ERRORS.notFound(AUTH_MESSAGE.GOOGLE), HttpStatus.NOT_FOUND, ErrorSeverity.WARN)

  const setGoogleFlowCookie = (res: Response, flowToken: string) => {
    res.cookie(GOOGLE_FLOW_COOKIE, flowToken, {
      ...GOOGLE_FLOW_COOKIE_OPTIONS,
      maxAge: AUTH_LIMITS.GOOGLE_FLOW_TTL_MS,
    })
  }

  // Strips the raw refresh token out of the body: it only ever travels in the cookie.
  const sendSession = (res: Response, message: string, result: SignInResult): void => {
    const { accessToken, expiresIn, user } = result
    setRefreshCookie(res, result)
    const data: AuthSessionData = { accessToken, expiresIn, user: toUserData(user) }
    const response = createResponse(message, data)
    res.status(HttpStatus.OK).json(response)
  }

  const emailStart = async (
    req: Request<unknown, unknown, EmailStartInput>,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      await authService.startEmailSignIn(req.body.email, req.body.lang, clientOf(req))
      const response = createResponse(AUTH_MESSAGE.CODE_SENT)
      res.status(HttpStatus.ACCEPTED).json(response)
    } catch (error) {
      next(error)
    }
  }

  const emailVerify = async (
    req: Request<unknown, unknown, EmailVerifyInput>,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const result = await authService.verifyEmailSignIn(req.body, clientOf(req))
      sendSession(res, AUTH_MESSAGE.SIGNED_IN, result)
    } catch (error) {
      next(error)
    }
  }

  const passwordSignIn = async (
    req: Request<unknown, unknown, PasswordSignInInput>,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const { email, password } = req.body
      const result = await authService.signInWithPassword(email, password, clientOf(req))
      sendSession(res, AUTH_MESSAGE.SIGNED_IN, result)
    } catch (error) {
      next(error)
    }
  }

  const passwordSet = async (
    req: Request<unknown, unknown, PasswordSetInput>,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const user = await authService.setPassword(callerOf(req), req.body, clientOf(req))
      const response = createResponse(AUTH_MESSAGE.PASSWORD_SAVED, toUserData(user))
      res.status(HttpStatus.OK).json(response)
    } catch (error) {
      next(error)
    }
  }

  const passwordRemove = async (
    req: Request<unknown, unknown, RecentAuthInput>,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const { currentPassword, lang } = req.body
      const user = await authService.removePassword(
        callerOf(req),
        currentPassword,
        clientOf(req),
        lang
      )
      const response = createResponse(AUTH_MESSAGE.PASSWORD_REMOVED, toUserData(user))
      res.status(HttpStatus.OK).json(response)
    } catch (error) {
      next(error)
    }
  }

  const reauthStart = async (
    req: Request<unknown, unknown, ReauthStartInput>,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      await authService.startReauth(callerOf(req), req.body.lang, clientOf(req))
      const response = createResponse(AUTH_MESSAGE.REAUTH_CODE_SENT)
      res.status(HttpStatus.ACCEPTED).json(response)
    } catch (error) {
      next(error)
    }
  }

  const reauthVerify = async (
    req: Request<unknown, unknown, ReauthVerifyInput>,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      await authService.verifyReauth(callerOf(req), req.body.code, clientOf(req))
      const response = createResponse(AUTH_MESSAGE.REAUTHENTICATED)
      res.status(HttpStatus.OK).json(response)
    } catch (error) {
      next(error)
    }
  }

  const refresh = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await authService.refresh(refreshTokenOf(req), clientOf(req))
      sendSession(res, AUTH_MESSAGE.REFRESHED, result)
    } catch (error) {
      // A dead token is useless to the browser; drop it so it stops sending it.
      if (error instanceof AppError && error.status === HttpStatus.UNAUTHORIZED) {
        res.clearCookie(REFRESH_COOKIE, COOKIE_OPTIONS)
      }
      next(error)
    }
  }

  const signOut = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await authService.signOut(refreshTokenOf(req))
      res.clearCookie(REFRESH_COOKIE, COOKIE_OPTIONS)
      const response = createResponse(AUTH_MESSAGE.SIGNED_OUT)
      res.status(HttpStatus.OK).json(response)
    } catch (error) {
      next(error)
    }
  }

  const providers = (_req: Request, res: Response): void => {
    const data: AuthProvidersData = {
      google: authService.googleEnabled,
      phone: authService.phoneEnabled,
    }
    res.status(HttpStatus.OK).json(createResponse(AUTH_MESSAGE.PROVIDERS, data))
  }

  /**
   * Rule 21: in front of every `/auth/phone*` route, before the body or the caller is looked at,
   * so a disabled SMS provider never tells known numbers from unknown ones.
   */
  const phoneGate = (_req: Request, _res: Response, next: NextFunction): void => {
    if (authService.phoneEnabled) {
      next()
      return
    }
    next(
      new AppError(
        AUTH_MESSAGE.PHONE_DISABLED,
        HttpStatus.SERVICE_UNAVAILABLE,
        ErrorSeverity.WARN
      ).withCode(AuthErrorCode.PHONE_DISABLED)
    )
  }

  /** Rule 22: always `202`, SMS or not. */
  const phoneStart = async (
    req: Request<unknown, unknown, PhoneStartInput>,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      await authService.startPhoneSignIn(req.body.phone, clientOf(req))
      const response = createResponse(AUTH_MESSAGE.PHONE_CODE_SENT)
      res.status(HttpStatus.ACCEPTED).json(response)
    } catch (error) {
      next(error)
    }
  }

  /** Rule 24. */
  const phoneVerify = async (
    req: Request<unknown, unknown, PhoneVerifyInput>,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const { phone, code } = req.body
      const result = await authService.verifyPhoneSignIn(phone, code, clientOf(req))
      sendSession(res, AUTH_MESSAGE.SIGNED_IN, result)
    } catch (error) {
      next(error)
    }
  }

  /** Rule 25: add or change the number; the code goes to the new one. */
  const phoneChange = async (
    req: Request<unknown, unknown, PhoneChangeInput>,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const { phone, currentPassword } = req.body
      await authService.startPhoneChange(callerOf(req), phone, currentPassword, clientOf(req))
      const response = createResponse(AUTH_MESSAGE.PHONE_VERIFY_CODE_SENT)
      res.status(HttpStatus.ACCEPTED).json(response)
    } catch (error) {
      next(error)
    }
  }

  const phoneConfirm = async (
    req: Request<unknown, unknown, PhoneConfirmInput>,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const { code, lang } = req.body
      const user = await authService.confirmPhone(callerOf(req), code, lang, clientOf(req))
      const data: AuthUserData = toUserData(user)
      res.status(HttpStatus.OK).json(createResponse(AUTH_MESSAGE.PHONE_SAVED, data))
    } catch (error) {
      next(error)
    }
  }

  const phoneRemove = async (
    req: Request<unknown, unknown, RecentAuthInput>,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const { currentPassword, lang } = req.body
      const user = await authService.removePhone(
        callerOf(req),
        currentPassword,
        lang,
        clientOf(req)
      )
      const data: AuthUserData = toUserData(user)
      res.status(HttpStatus.OK).json(createResponse(AUTH_MESSAGE.PHONE_REMOVED, data))
    } catch (error) {
      next(error)
    }
  }

  /** Rule 14: a top-level navigation from the web app; answers with a redirect to Google. */
  const googleStart = async (
    req: Request<unknown, unknown, unknown, GoogleStartQuery>,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    if (!authService.googleEnabled) {
      next(notFoundGoogle())
      return
    }
    res.set('Cache-Control', 'no-store')
    try {
      const { authorizationUrl, flowToken } = await authService.startGoogleSignIn(
        req.query.returnUrl ?? '/',
        req.query.lang
      )
      setGoogleFlowCookie(res, flowToken)
      res.redirect(HttpStatus.FOUND, authorizationUrl)
    } catch (error) {
      // Google unreachable (discovery): the browser is mid-navigation, so show the web's page.
      ErrorLogger.log(error instanceof Error ? error : new Error(String(error)))
      res.redirect(HttpStatus.FOUND, webCallbackUrl({ error: 'failed' }))
    }
  }

  /** The `?error=` reason for a failed callback; unexpected errors are logged here. */
  const googleFailureReason = (error: unknown, reasons: Map<string, string>): string => {
    const code = error instanceof AppError ? error.code : undefined
    // Domain failures are already logged by the service; anything else is unexpected.
    if (!code) {
      ErrorLogger.log(error instanceof Error ? error : new Error(String(error)))
    }
    return (code && reasons.get(code)) ?? 'failed'
  }

  /**
   * Rules 14 and 29: Google sends the browser here, for a sign-in or a link (the cookie says
   * which). Tokens never go into the redirect URL.
   */
  const googleCallback = async (
    req: Request<unknown, unknown, unknown, GoogleCallbackQuery>,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    if (!authService.googleEnabled) {
      next(notFoundGoogle())
      return
    }
    res.set('Cache-Control', 'no-store')
    const cookies = req.cookies as Record<string, unknown> | undefined
    // eslint-disable-next-line security/detect-object-injection -- a constant key
    const flowCookie = cookies?.[GOOGLE_FLOW_COOKIE]
    const flowToken = typeof flowCookie === 'string' ? flowCookie : undefined
    // One use: whatever happens next, the round trip is over.
    res.clearCookie(GOOGLE_FLOW_COOKIE, GOOGLE_FLOW_COOKIE_OPTIONS)
    const { code, state, error } = req.query

    if ((await authService.googleFlowMode(flowToken)) === 'link') {
      try {
        const result = await authService.finishGoogleLink(
          { code, state, error },
          flowToken,
          clientOf(req)
        )
        res.redirect(HttpStatus.FOUND, webUrl(result.returnUrl, { linked: 'google' }))
      } catch (failure) {
        const reason = googleFailureReason(failure, GOOGLE_LINK_FAILURE_REASONS)
        const params = { error: reason === 'cancelled' ? null : reason }
        res.redirect(HttpStatus.FOUND, webUrl(AUTH_LIMITS.GOOGLE_LINK_RETURN_PATH, params))
      }
      return
    }

    try {
      const result = await authService.finishGoogleSignIn(
        { code, state, error },
        flowToken,
        clientOf(req)
      )
      setRefreshCookie(res, result)
      const returnUrl = result.returnUrl === '/' ? null : result.returnUrl
      const linked = result.linked ? 'google' : null
      res.redirect(HttpStatus.FOUND, webCallbackUrl({ returnUrl, linked }))
    } catch (failure) {
      const reason = googleFailureReason(failure, GOOGLE_FAILURE_REASONS)
      res.redirect(HttpStatus.FOUND, webCallbackUrl({ error: reason }))
    }
  }

  /** Rule 29: an API call (recent auth); the web then navigates to `authorizationUrl`. */
  const googleLink = async (
    req: Request<unknown, unknown, RecentAuthInput>,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const { currentPassword, lang } = req.body
      const { authorizationUrl, flowToken } = await authService.startGoogleLink(
        callerOf(req),
        currentPassword,
        lang,
        clientOf(req)
      )
      setGoogleFlowCookie(res, flowToken)
      const data: AuthGoogleLinkData = { authorizationUrl }
      res.status(HttpStatus.OK).json(createResponse(AUTH_MESSAGE.GOOGLE_LINK_STARTED, data))
    } catch (error) {
      next(error)
    }
  }

  /** Rule 30. */
  const googleUnlink = async (
    req: Request<unknown, unknown, RecentAuthInput>,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const { currentPassword, lang } = req.body
      const user = await authService.unlinkGoogle(
        callerOf(req),
        currentPassword,
        lang,
        clientOf(req)
      )
      res.status(HttpStatus.OK).json(createResponse(AUTH_MESSAGE.GOOGLE_UNLINKED, toUserData(user)))
    } catch (error) {
      next(error)
    }
  }

  /** Rule 28. */
  const sessions = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const list = await authService.listSessions(callerOf(req))
      const data: AuthDeviceSessionData[] = list.map(toDeviceSessionData)
      res.status(HttpStatus.OK).json(createResponse(AUTH_MESSAGE.SESSIONS, data))
    } catch (error) {
      next(error)
    }
  }

  const sessionRevoke = async (
    req: Request<SessionParams>,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      await authService.revokeSession(callerOf(req), req.params.id)
      res.status(HttpStatus.OK).json(createResponse(AUTH_MESSAGE.SESSION_SIGNED_OUT))
    } catch (error) {
      next(error)
    }
  }

  const sessionsRevokeOthers = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const revoked = await authService.revokeOtherSessions(callerOf(req))
      const data: AuthSessionsRevokedData = { revoked }
      res.status(HttpStatus.OK).json(createResponse(AUTH_MESSAGE.OTHER_SESSIONS_SIGNED_OUT, data))
    } catch (error) {
      next(error)
    }
  }

  const me = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = await authService.getMe(callerOf(req).userId)
      const data: AuthUserData = toUserData(user)
      const response = createResponse(AUTH_MESSAGE.SIGNED_IN, data)
      res.status(HttpStatus.OK).json(response)
    } catch (error) {
      next(error)
    }
  }

  return {
    emailStart,
    emailVerify,
    passwordSignIn,
    passwordSet,
    passwordRemove,
    reauthStart,
    reauthVerify,
    refresh,
    signOut,
    me,
    providers,
    phoneGate,
    phoneStart,
    phoneVerify,
    phoneChange,
    phoneConfirm,
    phoneRemove,
    googleStart,
    googleCallback,
    googleLink,
    googleUnlink,
    sessions,
    sessionRevoke,
    sessionsRevokeOthers,
  }
}

export type AuthController = ReturnType<typeof createAuthController>
