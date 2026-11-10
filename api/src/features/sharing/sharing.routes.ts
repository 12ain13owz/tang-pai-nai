import { Router } from 'express'
import { authenticate, validate } from '@/core/middleware'
import { sharingSchema as s } from './sharing.schema'
import type { SharingController } from './sharing.controller'

export const createSharingRouter = (c: SharingController): Router => {
  const router = Router()
  router.use(authenticate)

  // Owner (docs/features/sharing.md → Endpoints)
  router.get('/profiles/:profileId', validate(s.ofProfile), c.ofProfile)
  router.post('/profiles/:profileId/invites', validate(s.invite), c.invite)
  router.put('/profiles/:profileId/members/:userId', validate(s.member), c.updateMember)
  router.delete('/profiles/:profileId/members/:userId', validate(s.byMember), c.removeMember)
  router.post('/invites/:id/resend', validate(s.resend), c.resend)
  router.delete('/invites/:id', validate(s.byInvite), c.cancel)

  // Member
  router.get('/with-me', c.withMe)
  router.delete('/with-me/:profileId', validate(s.leave), c.leave)
  router.post('/invites/:id/accept', validate(s.byInvite), c.accept)
  router.post('/invites/:id/decline', validate(s.byInvite), c.decline)
  router.get('/with-me/:profileId/rows', validate(s.rows), c.rows)

  return router
}
