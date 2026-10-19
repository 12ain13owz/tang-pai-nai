import { Router } from 'express'
import { authenticate, requireOrigin, validate } from '@/core/middleware'
import { authSchema } from './auth.schema'
import type { AuthController } from './auth.controller'

export const createAuthRouter = (authController: AuthController, webOrigin: string): Router => {
  const router = Router()
  // Routes that act on the refresh cookie only accept the web app's own origin (rule 16).
  const sameOrigin = requireOrigin(webOrigin)

  router.post('/email/start', validate(authSchema.emailStart), authController.emailStart)
  router.post('/email/verify', validate(authSchema.emailVerify), authController.emailVerify)
  router.post('/refresh', sameOrigin, authController.refresh)
  router.post('/sign-out', sameOrigin, authController.signOut)
  router.get('/me', authenticate, authController.me)

  return router
}
