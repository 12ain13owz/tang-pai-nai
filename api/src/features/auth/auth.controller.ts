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
import type { Caller, ClientContext, SignInResult, UserProfile } from './auth.entity'
import type {
  EmailStartInput,
  EmailVerifyInput,
  GoogleCallbackQuery,
  GoogleStartQuery,
  PasswordRemoveInput,
  PasswordSetInput,
  PasswordSignInInput,
  ReauthStartInput,
  ReauthVerifyInput,
} from './auth.schema'
import type { AuthService } from './auth.service'
import type { AuthProvidersData, AuthSessionData, AuthUserData } from './auth.type'
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

  const webCallbackUrl = (params: Record<string, string | null>): string => {
    const url = new URL('/auth/callback', config.webOrigin)
    for (const [key, value] of Object.entries(params)) {
      if (value !== null) {
        url.searchParams.set(key, value)
      }
    }
    return url.toString()
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
    req: Request<unknown, unknown, PasswordRemoveInput>,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const { currentPassword } = req.body
      const user = await authService.removePassword(callerOf(req), currentPassword, clientOf(req))
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
    const data: AuthProvidersData = { google: authService.googleEnabled }
    res.status(HttpStatus.OK).json(createResponse(AUTH_MESSAGE.PROVIDERS, data))
  }

  /** Rule 14: a top-level navigation from the web app; answers with a redirect to Google. */
  const googleStart = async (
    req: Request<unknown, unknown, unknown, GoogleStartQuery>,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    if (!authService.googleEnabled) {
      next(
        new AppError(ERRORS.notFound(AUTH_MESSAGE.GOOGLE), HttpStatus.NOT_FOUND, ErrorSeverity.WARN)
      )
      return
    }
    res.set('Cache-Control', 'no-store')
    try {
      const { authorizationUrl, flowToken } = await authService.startGoogleSignIn(
        req.query.returnUrl ?? '/'
      )
      res.cookie(GOOGLE_FLOW_COOKIE, flowToken, {
        ...GOOGLE_FLOW_COOKIE_OPTIONS,
        maxAge: AUTH_LIMITS.GOOGLE_FLOW_TTL_MS,
      })
      res.redirect(HttpStatus.FOUND, authorizationUrl)
    } catch (error) {
      // Google unreachable (discovery): the browser is mid-navigation, so show the web's page.
      ErrorLogger.log(error instanceof Error ? error : new Error(String(error)))
      res.redirect(HttpStatus.FOUND, webCallbackUrl({ error: 'failed' }))
    }
  }

  /** Rule 14: Google sends the browser here. Tokens never go into the redirect URL. */
  const googleCallback = async (
    req: Request<unknown, unknown, unknown, GoogleCallbackQuery>,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    if (!authService.googleEnabled) {
      next(
        new AppError(ERRORS.notFound(AUTH_MESSAGE.GOOGLE), HttpStatus.NOT_FOUND, ErrorSeverity.WARN)
      )
      return
    }
    res.set('Cache-Control', 'no-store')
    const cookies = req.cookies as Record<string, unknown> | undefined
    // eslint-disable-next-line security/detect-object-injection -- a constant key
    const flowCookie = cookies?.[GOOGLE_FLOW_COOKIE]
    // One use: whatever happens next, the round trip is over.
    res.clearCookie(GOOGLE_FLOW_COOKIE, GOOGLE_FLOW_COOKIE_OPTIONS)
    try {
      const { code, state, error } = req.query
      const result = await authService.finishGoogleSignIn(
        { code, state, error },
        typeof flowCookie === 'string' ? flowCookie : undefined,
        clientOf(req)
      )
      setRefreshCookie(res, result)
      const returnUrl = result.returnUrl === '/' ? null : result.returnUrl
      const linked = result.linked ? 'google' : null
      res.redirect(HttpStatus.FOUND, webCallbackUrl({ returnUrl, linked }))
    } catch (error) {
      const code = error instanceof AppError ? error.code : undefined
      const reason = (code && GOOGLE_FAILURE_REASONS.get(code)) ?? 'failed'
      // Domain failures are already logged by the service; anything else is unexpected.
      if (!code) {
        ErrorLogger.log(error instanceof Error ? error : new Error(String(error)))
      }
      res.redirect(HttpStatus.FOUND, webCallbackUrl({ error: reason }))
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
    googleStart,
    googleCallback,
  }
}

export type AuthController = ReturnType<typeof createAuthController>
