import { Router } from 'express'
import { authenticate, requireCronSecret, validate } from '@/core/middleware'
import { syncSchema } from './sync.schema'
import type { SyncController } from './sync.controller'

export const createSyncRouter = (syncController: SyncController, cronSecret?: string): Router => {
  const router = Router()

  router.get('/pull', authenticate, validate(syncSchema.pull), syncController.pull)
  router.post('/push', authenticate, validate(syncSchema.push), syncController.push)
  // Rule 9: the daily cleanup, called by Vercel Cron with `CRON_SECRET`.
  router.get('/cleanup', requireCronSecret(cronSecret), syncController.cleanup)

  return router
}
