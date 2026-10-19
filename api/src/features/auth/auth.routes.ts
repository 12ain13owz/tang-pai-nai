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
  router.post(
    '/password/sign-in',
    validate(authSchema.passwordSignIn),
    authController.passwordSignIn
  )
  router.put(
    '/password',
    authenticate,
    validate(authSchema.passwordSet),
    authController.passwordSet
  )
  router.delete(
    '/password',
    authenticate,
    validate(authSchema.passwordRemove),
    authController.passwordRemove
  )
  router.post(
    '/reauth/start',
    authenticate,
    validate(authSchema.reauthStart),
    authController.reauthStart
  )
  router.post(
    '/reauth/verify',
    authenticate,
    validate(authSchema.reauthVerify),
    authController.reauthVerify
  )
  router.post('/refresh', sameOrigin, authController.refresh)
  router.post('/sign-out', sameOrigin, authController.signOut)
  router.get('/me', authenticate, authController.me)
  router.get('/providers', authController.providers)
  // Top-level navigations (no Origin check): the browser comes and goes through Google (rule 14).
  router.get('/google/start', validate(authSchema.googleStart), authController.googleStart)
  router.get('/google/callback', validate(authSchema.googleCallback), authController.googleCallback)

  return router
}
