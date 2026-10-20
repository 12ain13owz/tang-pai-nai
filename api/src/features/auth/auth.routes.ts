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
  // Rules 21–25 (4.4b): `503` before anything else while SMS is off.
  router.use('/phone', authController.phoneGate)
  router.post('/phone/start', validate(authSchema.phoneStart), authController.phoneStart)
  router.post('/phone/verify', validate(authSchema.phoneVerify), authController.phoneVerify)
  router.post(
    '/phone/confirm',
    authenticate,
    validate(authSchema.phoneConfirm),
    authController.phoneConfirm
  )
  router.post('/phone', authenticate, validate(authSchema.phoneChange), authController.phoneChange)
  router.delete(
    '/phone',
    authenticate,
    validate(authSchema.phoneRemove),
    authController.phoneRemove
  )
  router.post('/refresh', sameOrigin, authController.refresh)
  router.post('/sign-out', sameOrigin, authController.signOut)
  router.get('/me', authenticate, authController.me)
  router.get('/providers', authController.providers)
  // Top-level navigations (no Origin check): the browser comes and goes through Google (rule 14).
  router.get('/google/start', validate(authSchema.googleStart), authController.googleStart)
  router.get('/google/callback', validate(authSchema.googleCallback), authController.googleCallback)
  // Rules 29–30: linking is an API call that hands back Google's URL, not a navigation.
  router.post(
    '/google/link',
    authenticate,
    validate(authSchema.googleLink),
    authController.googleLink
  )
  router.delete(
    '/google/link',
    authenticate,
    validate(authSchema.googleUnlink),
    authController.googleUnlink
  )
  router.get('/sessions', authenticate, authController.sessions)
  router.delete('/sessions', authenticate, authController.sessionsRevokeOthers)
  router.delete(
    '/sessions/:id',
    authenticate,
    validate(authSchema.sessionRevoke),
    authController.sessionRevoke
  )

  return router
}
