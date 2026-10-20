import { provideHttpClient } from '@angular/common/http'
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing'
import { Component } from '@angular/core'
import type { DebugElement } from '@angular/core'
import { TestBed } from '@angular/core/testing'
import type { ComponentFixture } from '@angular/core/testing'
import { By } from '@angular/platform-browser'
import { provideRouter, Router } from '@angular/router'
import { TranslocoTestingModule } from '@jsverse/transloco'
import { toastState } from '@spartan-ng/brain/sonner'
import { AuthStore } from '@/core/auth'
import type { AuthDeviceSession, AuthUser } from '@/core/auth'
import th from '@/core/i18n/th.json'
import { ReauthStep } from '@/features/account/components/reauth-step'
import { SecurityPage } from './security-page'

@Component({ template: '' })
class Blank {}

const user = (linked = false, phone: string | null = null): AuthUser => ({
  id: 'u1',
  email: 'mom@example.com',
  displayName: 'mom',
  avatarUrl: null,
  timezone: 'Asia/Bangkok',
  hasPassword: true,
  phone,
  identities: linked
    ? [{ provider: 'google', email: 'mom@gmail.com', linkedAt: '2026-10-19T00:00:00Z' }]
    : [],
})

const now = new Date().toISOString()
const devices: AuthDeviceSession[] = [
  {
    id: 'this-one',
    userAgent:
      'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
    signedInAt: now,
    lastUsedAt: now,
    current: true,
  },
  {
    id: 'the-iphone',
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
    signedInAt: now,
    lastUsedAt: new Date(Date.now() - 5 * 60_000).toISOString(),
    current: false,
  },
]

const envelope = (data?: unknown) => ({ message: 'ok', timestamp: '', data })
const refused = (code: string, status: number) => ({
  body: { message: code, code },
  init: { status, statusText: code },
})

describe('SecurityPage', () => {
  let fixture: ComponentFixture<SecurityPage>
  let http: HttpTestingController

  const page = () => fixture.nativeElement as HTMLElement
  const alerts = () =>
    [...page().querySelectorAll('[role="alert"]')].map((node) => node.textContent.trim())
  const buttonNamed = (name: string) =>
    [...page().querySelectorAll('button')].filter((button) => button.textContent.trim() === name)
  const settle = async () => {
    await new Promise((resolve) => setTimeout(resolve))
    await fixture.whenStable()
    fixture.detectChanges()
  }
  const reauthStep = () => {
    const found = fixture.debugElement.query(By.directive(ReauthStep)) as DebugElement | null
    return found ? (found.componentInstance as ReauthStep) : undefined
  }

  /** Opens `/account/security…` and answers the three loads the page makes. */
  const open = async (
    query = '',
    linked = false,
    { phone = null as string | null, phoneEnabled = true } = {}
  ) => {
    TestBed.inject(AuthStore).setSession({
      accessToken: 'token',
      expiresIn: 600,
      user: user(linked, phone),
    })
    await TestBed.inject(Router).navigateByUrl(`/account/security${query}`)
    fixture = TestBed.createComponent(SecurityPage)
    fixture.detectChanges()
    http.expectOne('/api/auth/me').flush(envelope(user(linked, phone)))
    http.expectOne('/api/auth/providers').flush(envelope({ google: true, phone: phoneEnabled }))
    http.expectOne('/api/auth/sessions').flush(envelope(devices))
    await settle()
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        SecurityPage,
        TranslocoTestingModule.forRoot({
          langs: { th },
          translocoConfig: { availableLangs: ['th', 'en'], defaultLang: 'th' },
          preloadLangs: true,
        }),
      ],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([{ path: '**', component: Blank }]),
      ],
    }).compileComponents()
    http = TestBed.inject(HttpTestingController)
  })

  afterEach(() => {
    http.verify()
    toastState.toasts().forEach((toast) => toastState.dismiss(toast.id))
  })

  it('shows the phone row as a link to /account/phone, with the number the Thai way', async () => {
    await open('', false, { phone: '+66812345678' })

    const row = page().querySelector('a[href="/account/phone"]')
    expect(row?.textContent).toContain(th.account.phone)
    expect(row?.textContent).toContain('081-234-5678')
  })

  it('says "not added" when there is no number yet', async () => {
    await open()

    expect(page().querySelector('a[href="/account/phone"]')?.textContent).toContain(
      th.account.phoneNotAdded
    )
  })

  it('keeps a saved number read-only while SMS is off', async () => {
    await open('', false, { phone: '+66812345678', phoneEnabled: false })

    expect(page().querySelector('a[href="/account/phone"]')).toBeNull()
    expect(page().textContent).toContain('081-234-5678')
  })

  it('hides the phone row while SMS is off and no number is saved', async () => {
    await open('', false, { phoneEnabled: false })

    expect(page().textContent).not.toContain(th.account.phone)
  })

  it('names each device and marks this one, with no sign-out button on it', async () => {
    await open()

    const rows = [...page().querySelectorAll('li')].map((row) => row.textContent)
    expect(rows[0]).toContain('Chrome · Android')
    expect(rows[0]).toContain(th.security.thisDevice)
    expect(rows[1]).toContain('Safari · iPhone')
    expect(buttonNamed(th.security.signOutDevice)).toHaveLength(1)
  })

  it('asks before signing a device out, then reloads the list', async () => {
    await open()

    buttonNamed(th.security.signOutDevice)[0].click()
    fixture.detectChanges()
    expect(page().textContent).toContain(th.security.signOutDeviceConfirmText)
    http.expectNone('/api/auth/sessions/the-iphone')

    buttonNamed(th.security.signOutDevice)[0].click()
    http.expectOne('/api/auth/sessions/the-iphone').flush(envelope())
    await settle()
    http.expectOne('/api/auth/sessions').flush(envelope([devices[0]]))
    await settle()

    expect(page().querySelectorAll('li')).toHaveLength(1)
    expect(toastState.toasts().map((toast) => toast.title)).toEqual([th.security.signedOutDevice])
    // Only this device left: nothing to sign out.
    expect(buttonNamed(th.security.signOutOthers)).toHaveLength(0)
  })

  it('signs out the other devices after asking, and says how many', async () => {
    await open()

    buttonNamed(th.security.signOutOthers)[0].click()
    fixture.detectChanges()
    buttonNamed(th.security.signOutOthers)[0].click()
    const req = http.expectOne((request) => request.url === '/api/auth/sessions')
    expect(req.request.method).toBe('DELETE')
    req.flush(envelope({ revoked: 1 }))
    await settle()
    http.expectOne('/api/auth/sessions').flush(envelope([devices[0]]))
    await settle()

    expect(toastState.toasts().map((toast) => toast.title)).toEqual([
      th.security.signedOutOthers.replace('{{count}}', '1'),
    ])
  })

  it('confirms with the current password when unlinking needs recent auth, then retries', async () => {
    await open('', true)

    buttonNamed(th.security.unlink)[0].click()
    fixture.detectChanges()
    buttonNamed(th.security.unlinkConfirm)[0].click()
    const first = refused('REAUTH_REQUIRED', 403)
    http.expectOne('/api/auth/google/link').flush(first.body, first.init)
    await settle()

    expect(reauthStep()?.method()).toBe('password')
    reauthStep()?.passwordSubmitted.emit('Gr33n Mango Tree')
    const retry = http.expectOne('/api/auth/google/link')
    expect(retry.request.method).toBe('DELETE')
    expect(retry.request.body).toEqual({ lang: 'th', currentPassword: 'Gr33n Mango Tree' })
    retry.flush(envelope(user(false)))
    await settle()

    expect(reauthStep()).toBeUndefined()
    expect(page().textContent).toContain(th.account.googleNotLinked)
    expect(toastState.toasts().map((toast) => toast.title)).toEqual([th.security.unlinked])
  })

  it('says why linking failed when Google sends the user back with an error', async () => {
    await open('?error=google_in_use')

    expect(alerts()).toEqual([th.security.googleInUse])
  })

  it('says once that Google is linked after the round trip', async () => {
    await open('?linked=google', true)

    expect(toastState.toasts().map((toast) => toast.title)).toEqual([th.security.googleLinked])
    expect(page().textContent).toContain('mom@gmail.com')
  })
})
