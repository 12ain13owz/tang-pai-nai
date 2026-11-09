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
 * Where the header's ‹ goes from a page inside a tab: `/account/<page>` → `/account`; a debt's
 * page → `/wallets/debts` → `/wallets`; an event's → `/transactions/events` → `/transactions`; a report page one level up (`/reports/category/<id>/<sub>` → `/reports/category/<id>` → `/reports`);
 * null on a tab's own page.
 */
export const parentOf = (url: string): string | null => {
  const path = url.split(/[?#]/)[0]
  if (/^\/account\/[^/]+/.test(path)) {
    return '/account'
  }
  // A debt's page goes back to the debts, the debts to the Wallets tab (debt.md).
  if (/^\/wallets\/debts\/[^/]+/.test(path)) {
    return '/wallets/debts'
  }
  if (path === '/wallets/debts') {
    return '/wallets'
  }
  // An event's page goes back to the events, the events to the Transactions tab (event.md).
  if (/^\/transactions\/events\/[^/]+/.test(path)) {
    return '/transactions/events'
  }
  if (path === '/transactions/events') {
    return '/transactions'
  }
  const report = /^\/reports\/category\/([^/]+)\/[^/]+/.exec(path)
  if (report) {
    return `/reports/category/${report[1]}`
  }
  return /^\/reports\/.+/.test(path) ? '/reports' : null
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

/** The Reports tab's own page, headed like the Transactions tab (report.md). */
export const isReportsTab = (url: string): boolean => url.split(/[?#]/)[0] === '/reports'

/** The Transactions tab's own page, whose header holds the wallet switcher (#8). */
export const isTransactionsTab = (url: string): boolean => url.split(/[?#]/)[0] === '/transactions'
