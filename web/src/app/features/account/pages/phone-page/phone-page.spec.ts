import { provideHttpClient } from '@angular/common/http'
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing'
import type { TestRequest } from '@angular/common/http/testing'
import type { DebugElement } from '@angular/core'
import { TestBed } from '@angular/core/testing'
import type { ComponentFixture } from '@angular/core/testing'
import { By } from '@angular/platform-browser'
import { provideRouter } from '@angular/router'
import { TranslocoTestingModule } from '@jsverse/transloco'
import { AuthStore } from '@/core/auth'
import type { AuthUser } from '@/core/auth'
import th from '@/core/i18n/th.json'
import { ReauthStep } from '@/features/account/components/reauth-step'
import { PhonePage } from './phone-page'

const user = (phone: string | null = null): AuthUser => ({
  id: 'u1',
  email: 'mom@example.com',
  displayName: 'mom',
  avatarUrl: null,
  timezone: 'Asia/Bangkok',
  hasPassword: true,
  identities: [],
  phone,
})

const envelope = (data?: unknown) => ({ message: 'ok', timestamp: '', data })
/** Answers a pending request with an API error `code`. */
const refuse = (req: TestRequest, code: string, status: number) => {
  req.flush({ message: code, code }, { status, statusText: code })
}

describe('PhonePage', () => {
  let fixture: ComponentFixture<PhonePage>
  let http: HttpTestingController

  const page = () => fixture.nativeElement as HTMLElement
  const alerts = () =>
    [...page().querySelectorAll('[role="alert"]')]
      .map((node) => node.textContent.trim())
      .filter(Boolean)
  const buttonNamed = (name: string) =>
    [...page().querySelectorAll('button')].find((button) => button.textContent.trim() === name)
  const settle = async () => {
    await new Promise((resolve) => setTimeout(resolve))
    await fixture.whenStable()
    fixture.detectChanges()
  }
  const reauthStep = () => {
    const found = fixture.debugElement.query(By.directive(ReauthStep)) as DebugElement | null
    return found ? (found.componentInstance as ReauthStep) : undefined
  }

  /** Opens the page and answers its two loads (`/auth/me`, `/auth/providers`). */
  const open = async (phone: string | null = null, phoneEnabled = true) => {
    TestBed.inject(AuthStore).setSession({
      accessToken: 'token',
      expiresIn: 600,
      user: user(phone),
    })
    fixture = TestBed.createComponent(PhonePage)
    fixture.detectChanges()
    http.expectOne('/api/auth/me').flush(envelope(user(phone)))
    http.expectOne('/api/auth/providers').flush(envelope({ google: false, phone: phoneEnabled }))
    await settle()
  }

  const sendNumber = async (value: string) => {
    fixture.componentInstance.numberForm.setValue({ phone: value })
    page().querySelector('form')?.dispatchEvent(new Event('submit'))
    await settle()
  }

  /** The last digit submits, as on the sign-in code screen. */
  const typeCode = async (code: string) => {
    fixture.componentInstance.codeForm.setValue({ code })
    await settle()
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        PhonePage,
        TranslocoTestingModule.forRoot({
          langs: { th },
          translocoConfig: { availableLangs: ['th', 'en'], defaultLang: 'th' },
          preloadLangs: true,
        }),
      ],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents()
    http = TestBed.inject(HttpTestingController)
  })

  afterEach(() => http.verify())

  it('texts a code to the number in E.164, then saves it once confirmed', async () => {
    await open()
    expect(page().textContent).toContain(th.phone.notAdded)

    await sendNumber('081 234 5678')
    const start = http.expectOne('/api/auth/phone')
    expect(start.request.body).toEqual({ phone: '+66812345678' })
    start.flush(envelope(), { status: 202, statusText: 'Accepted' })
    await settle()

    expect(page().textContent).toContain(th.phone.codeSentTo)
    expect(page().textContent).toContain('081-234-5678')

    await typeCode('123456')
    const confirm = http.expectOne('/api/auth/phone/confirm')
    expect(confirm.request.body).toEqual({ code: '123456', lang: 'th' })
    confirm.flush(envelope(user('+66812345678')))
    await settle()

    expect(page().textContent).toContain(th.phone.added)
    expect(page().textContent).toContain(th.phone.saved)
    expect(TestBed.inject(AuthStore).user()?.phone).toBe('+66812345678')
  })

  it('refuses a number that isn’t a Thai mobile, or the saved one, without a request', async () => {
    await open('+66812345678')

    await sendNumber('12345')
    expect(page().textContent).toContain(th.auth.phoneInvalid)

    await sendNumber('081-234-5678')
    expect(page().textContent).toContain(th.phone.unchanged)
    http.expectNone('/api/auth/phone')
  })

  it('confirms it’s you on REAUTH_REQUIRED, then sends the number again', async () => {
    await open()
    await sendNumber('0812345678')
    refuse(http.expectOne('/api/auth/phone'), 'REAUTH_REQUIRED', 403)
    await settle()

    const step = reauthStep()
    expect(step?.method()).toBe('password')

    step?.passwordSubmitted.emit('Current.1')
    const retry = http.expectOne('/api/auth/phone')
    expect(retry.request.body).toEqual({ phone: '+66812345678', currentPassword: 'Current.1' })
    retry.flush(envelope(), { status: 202, statusText: 'Accepted' })
    await settle()

    expect(reauthStep()).toBeUndefined()
    expect(page().textContent).toContain(th.phone.codeSentTo)
  })

  it('goes back to the number when it belongs to someone else', async () => {
    await open()
    await sendNumber('0812345678')
    http.expectOne('/api/auth/phone').flush(envelope(), { status: 202, statusText: 'Accepted' })
    await settle()

    await typeCode('123456')
    refuse(http.expectOne('/api/auth/phone/confirm'), 'PHONE_IN_USE', 409)
    await settle()

    expect(alerts()).toContain(th.phone.inUse)
    expect(page().querySelector('input[type="tel"]')).not.toBeNull()
  })

  it('shows a wrong code and stays on the code', async () => {
    await open()
    await sendNumber('0812345678')
    http.expectOne('/api/auth/phone').flush(envelope(), { status: 202, statusText: 'Accepted' })
    await settle()

    await typeCode('000000')
    refuse(http.expectOne('/api/auth/phone/confirm'), 'OTP_INVALID', 400)
    await settle()

    expect(alerts()).toContain(th.auth.codeInvalid)
    expect(page().textContent).toContain(th.phone.codeSentTo)
  })

  it('asks before removing the number, then removes it', async () => {
    await open('+66812345678')

    buttonNamed(th.phone.remove)?.click()
    fixture.detectChanges()
    expect(page().textContent).toContain(th.phone.removeConfirmText)
    http.expectNone('/api/auth/phone')

    buttonNamed(th.phone.removeConfirm)?.click()
    const req = http.expectOne('/api/auth/phone')
    expect(req.request.method).toBe('DELETE')
    expect(req.request.body).toEqual({ lang: 'th' })
    req.flush(envelope(user(null)))
    await settle()

    expect(page().textContent).toContain(th.phone.removed)
    expect(page().textContent).toContain(th.phone.notAdded)
  })

  it('shows the saved number read-only while SMS is off', async () => {
    await open('+66812345678', false)

    expect(page().textContent).toContain('081-234-5678')
    expect(page().textContent).toContain(th.phone.unavailable)
    expect(page().querySelector('form')).toBeNull()
    expect(buttonNamed(th.phone.remove)).toBeUndefined()
  })
})
