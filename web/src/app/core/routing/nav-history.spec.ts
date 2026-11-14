import { Location } from '@angular/common'
import { provideLocationMocks } from '@angular/common/testing'
import { Component } from '@angular/core'
import { TestBed } from '@angular/core/testing'
import { NavigationEnd, provideRouter, Router } from '@angular/router'
import { filter, firstValueFrom } from 'rxjs'
import { levelOf, NavHistory, parentOf } from './nav-history'

describe('parentOf', () => {
  it('goes back to the Account tab from a page inside it (owner A1 in #7)', () => {
    for (const url of ['/account/categories', '/account/profiles?fix=o1', '/account/security#x']) {
      expect(parentOf(url)).toBe('/account')
    }
  })

  it('goes back to Security from the pages it opens', () => {
    for (const url of ['/account/password', '/account/phone', '/account/pin?x=1']) {
      expect(parentOf(url)).toBe('/account/security')
    }
  })

  it('goes one level up from a report page (report.md Q5)', () => {
    expect(parentOf('/reports/category/c1')).toBe('/reports')
    expect(parentOf('/reports/excluded?x=1')).toBe('/reports')
    expect(parentOf('/reports/category/c1/c2')).toBe('/reports/category/c1')
    expect(parentOf('/reports/category/c1/direct#x')).toBe('/reports/category/c1')
    expect(parentOf('/reports')).toBeNull()
  })

  it('has no parent on a tab itself or elsewhere', () => {
    for (const url of ['/account', '/account?x=1', '/wallets', '/accounts/x', '/']) {
      expect(parentOf(url)).toBeNull()
    }
  })
})

describe('sharing pages (sharing.md)', () => {
  it('Account › แชร์กระเป๋า goes back to the Account tab', () => {
    expect(parentOf('/account/sharing')).toBe('/account')
  })
})

describe('levelOf', () => {
  it('counts the ‹ steps up to the tab', () => {
    expect(levelOf('/transactions')).toBe(0)
    expect(levelOf('/account/recurring')).toBe(1)
    expect(levelOf('/wallets/debts/d1?entry=e1')).toBe(2)
  })
})

@Component({ template: '' })
class Blank {}

describe('NavHistory', () => {
  let router: Router
  let location: Location
  let nav: NavHistory

  const go = async (url: string) => {
    await router.navigateByUrl(url)
  }
  /** ‹, then the navigation it starts (history back or up to the parent) ends. */
  const back = async () => {
    const ended = firstValueFrom(
      router.events.pipe(filter((event) => event instanceof NavigationEnd))
    )
    nav.back()
    await ended
  }

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideRouter([{ path: '**', component: Blank }]), provideLocationMocks()],
    })
    router = TestBed.inject(Router)
    location = TestBed.inject(Location)
    nav = TestBed.inject(NavHistory)
    // What bootstrapping does: the router starts listening to popstate (‹ is a history back).
    router.initialNavigation()
  })

  it('goes back to the page it came from, keeping that tab lit', async () => {
    await go('/transactions')
    await go('/account/recurring')
    expect(nav.tab()).toBe('transactions')
    expect(nav.step()).toBe(1_001)
    await back()
    expect(location.path()).toBe('/transactions')
    expect(nav.tab()).toBe('transactions')
    expect(nav.step()).toBe(1_000)
  })

  it('lights the page’s own tab when opened from that tab', async () => {
    await go('/account')
    await go('/account/recurring')
    expect(nav.tab()).toBe('account')
    await back()
    expect(location.path()).toBe('/account')
  })

  it('keeps the tab it came from down a deeper page, and back up again', async () => {
    await go('/transactions')
    await go('/wallets/debts')
    await go('/wallets/debts/d1')
    expect(nav.tab()).toBe('transactions')
    expect(nav.step()).toBe(1_002)
    await back()
    await back()
    expect(location.path()).toBe('/transactions')
    expect(nav.step()).toBe(1_000)
  })

  it('goes up to the parent from a page opened directly, replacing it', async () => {
    await go('/wallets/debts/d1')
    expect(nav.tab()).toBe('wallets')
    await back()
    expect(location.path()).toBe('/wallets/debts')
    await back()
    expect(location.path()).toBe('/wallets')
  })

  it('does not slide when the tab changes', async () => {
    await go('/transactions')
    await go('/account/recurring')
    await go('/wallets')
    expect(nav.tab()).toBe('wallets')
    expect(nav.step()).toBe(1_001)
  })
})
