import { inject } from '@angular/core'
import { Router } from '@angular/router'
import type { CanActivateFn } from '@angular/router'
import { AuthService, AuthStore, SIGN_IN_URL } from '@/core/auth'
import { LOCK_URL, OfflineService, OTHER_TAB_URL } from './offline.service'

/**
 * The app shell (replaces `authGuard` there): the device's local data, opened (docs/features/
 * offline-sync.md rules 1–3 and 7).
 *
 * - Local data here: wiped first when the session was revoked or someone else signed in. A session
 *   the server refused (expired) goes to sign-in, the data kept; offline or with the server down
 *   it opens anyway. It opens once this tab holds the app (and, with the PIN on, the PIN was
 *   entered).
 * - None yet: signed in, and the local database is made now (rule 1).
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
    if (status === 'signedOut') {
      return router.createUrlTree([SIGN_IN_URL], { queryParams })
    }
    if (!(await offlineService.claimTab())) {
      return router.createUrlTree([OTHER_TAB_URL], { queryParams })
    }
    if (offlineService.hasPin()) {
      return offlineService.state() === 'unlocked'
        ? true
        : router.createUrlTree([LOCK_URL], { queryParams })
    }
    // PIN off (rule 2): open at once. A vault it can't open is no use to anyone: start afresh.
    if (await offlineService.open()) {
      return true
    }
    await offlineService.wipe()
  }

  if (status !== 'signedIn') {
    return router.createUrlTree([SIGN_IN_URL], { queryParams })
  }
  if (offlineService.isOpen()) {
    return true
  }
  // Rule 1: the first open on this device makes its local database; the first pull fills it.
  try {
    await offlineService.enable()
  } catch (error) {
    // Browser storage refused (a locked-down private window): work in memory for this tab.
    console.error('Making the local database failed', error)
    await offlineService.openInMemory()
  }
  return true
}

/** The lock screen: only while a device with a PIN is locked. */
export const lockGuard: CanActivateFn = async () => {
  const router = inject(Router)
  const offlineService = inject(OfflineService)
  const meta = await offlineService.ready()
  return meta && offlineService.hasPin() && offlineService.state() === 'locked'
    ? true
    : router.parseUrl('/')
}

/** "Open in another tab": only while another tab holds the app. */
export const otherTabGuard: CanActivateFn = () =>
  inject(OfflineService).state() === 'elsewhere' ? true : inject(Router).parseUrl('/')
