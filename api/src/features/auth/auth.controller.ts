import { AppError } from '@/core/error'
import { ERRORS, ErrorSeverity, HttpStatus } from '@/shared/constants'
import { createResponse } from '@/shared/utils'
import { AUTH_LIMITS, AUTH_MESSAGE, REFRESH_COOKIE } from './auth.const'
import type { ClientContext, SignInResult, User } from './auth.entity'
import type { EmailStartInput, EmailVerifyInput } from './auth.schema'
import type { AuthService } from './auth.service'
import type { AuthSessionData, AuthUserData } from './auth.type'
import type { CookieOptions, NextFunction, Request, Response } from 'express'

// `__Host-` requires Secure, Path=/ and no Domain (auth spec → Tokens & session).
const COOKIE_OPTIONS: CookieOptions = {
  httpOnly: true,
  secure: true,
  sameSite: 'strict',
  path: '/',
}

const toUserData = (user: User): AuthUserData => ({
  id: user.id,
  email: user.email,
  displayName: user.displayName,
  avatarUrl: user.avatarUrl,
  timezone: user.timezone,
})

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

export const createAuthController = (authService: AuthService) => {
  // Strips the raw refresh token out of the body: it only ever travels in the cookie.
  const sendSession = (res: Response, message: string, result: SignInResult): void => {
    const { refreshToken, refreshExpiresAt, accessToken, expiresIn, user } = result
    res.cookie(REFRESH_COOKIE, refreshToken, { ...COOKIE_OPTIONS, expires: refreshExpiresAt })
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

  const me = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.auth) {
        throw new AppError(ERRORS.UNAUTHORIZED, HttpStatus.UNAUTHORIZED, ErrorSeverity.WARN)
      }
      const user = await authService.getMe(req.auth.userId)
      const data: AuthUserData = toUserData(user)
      const response = createResponse(AUTH_MESSAGE.SIGNED_IN, data)
      res.status(HttpStatus.OK).json(response)
    } catch (error) {
      next(error)
    }
  }

  return { emailStart, emailVerify, refresh, signOut, me }
}

export type AuthController = ReturnType<typeof createAuthController>
