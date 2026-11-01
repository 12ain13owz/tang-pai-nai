import { inject } from '@angular/core'
import { toSignal } from '@angular/core/rxjs-interop'
import { NavigationEnd, Router } from '@angular/router'
import { filter, map } from 'rxjs'

/** The tabs that show a profile's data: the switcher and the create step live there. */
const PROFILE_TABS = ['/transactions', '/wallets', '/reports']

export const isProfileTab = (url: string): boolean =>
  PROFILE_TABS.some((tab) => url === tab || url.startsWith(`${tab}/`) || url.startsWith(`${tab}?`))

/** The current URL as a signal (call in an injection context). */
export const currentUrl = () => {
  const router = inject(Router)
  return toSignal(
    router.events.pipe(
      filter((event) => event instanceof NavigationEnd),
      map((event) => event.urlAfterRedirects)
    ),
    { initialValue: router.url }
  )
}
