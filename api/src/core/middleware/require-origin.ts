import { AppError } from '@/core/error'
import { ERRORS, ErrorSeverity, HttpStatus } from '@/shared/constants'
import type { NextFunction, Request, RequestHandler, Response } from 'express'

/**
 * Rejects a request whose `Origin` header isn't exactly `origin` (`403`). Routes that act on a
 * cookie use it as CSRF defence in depth on top of `SameSite=Strict` (auth spec rule 16). Browsers
 * always send `Origin` on a POST, so a missing one is refused too.
 */
export const requireOrigin =
  (origin: string): RequestHandler =>
  (req: Request, _res: Response, next: NextFunction): void => {
    if (req.get('origin') === origin) {
      next()
      return
    }
    next(
      new AppError(ERRORS.FORBIDDEN, HttpStatus.FORBIDDEN, ErrorSeverity.WARN)
        .withOperation('requireOrigin')
        .withMetadata({ origin: req.get('origin') ?? null })
    )
  }
