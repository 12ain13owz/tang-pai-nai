import { AppError } from '@/core/error'
import { ERRORS, ErrorSeverity, HttpStatus } from '@/shared/constants'
import { createResponse } from '@/shared/utils'
import { SYNC_MESSAGE } from './sync.const'
import type { PullResult } from './sync.entity'
import type { SyncPullQuery, SyncPushBody } from './sync.schema'
import type { SyncService } from './sync.service'
import type { SyncPushData } from './sync.type'
import type { NextFunction, Request, Response } from 'express'

/** `req.auth.userId`, set by `authenticate` in front of every sync route. */
const userIdOf = <P, B, Q>(req: Request<P, unknown, B, Q>): string => {
  if (!req.auth) {
    throw new AppError(ERRORS.UNAUTHORIZED, HttpStatus.UNAUTHORIZED, ErrorSeverity.WARN)
  }
  return req.auth.userId
}

export const createSyncController = (syncService: SyncService) => {
  const pull = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = userIdOf(req)
      // Already parsed (coerced, defaults filled) by validate(); Express types it as ParsedQs.
      const query = req.query as unknown as SyncPullQuery
      const data: PullResult = await syncService.pull(userId, query)
      const response = createResponse(SYNC_MESSAGE.PULLED, data)
      res.status(HttpStatus.OK).json(response)
    } catch (error) {
      next(error)
    }
  }

  const push = async (
    req: Request<unknown, unknown, SyncPushBody>,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const userId = userIdOf(req)
      const data: SyncPushData = {
        results: await syncService.push(userId, req.body.deviceId, req.body.ops),
      }
      const response = createResponse(SYNC_MESSAGE.PUSHED, data)
      res.status(HttpStatus.OK).json(response)
    } catch (error) {
      next(error)
    }
  }

  return { pull, push }
}

export type SyncController = ReturnType<typeof createSyncController>
