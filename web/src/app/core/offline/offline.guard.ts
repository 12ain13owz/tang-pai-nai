import { inject } from '@angular/core'
import { Router } from '@angular/router'
import type { CanActivateFn } from '@angular/router'
import { AuthService, AuthStore, SIGN_IN_URL } from '@/core/auth'
import { LOCK_URL, OfflineService, OTHER_TAB_URL } from './offline.service'

export const TRUST_URL = '/auth/trust'

/**
 * The app shell (replaces `authGuard` there): a signed-in user, or a trusted device unlocked
 * with its PIN (docs/features/offline-sync.md rules 1–3 and 7).
 *
 * - Trusted device: wiped first when the session was revoked or someone else signed in;
 *   otherwise it opens once this tab holds the app and the PIN was entered, even offline or
 *   with an expired session.
 * - Untrusted device: signed in, and right after a sign-in the trust step comes first.
 */
export const shellGuard: CanActivateFn = async (_route, state) => {
  const router = inject(Router)
  const authStore = inject(AuthStore)
  const offlineService = inject(OfflineService)
  const [status, meta] = await Promise.all([inject(AuthService).restore(), offlineService.ready()])
  const queryParams = { returnUrl: state.url === '/' ? undefined : state.url }

  if (meta && (authStore.endedBy() === 'revoked' || offlineService.belongsToSomeoneElse())) {
    await offlineService.wipe()
  } else if (meta) {
    authStore.freshSignIn.set(false) // the same user again: this device is already trusted
    if (!(await offlineService.claimTab())) {
      return router.createUrlTree([OTHER_TAB_URL], { queryParams })
    }
    return offlineService.state() === 'unlocked'
      ? true
      : router.createUrlTree([LOCK_URL], { queryParams })
  }

  if (status !== 'signedIn') {
    return router.createUrlTree([SIGN_IN_URL], { queryParams })
  }
  return authStore.freshSignIn() ? router.createUrlTree([TRUST_URL], { queryParams }) : true
}

/** The trust step: only for a device that isn't trusted yet (`authGuard` runs first). */
export const trustGuard: CanActivateFn = async () => {
  const router = inject(Router) // before any await: `inject` only works synchronously
  const meta = await inject(OfflineService).ready()
  return meta ? router.parseUrl('/') : true
}

/** The lock screen: only while a trusted device is locked. */
export const lockGuard: CanActivateFn = async () => {
  const router = inject(Router)
  const offlineService = inject(OfflineService)
  const meta = await offlineService.ready()
  return meta && offlineService.state() === 'locked' ? true : router.parseUrl('/')
}

/** "Open in another tab": only while another tab holds the app. */
export const otherTabGuard: CanActivateFn = () =>
  inject(OfflineService).state() === 'elsewhere' ? true : inject(Router).parseUrl('/')
