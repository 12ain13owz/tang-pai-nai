import { provideHttpClient } from '@angular/common/http'
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing'
import { Component } from '@angular/core'
import { TestBed } from '@angular/core/testing'
import { provideRouter, Router } from '@angular/router'
import { TranslocoTestingModule } from '@jsverse/transloco'
import { toastState } from '@spartan-ng/brain/sonner'
import { AuthStore } from '@/core/auth'
import type { AuthSession } from '@/core/auth'
import th from '@/core/i18n/th.json'
import { GoogleCallbackPage } from './google-callback-page'

@Component({ template: '' })
class Blank {}

const session: AuthSession = {
  accessToken: 'access-1',
  expiresIn: 600,
  user: {
    id: 'u1',
    email: 'mom@gmail.com',
    displayName: 'mom',
    avatarUrl: null,
    timezone: 'Asia/Bangkok',
    hasPassword: false,
    identities: [{ provider: 'google', email: 'mom@gmail.com', linkedAt: '2026-10-19T00:00:00Z' }],
  },
}

const envelope = (data?: unknown) => ({ message: 'ok', timestamp: '', data })

describe('GoogleCallbackPage', () => {
  let http: HttpTestingController
  let router: Router

  // Lets the page's `await` chain (refresh, then navigation) finish.
  const settle = async () => {
    await new Promise((resolve) => setTimeout(resolve))
    await new Promise((resolve) => setTimeout(resolve))
  }

  /** Lands on `/auth/callback?…` the way the API's redirect does. */
  const open = async (query: string) => {
    await router.navigateByUrl(`/auth/callback${query}`)
    const fixture = TestBed.createComponent(GoogleCallbackPage)
    fixture.detectChanges()
    return fixture
  }
  const alertOf = (fixture: { nativeElement: unknown }) =>
    (fixture.nativeElement as HTMLElement).querySelector('[role="alert"]')?.textContent.trim()

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        TranslocoTestingModule.forRoot({
          langs: { th },
          translocoConfig: { availableLangs: ['th', 'en'], defaultLang: 'th' },
          preloadLangs: true,
        }),
      ],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([
          { path: 'auth/callback', component: Blank },
          { path: 'auth/sign-in', component: Blank },
          { path: 'wallets', component: Blank },
          { path: '', component: Blank },
        ]),
      ],
    }).compileComponents()
    http = TestBed.inject(HttpTestingController)
    router = TestBed.inject(Router)
  })

  afterEach(() => {
    http.verify()
    toastState.toasts().forEach((toast) => toastState.dismiss(toast.id))
  })

  it('refreshes the session from the new cookie and goes to the return path', async () => {
    await open('?returnUrl=%2Fwallets')

    const refresh = http.expectOne('/api/auth/refresh')
    expect(refresh.request.method).toBe('POST')
    refresh.flush(envelope(session))
    await settle()

    expect(TestBed.inject(AuthStore).status()).toBe('signedIn')
    expect(router.url).toBe('/wallets')
    expect(toastState.toasts()).toHaveLength(0)
  })

  it('says once that Google was linked, and never leaves the app for an outside return path', async () => {
    await open('?returnUrl=%2F%2Fevil.example&linked=google')

    http.expectOne('/api/auth/refresh').flush(envelope(session))
    await settle()

    expect(router.url).toBe('/')
    expect(toastState.toasts().map((toast) => toast.title)).toEqual([th.auth.googleLinked])
  })

  it('goes straight back to sign-in when the user cancelled at Google', async () => {
    await open('?error=cancelled')
    await settle()

    http.expectNone('/api/auth/refresh')
    expect(router.url).toBe('/auth/sign-in')
  })

  it.each([
    ['email_unverified', th.auth.googleEmailUnverified],
    ['signup_closed', th.auth.signupClosed],
    ['disabled', th.auth.userDisabled],
    ['rate_limited', th.auth.googleRateLimited],
    ['failed', th.auth.googleFailed],
    ['something-new', th.auth.googleFailed],
  ])('shows why Google sign-in failed (%s), without calling the API', async (reason, message) => {
    const fixture = await open(`?error=${reason}`)
    await settle()
    fixture.detectChanges()

    http.expectNone('/api/auth/refresh')
    expect(alertOf(fixture)).toBe(message)
    expect((fixture.nativeElement as HTMLElement).querySelector('a')?.getAttribute('href')).toBe(
      '/auth/sign-in'
    )
  })

  it('fails gracefully when there is no session behind the redirect', async () => {
    const fixture = await open('')

    http
      .expectOne('/api/auth/refresh')
      .flush({ message: 'expired', code: 'SESSION_EXPIRED' }, { status: 401, statusText: 'No' })
    await settle()
    fixture.detectChanges()

    expect(alertOf(fixture)).toBe(th.auth.googleFailed)
    expect(TestBed.inject(AuthStore).status()).toBe('signedOut')
  })

  it('says to check the connection when the API cannot be reached', async () => {
    const fixture = await open('')

    http.expectOne('/api/auth/refresh').error(new ProgressEvent('error'))
    await settle()
    fixture.detectChanges()

    expect(alertOf(fixture)).toBe(th.auth.unreachable)
  })
})
