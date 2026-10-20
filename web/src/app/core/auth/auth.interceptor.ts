import { HttpErrorResponse } from '@angular/common/http'
import type { HttpInterceptorFn, HttpRequest } from '@angular/common/http'
import { inject } from '@angular/core'
import { Router } from '@angular/router'
import { catchError, from, switchMap, throwError } from 'rxjs'
import { isUnreachable, toApiError } from '@/core/api'
import { SKIP_AUTH_REFRESH } from './auth.context'
import { AuthService } from './auth.service'
import { AuthStore } from './auth.store'

export const SIGN_IN_URL = '/auth/sign-in'

/**
 * Adds the access token to `/api` calls. On a `401` it refreshes once and retries; if the refresh
 * fails too, it sends the user to sign-in (auth spec rule 15).
 */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  if (!req.url.startsWith('/api/')) {
    return next(req)
  }
  const authStore = inject(AuthStore)
  const authService = inject(AuthService)
  const router = inject(Router)

  const withToken = (request: HttpRequest<unknown>) => {
    const token = authStore.accessToken()
    return token ? request.clone({ setHeaders: { Authorization: `Bearer ${token}` } }) : request
  }

  if (req.context.get(SKIP_AUTH_REFRESH)) {
    return next(withToken(req))
  }

  return next(withToken(req)).pipe(
    catchError((error: unknown) => {
      if (!(error instanceof HttpErrorResponse) || error.status !== 401) {
        return throwError(() => error)
      }
      return from(authService.refresh()).pipe(
        catchError((refreshError: unknown) => {
          // A trusted device keeps working on its local data after an expiry (offline-sync rule 7);
          // its banner offers sign-in instead.
          const keepsLocal = authStore.keepsLocalSession() && authStore.endedBy() !== 'revoked'
          if (!isUnreachable(toApiError(refreshError)) && !keepsLocal) {
            void router.navigate([SIGN_IN_URL], { queryParams: { returnUrl: router.url } })
          }
          return throwError(() => error)
        }),
        switchMap(() => next(withToken(req)))
      )
    })
  )
}
