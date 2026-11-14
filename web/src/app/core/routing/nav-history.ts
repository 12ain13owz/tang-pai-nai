import { Location } from '@angular/common'
import { inject, Service, signal } from '@angular/core'
import { NavigationEnd, NavigationStart, Router } from '@angular/router'

/**
 * Where a page inside a tab sits: `/account/<page>` → `/account` (password, phone and PIN →
 * `/account/security`); a debt's page →
 * `/wallets/debts` → `/wallets`; an event's → `/transactions/events` → `/transactions`; a report
 * page one level up (`/reports/category/<id>/<sub>` → `/reports/category/<id>` → `/reports`);
 * null on a tab's own page. The header's ‹ goes there when there is no page to go back to.
 */
export const parentOf = (url: string): string | null => {
  const path = url.split(/[?#]/)[0]
  // Opened from Account › Security, so they go back there.
  if (/^\/account\/(password|phone|pin)$/.test(path)) {
    return '/account/security'
  }
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

/** How many ‹ a page is below its tab's own page (0 on the tab itself). */
export const levelOf = (url: string): number => {
  let level = 0
  for (let parent = parentOf(url); parent !== null; parent = parentOf(parent)) {
    level++
  }
  return level
}

/** The URL's own bottom tab: its first segment (`/account/recurring` → `account`). */
const ownTab = (url: string): string => url.split(/[/?#]/)[1] ?? ''

interface Entry {
  /** The router's navigation id, kept in the history entry's state (`navigationId`). */
  id: number
  url: string
  /** The bottom tab the page belongs to while it shows: the one it was opened from. */
  tab: string
}

/**
 * The app's own copy of the browser history, so the header's ‹ works like a navigation stack
 * (DESIGN.md §7, owner 2026-11): it goes back to the page it was opened from (the debts from the
 * Transactions tab's ⋮ go back there, not to the Wallets tab), and only a page opened directly
 * (a link, a reload) goes up to `parentOf`. A page opened from another tab keeps that tab lit
 * in the bottom bar (`tab`), and `step` tells the shell which way a page slides in.
 */
@Service()
export class NavHistory {
  private router = inject(Router)
  private location = inject(Location)
  private entries: Entry[] = []
  private index = -1
  /** Per navigation id: whether it replaces the current entry, and the entry it restores. */
  private starts = new Map<number, { replace: boolean; restores: number | null }>()

  /** The bottom tab lit for the page in view. */
  tab = signal('')
  /**
   * Moves +1 for a page opened deeper inside the same tab and −1 for going back up; switching
   * tabs leaves it, since a new tab fades in instead (`appSlide` on the shell's page). It starts
   * high, so going up from a page opened directly never takes it below 0 (where `appSlide` stops).
   */
  step = signal(1_000)

  constructor() {
    this.router.events.subscribe((event) => {
      if (event instanceof NavigationStart) {
        this.starts.set(event.id, {
          replace: this.router.currentNavigation()?.extras.replaceUrl === true,
          restores: event.restoredState?.navigationId ?? null,
        })
      } else if (event instanceof NavigationEnd) {
        const start = this.starts.get(event.id)
        this.starts.clear()
        this.record(
          event.id,
          event.urlAfterRedirects,
          start?.replace ?? false,
          start?.restores ?? null
        )
      }
    })
  }

  /** The header's ‹ (and a page's own back or "done"): the page it came from, else its parent. */
  back(): void {
    if (this.index > 0) {
      this.location.back()
      return
    }
    const parent = parentOf(this.router.url)
    if (parent) {
      // Replaced, so the page left behind isn't one ‹ away afterwards.
      void this.router.navigateByUrl(parent, { replaceUrl: true })
    }
  }

  private record(id: number, url: string, replace: boolean, restores: number | null): void {
    const before = this.entry(this.index)
    if (restores !== null) {
      const found = this.entries.findIndex((entry) => entry.id === restores)
      if (found >= 0) {
        this.index = found
      } else {
        // A history entry from before this app loaded (a reload): start the copy here.
        this.entries = [{ id: restores, url, tab: ownTab(url) }]
        this.index = 0
      }
    } else if (replace && before) {
      const tab = ownTab(url) === ownTab(before.url) ? before.tab : this.tabFor(url, this.index - 1)
      this.entries[this.index] = { id, url, tab }
    } else {
      this.entries = [
        ...this.entries.slice(0, this.index + 1),
        { id, url, tab: this.tabFor(url, this.index) },
      ]
      this.index = this.entries.length - 1
    }
    const after = this.entries[this.index]
    if (before && before.tab === after.tab) {
      const move = Math.sign(levelOf(after.url) - levelOf(before.url))
      if (move !== 0) {
        this.step.update((step) => step + move)
      }
    }
    this.tab.set(after.tab)
  }

  /** A tab's own page lights itself; a page inside one lights the tab it was opened from. */
  private tabFor(url: string, from: number): string {
    if (levelOf(url) === 0) {
      return ownTab(url)
    }
    return this.entry(from)?.tab ?? ownTab(url)
  }

  private entry(index: number): Entry | undefined {
    return index >= 0 ? this.entries[index] : undefined
  }
}
