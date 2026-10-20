import { provideHttpClient } from '@angular/common/http'
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing'
import { Component } from '@angular/core'
import { TestBed } from '@angular/core/testing'
import type { ComponentFixture } from '@angular/core/testing'
import { provideRouter, Router } from '@angular/router'
import { TranslocoTestingModule } from '@jsverse/transloco'
import { AuthStore } from '@/core/auth'
import th from '@/core/i18n/th.json'
import { AuthFlowStore } from '@/features/auth/auth-flow.store'
import { EnterCodePage } from './enter-code-page'

@Component({ template: '' })
class Blank {}

const envelope = (data?: unknown) => ({ message: 'ok', timestamp: '', data })

// The code screen after an SMS (4.4b); the email path is the same screen with the email texts.
describe('EnterCodePage: SMS code', () => {
  let fixture: ComponentFixture<EnterCodePage>
  let http: HttpTestingController

  const page = () => fixture.nativeElement as HTMLElement
  const settle = async () => {
    await new Promise((resolve) => setTimeout(resolve))
    await fixture.whenStable()
    fixture.detectChanges()
  }

  beforeEach(async () => {
    sessionStorage.clear()
    await TestBed.configureTestingModule({
      imports: [
        EnterCodePage,
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
    TestBed.inject(AuthFlowStore).startPhone('+66812345678', '/reports')
    fixture = TestBed.createComponent(EnterCodePage)
    await settle()
  })

  afterEach(() => {
    http.verify()
    sessionStorage.clear()
  })

  it('names the SMS and the number the Thai way, with no magic-link hint', () => {
    expect(page().textContent).toContain(th.auth.smsCodeHeading)
    expect(page().textContent).toContain('081-234-5678')
    expect(page().textContent).toContain(th.auth.smsHint)
    expect(page().textContent).not.toContain(th.auth.linkHint)
  })

  it('signs in with the number and the code, then goes to the return path', async () => {
    fixture.componentInstance.form.setValue({ code: '123456' })
    await settle()

    const req = http.expectOne('/api/auth/phone/verify')
    expect(req.request.body).toEqual({ phone: '+66812345678', code: '123456' })
    req.flush(
      envelope({
        accessToken: 'access',
        expiresIn: 600,
        user: {
          id: 'u1',
          email: 'mom@example.com',
          displayName: 'mom',
          avatarUrl: null,
          timezone: 'Asia/Bangkok',
          hasPassword: false,
          identities: [],
          phone: '+66812345678',
        },
      })
    )
    await settle()

    expect(TestBed.inject(AuthStore).isSignedIn()).toBe(true)
    expect(TestBed.inject(Router).url).toBe('/reports')
    expect(TestBed.inject(AuthFlowStore).pending().phone).toBe('')
  })

  it('goes back to the phone page to change the number', async () => {
    const back = [...page().querySelectorAll('button')].find((button) =>
      button.textContent.includes(th.auth.changePhone)
    )
    back?.click()
    await settle()

    expect(TestBed.inject(Router).url).toBe('/auth/phone?returnUrl=%2Freports')
  })
})
