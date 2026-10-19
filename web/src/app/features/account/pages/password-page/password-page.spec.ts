import { provideHttpClient } from '@angular/common/http'
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing'
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
import { PasswordPage } from './password-page'

const NEW_PASSWORD = 'Blue.Sky.2026'

const user = (hasPassword: boolean): AuthUser => ({
  id: 'u1',
  email: 'mom@example.com',
  displayName: 'mom',
  avatarUrl: null,
  timezone: 'Asia/Bangkok',
  hasPassword,
})

const envelope = (data?: unknown) => ({ message: 'ok', timestamp: '', data })
const refused = (code: string, status: number) => ({
  body: { message: code, code },
  init: { status, statusText: code },
})

describe('PasswordPage', () => {
  let fixture: ComponentFixture<PasswordPage>
  let http: HttpTestingController

  const text = () => (fixture.nativeElement as HTMLElement).textContent
  const alerts = () =>
    [...(fixture.nativeElement as HTMLElement).querySelectorAll('[role="alert"]')]
      .map((node) => node.textContent.trim())
      .filter(Boolean)
  // Lets the page's `await` chain resume after a flushed response, then renders.
  const settle = async () => {
    await new Promise((resolve) => setTimeout(resolve))
    await fixture.whenStable()
    fixture.detectChanges()
  }
  // `query` is typed non-null but answers null when the step isn't shown.
  const reauthStep = () => {
    const found = fixture.debugElement.query(By.directive(ReauthStep)) as DebugElement | null
    return found ? (found.componentInstance as ReauthStep) : undefined
  }

  const open = async (hasPassword: boolean) => {
    TestBed.inject(AuthStore).setSession({
      accessToken: 'token',
      expiresIn: 600,
      user: user(hasPassword),
    })
    fixture = TestBed.createComponent(PasswordPage)
    await settle()
  }

  const submitNewPassword = async () => {
    fixture.componentInstance.form.setValue({
      newPassword: NEW_PASSWORD,
      confirmPassword: NEW_PASSWORD,
    })
    ;(fixture.nativeElement as HTMLElement)
      .querySelector('form')
      ?.dispatchEvent(new Event('submit'))
    await settle()
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        PasswordPage,
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

  it('sets a password right away when the sign-in is recent', async () => {
    await open(false)
    await submitNewPassword()

    const req = http.expectOne('/api/auth/password')
    expect(req.request.body).toEqual({ newPassword: NEW_PASSWORD })
    req.flush(envelope(user(true)))
    await settle()

    expect(text()).toContain(th.account.passwordSaved)
    expect(TestBed.inject(AuthStore).user()?.hasPassword).toBe(true)
  })

  it('does not send a password the policy refuses', async () => {
    await open(false)
    fixture.componentInstance.form.setValue({
      newPassword: 'abcdefgh',
      confirmPassword: 'abcdefgh',
    })
    ;(fixture.nativeElement as HTMLElement)
      .querySelector('form')
      ?.dispatchEvent(new Event('submit'))
    await settle()

    http.expectNone('/api/auth/password')
    expect(text()).toContain(th.auth.passwordWeak)
  })

  it('on REAUTH_REQUIRED asks for the current password, then sends the same change again', async () => {
    await open(true)
    await submitNewPassword()
    const first = refused('REAUTH_REQUIRED', 403)
    http.expectOne('/api/auth/password').flush(first.body, first.init)
    await settle()

    expect(reauthStep()?.method()).toBe('password')
    reauthStep()?.passwordSubmitted.emit('Gr33n Mango Tree')
    await settle()

    const retry = http.expectOne('/api/auth/password')
    expect(retry.request.body).toEqual({
      newPassword: NEW_PASSWORD,
      currentPassword: 'Gr33n Mango Tree',
    })
    retry.flush(envelope(user(true)))
    await settle()
    expect(reauthStep()).toBeUndefined()
    expect(text()).toContain(th.account.passwordChanged)
  })

  it('shows a wrong current password in the confirm step only, until it is edited', async () => {
    await open(true)
    await submitNewPassword()
    const first = refused('REAUTH_REQUIRED', 403)
    http.expectOne('/api/auth/password').flush(first.body, first.init)
    await settle()
    reauthStep()?.passwordSubmitted.emit('Wrong.pass1')
    await settle()
    const wrong = refused('CURRENT_PASSWORD_INVALID', 400)
    http.expectOne('/api/auth/password').flush(wrong.body, wrong.init)
    await settle()

    expect(alerts()).toEqual([th.auth.currentPasswordInvalid])

    reauthStep()?.passwordForm.setValue({ currentPassword: 'Gr33n' })
    await settle()
    expect(alerts()).toEqual([])
  })

  it('confirms with an emailed code when there is no password, then retries', async () => {
    await open(false)
    await submitNewPassword()
    const first = refused('REAUTH_REQUIRED', 403)
    http.expectOne('/api/auth/password').flush(first.body, first.init)
    await settle()
    expect(reauthStep()?.method()).toBe('code')

    reauthStep()?.sendCode.emit()
    await settle()
    http.expectOne('/api/auth/reauth/start').flush(envelope(), { status: 202, statusText: 'OK' })
    await settle()
    expect(reauthStep()?.codeSent()).toBe(true)

    // The last digit submits by itself.
    reauthStep()?.codeForm.setValue({ code: '123456' })
    await settle()
    const verify = http.expectOne('/api/auth/reauth/verify')
    expect(verify.request.body).toEqual({ code: '123456' })
    verify.flush(envelope())
    await settle()

    const retry = http.expectOne('/api/auth/password')
    expect(retry.request.body).toEqual({ newPassword: NEW_PASSWORD })
    retry.flush(envelope(user(true)))
    await settle()
    expect(text()).toContain(th.account.passwordSaved)
  })

  it('clears a server error once the form is edited', async () => {
    await open(false)
    await submitNewPassword()
    const breached = refused('PASSWORD_BREACHED', 422)
    http.expectOne('/api/auth/password').flush(breached.body, breached.init)
    await settle()
    expect(alerts()).toEqual([th.auth.passwordBreached])

    fixture.componentInstance.form.controls.newPassword.setValue('Another.One1')
    await settle()
    expect(alerts()).not.toContain(th.auth.passwordBreached)
  })
})
