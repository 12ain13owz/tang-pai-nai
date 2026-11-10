import { createHash, timingSafeEqual } from 'node:crypto'
import { AppError, NotFoundError } from '@/core/error'
import { ERRORS, ErrorSeverity, HttpStatus } from '@/shared/constants'
import type { NextFunction, Request, RequestHandler, Response } from 'express'

const digest = (value: string): Buffer => createHash('sha256').update(value).digest()

/**
 * Guards a scheduled job's route (Vercel Cron calls it with `Authorization: Bearer <secret>`).
 * Without a secret the route doesn't exist (`404`); a wrong or missing bearer is `401`. The
 * values are compared as SHA-256 digests in constant time.
 */
export const requireCronSecret =
  (secret: string | undefined): RequestHandler =>
  (req: Request, _res: Response, next: NextFunction): void => {
    if (!secret) {
      next(new NotFoundError('Route').withOperation('requireCronSecret'))
      return
    }
    const sent = /^Bearer (.+)$/.exec(req.get('authorization') ?? '')?.[1] ?? ''
    if (timingSafeEqual(digest(sent), digest(secret))) {
      next()
      return
    }
    next(
      new AppError(ERRORS.UNAUTHORIZED, HttpStatus.UNAUTHORIZED, ErrorSeverity.WARN).withOperation(
        'requireCronSecret'
      )
    )
  }
