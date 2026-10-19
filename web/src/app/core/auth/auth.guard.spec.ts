import { TestBed } from '@angular/core/testing'
import { convertToParamMap, provideRouter, Router } from '@angular/router'
import type { ActivatedRouteSnapshot, RouterStateSnapshot, UrlTree } from '@angular/router'
import { authGuard, guestGuard, safeReturnUrl } from './auth.guard'
import { AuthService } from './auth.service'
import type { AuthStatus } from './auth.type'

const setup = (status: AuthStatus) => {
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: AuthService, useValue: { restore: async () => Promise.resolve(status) } },
    ],
  })
  return TestBed.inject(Router)
}

const route = (returnUrl?: string) =>
  ({
    queryParamMap: convertToParamMap(returnUrl ? { returnUrl } : {}),
  }) as ActivatedRouteSnapshot
const state = (url: string) => ({ url }) as RouterStateSnapshot

const run = async (guard: typeof authGuard, r: ActivatedRouteSnapshot, s: RouterStateSnapshot) =>
  TestBed.runInInjectionContext(async () => guard(r, s) as Promise<boolean | UrlTree>)

describe('safeReturnUrl', () => {
  it.each([
    ['/wallets?tab=1', '/wallets?tab=1'],
    ['//evil.example', '/'],
    ['https://evil.example', '/'],
    [null, '/'],
    [42, '/'],
  ])('maps %s to %s', (input, expected) => {
    expect(safeReturnUrl(input)).toBe(expected)
  })
})

describe('authGuard', () => {
  it('lets a signed-in user through', async () => {
    setup('signedIn')

    await expect(run(authGuard, route(), state('/wallets'))).resolves.toBe(true)
  })

  it.each<AuthStatus>(['signedOut', 'unreachable'])(
    'sends a %s user to sign-in with the page as returnUrl',
    async (status) => {
      const router = setup(status)

      const result = await run(authGuard, route(), state('/wallets'))

      expect(router.serializeUrl(result as UrlTree)).toBe('/auth/sign-in?returnUrl=%2Fwallets')
    }
  )
})

describe('guestGuard', () => {
  it('shows the sign-in pages to someone signed out', async () => {
    setup('signedOut')

    await expect(run(guestGuard, route(), state('/auth/sign-in'))).resolves.toBe(true)
  })

  it('sends someone signed in to the safe returnUrl', async () => {
    const router = setup('signedIn')

    const back = await run(guestGuard, route('/reports'), state('/auth/sign-in'))
    const evil = await run(guestGuard, route('//evil.example'), state('/auth/sign-in'))

    expect(router.serializeUrl(back as UrlTree)).toBe('/reports')
    expect(router.serializeUrl(evil as UrlTree)).toBe('/')
  })
})
