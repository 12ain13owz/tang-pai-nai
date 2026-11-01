import { inject } from '@angular/core'
import { toSignal } from '@angular/core/rxjs-interop'
import { NavigationEnd, Router } from '@angular/router'
import { filter, map } from 'rxjs'

/** The tabs that show a profile's data: the switcher and the create step live there. */
const PROFILE_TABS = ['/transactions', '/wallets', '/reports']

/** The tabs that need a wallet: the first-wallet step lives there (wallet rule 12). */
const WALLET_TABS = ['/transactions', '/wallets']

const under = (tabs: readonly string[], url: string): boolean =>
  tabs.some((tab) => url === tab || url.startsWith(`${tab}/`) || url.startsWith(`${tab}?`))

export const isProfileTab = (url: string): boolean => under(PROFILE_TABS, url)

export const isWalletTab = (url: string): boolean => under(WALLET_TABS, url)

/**
 * Where the header's ‹ goes from a page inside the Account tab (`/account/<page>` → `/account`),
 * or null on a tab's own page.
 */
export const parentOf = (url: string): string | null => {
  const path = url.split(/[?#]/)[0]
  return /^\/account\/[^/]+/.test(path) ? '/account' : null
}

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
