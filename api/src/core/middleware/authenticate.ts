import { AppError } from '@/core/error'
import { accessTokens } from '@/core/security'
import { ERRORS, ErrorSeverity, HttpStatus } from '@/shared/constants'
import type { NextFunction, Request, Response } from 'express'

const BEARER = /^Bearer (\S+)$/

/**
 * Requires a valid access token (`Authorization: Bearer <jwt>`) and sets `req.auth`. Any failure
 * is a `401`, which is the web app's cue to refresh once and retry (auth spec rule 15).
 */
export const authenticate = async (
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> => {
  const token = BEARER.exec(req.get('authorization') ?? '')?.[1]
  const claims = token ? await accessTokens.verify(token) : null

  if (!claims) {
    next(
      new AppError(ERRORS.UNAUTHORIZED, HttpStatus.UNAUTHORIZED, ErrorSeverity.WARN).withOperation(
        'authenticate'
      )
    )
    return
  }

  req.auth = { userId: claims.sub, sessionFamilyId: claims.sid }
  next()
}
