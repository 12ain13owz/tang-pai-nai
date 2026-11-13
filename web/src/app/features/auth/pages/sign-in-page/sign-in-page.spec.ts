import { provideHttpClient } from '@angular/common/http'
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing'
import { Component, signal } from '@angular/core'
import { TestBed } from '@angular/core/testing'
import type { ComponentFixture } from '@angular/core/testing'
import { provideRouter, Router } from '@angular/router'
import { TranslocoTestingModule } from '@jsverse/transloco'
import { AuthService } from '@/core/auth'
import th from '@/core/i18n/th.json'
import { OfflineService } from '@/core/offline'
import { AuthFlowStore } from '@/features/auth/auth-flow.store'
import { SignInPage } from './sign-in-page'

@Component({ template: '' })
class Blank {}

const envelope = (data?: unknown) => ({ message: 'ok', timestamp: '', data })

describe('SignInPage', () => {
  let fixture: ComponentFixture<SignInPage>
  let http: HttpTestingController
  /** Whose local data the device holds (offline-sync rule 7); none by default. */
  const offline = {
    meta: signal<{ userId: string; displayName: string } | null>(null),
    ready: async () => Promise.resolve(offline.meta()),
  }

  const page = () => fixture.nativeElement as HTMLElement
  const googleButton = () =>
    [...page().querySelectorAll('button')].find((button) =>
      button.textContent.includes(th.auth.continueWithGoogle)
    )
  const tabs = () =>
    [...page().querySelectorAll<HTMLInputElement>('input[type="radio"]')].map((radio) => ({
      label: radio.closest('label')?.textContent.trim(),
      radio,
    }))
  const tab = (label: string) => tabs().find((item) => item.label === label)?.radio
  const settle = async () => {
    await new Promise((resolve) => setTimeout(resolve))
    await fixture.whenStable()
    fixture.detectChanges()
  }
  const type = (selector: string, value: string) => {
    const input = page().querySelector<HTMLInputElement>(selector)
    if (!input) {
      throw new Error(`no ${selector}`)
    }
    input.value = value
    input.dispatchEvent(new Event('input'))
    fixture.detectChanges()
  }
  const submit = async () => {
    page().querySelector('form')?.dispatchEvent(new Event('submit'))
    await settle()
  }

  /** Opens the page and answers `GET /auth/providers`. */
  const open = async (
    url: string,
    providers: { google: boolean; phone?: boolean } | 'unreachable'
  ) => {
    await TestBed.inject(Router).navigateByUrl(url)
    fixture = TestBed.createComponent(SignInPage)
    fixture.detectChanges()
    await fixture.whenStable()
    const request = http.expectOne('/api/auth/providers')
    if (providers === 'unreachable') {
      request.error(new ProgressEvent('error'))
    } else {
      request.flush(envelope({ phone: false, ...providers }))
    }
    await settle()
  }

  beforeEach(async () => {
    sessionStorage.clear()
    offline.meta.set(null)
    await TestBed.configureTestingModule({
      imports: [
        SignInPage,
        TranslocoTestingModule.forRoot({
          langs: { th },
          translocoConfig: { availableLangs: ['th', 'en'], defaultLang: 'th' },
          preloadLangs: true,
        }),
      ],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: OfflineService, useValue: offline },
        provideRouter([
          { path: 'auth/sign-in', component: SignInPage },
          { path: '**', component: Blank },
        ]),
      ],
    }).compileComponents()
    http = TestBed.inject(HttpTestingController)
  })

  afterEach(() => {
    http.verify()
    sessionStorage.clear()
  })

  it('says whose data the device holds, and that another account deletes it (rule 7)', async () => {
    await open('/auth/sign-in', { google: false })
    expect(page().textContent).not.toContain(th.auth.localData.slice(0, 12))

    offline.meta.set({ userId: 'u1', displayName: 'mom' })
    fixture.detectChanges()
    expect(page().textContent).toContain(th.auth.localData.replace('{{name}}', 'mom'))
  })

  describe('Continue with Google', () => {
    it('shows the button when the API says Google is on', async () => {
      await open('/auth/sign-in', { google: true })

      expect(googleButton()?.disabled).toBe(false)
      expect(page().textContent).toContain(th.auth.or)
    })

    it.each([{ google: false }, 'unreachable' as const])(
      'hides the button while Google is off or unknown (%o)',
      async (providers) => {
        await open('/auth/sign-in', providers)

        expect(googleButton()).toBeUndefined()
      }
    )

    it('leaves for Google with the page’s return path and shows it is on its way', async () => {
      await open('/auth/sign-in?returnUrl=%2Freports', { google: true })
      const startGoogle = vi
        .spyOn(TestBed.inject(AuthService), 'startGoogle')
        .mockImplementation(() => undefined)

      googleButton()?.click()
      fixture.detectChanges()

      expect(startGoogle).toHaveBeenCalledWith('/reports', 'th')
      expect(googleButton()?.disabled).toBe(true)
      expect(googleButton()?.querySelector('hlm-spinner')).not.toBeNull()
    })
  })

  describe('tabs', () => {
    it('offers the phone tab only while SMS is on', async () => {
      await open('/auth/sign-in', { google: false, phone: true })

      expect(tabs().map((item) => item.label)).toEqual([
        th.auth.methods.email,
        th.auth.methods.password,
        th.auth.methods.phone,
      ])
      expect(tab(th.auth.methods.email)?.checked).toBe(true)
    })

    it.each([{ google: false, phone: false }, 'unreachable' as const])(
      'hides the phone tab while SMS is off or unknown (%o)',
      async (providers) => {
        await open('/auth/sign-in', providers)

        expect(tab(th.auth.methods.phone)).toBeUndefined()
      }
    )

    it('keeps the tab in the URL and the email typed between email and password', async () => {
      await open('/auth/sign-in?returnUrl=%2Freports', { google: false })
      type('input[type="email"]', 'a@b.co')

      tab(th.auth.methods.password)?.click()
      await settle()

      expect(TestBed.inject(Router).url).toBe('/auth/sign-in?returnUrl=%2Freports&with=password')
      expect(page().querySelector('input[type="password"]')).not.toBeNull()
      expect(page().querySelector<HTMLInputElement>('input[type="email"]')?.value).toBe('a@b.co')
    })

    it('falls back to email when ?with=phone but SMS is off', async () => {
      await open('/auth/sign-in?with=phone', { google: false, phone: false })

      expect(page().querySelector('input[type="tel"]')).toBeNull()
      expect(page().querySelector('input[type="email"]')).not.toBeNull()
    })
  })

  describe('password tab', () => {
    it('signs in and goes to the return path', async () => {
      await open('/auth/sign-in?with=password&returnUrl=%2Freports', { google: false })
      type('input[type="email"]', 'A@B.co ')
      type('input[type="password"]', 'secret')
      await submit()

      const req = http.expectOne('/api/auth/password/sign-in')
      expect(req.request.body).toMatchObject({ email: 'a@b.co', password: 'secret' })
      req.flush(envelope({ accessToken: 't', user: { id: 'u' } }))
      await settle()

      expect(TestBed.inject(Router).url).toBe('/reports')
    })
  })

  describe('phone tab', () => {
    const openPhone = async () =>
      open('/auth/sign-in?with=phone&returnUrl=%2Freports', { google: false, phone: true })

    it('sends the number in E.164 and goes on to the code with the return path kept', async () => {
      await openPhone()
      type('input[type="tel"]', '081-234-5678')
      await submit()

      const req = http.expectOne('/api/auth/phone/start')
      expect(req.request.body).toEqual({ phone: '+66812345678' })
      req.flush(envelope(), { status: 202, statusText: 'Accepted' })
      await settle()

      expect(TestBed.inject(Router).url).toBe('/auth/code')
      expect(TestBed.inject(AuthFlowStore).pending()).toMatchObject({
        email: '',
        phone: '+66812345678',
        returnUrl: '/reports',
      })
    })

    it('refuses a number that isn’t a Thai mobile without a request', async () => {
      await openPhone()
      type('input[type="tel"]', '021234567')
      await submit()

      http.expectNone('/api/auth/phone/start')
      expect(page().textContent).toContain(th.auth.phoneInvalid)
    })

    it('says SMS is unavailable when the API answers PHONE_DISABLED', async () => {
      await openPhone()
      type('input[type="tel"]', '0812345678')
      await submit()

      http
        .expectOne('/api/auth/phone/start')
        .flush(
          { message: 'off', code: 'PHONE_DISABLED' },
          { status: 503, statusText: 'Service Unavailable' }
        )
      await settle()

      expect(page().textContent).toContain(th.auth.phoneDisabled)
      expect(TestBed.inject(Router).url).toBe('/auth/sign-in?with=phone&returnUrl=%2Freports')
    })
  })
})
