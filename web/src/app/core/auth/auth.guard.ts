import { inject } from '@angular/core'
import { Router } from '@angular/router'
import type { CanActivateFn } from '@angular/router'
import { SIGN_IN_URL } from './auth.interceptor'
import { AuthService } from './auth.service'

/** Only a path inside this app, never `//evil.example` or a full URL. */
export const safeReturnUrl = (url: unknown): string =>
  typeof url === 'string' && url.startsWith('/') && !url.startsWith('//') ? url : '/'

/** In-app pages: signed in, or off to sign-in (remembering where the user was going). */
export const authGuard: CanActivateFn = async (_route, state) => {
  const router = inject(Router)
  if ((await inject(AuthService).restore()) === 'signedIn') {
    return true
  }
  const returnUrl = state.url === '/' ? undefined : state.url
  return router.createUrlTree([SIGN_IN_URL], { queryParams: { returnUrl } })
}

/** Sign-in pages: someone already signed in goes straight into the app. */
export const guestGuard: CanActivateFn = async (route) => {
  const router = inject(Router)
  if ((await inject(AuthService).restore()) === 'signedIn') {
    return router.parseUrl(safeReturnUrl(route.queryParamMap.get('returnUrl')))
  }
  return true
}
