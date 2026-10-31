import { Router } from 'express'
import { authenticate, validate } from '@/core/middleware'
import { syncSchema } from './sync.schema'
import type { SyncController } from './sync.controller'

export const createSyncRouter = (syncController: SyncController): Router => {
  const router = Router()

  router.get('/pull', authenticate, validate(syncSchema.pull), syncController.pull)
  router.post('/push', authenticate, validate(syncSchema.push), syncController.push)

  return router
}
