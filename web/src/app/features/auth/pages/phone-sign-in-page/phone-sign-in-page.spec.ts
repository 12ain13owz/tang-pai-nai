import { provideHttpClient } from '@angular/common/http'
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing'
import { Component } from '@angular/core'
import { TestBed } from '@angular/core/testing'
import type { ComponentFixture } from '@angular/core/testing'
import { provideRouter, Router } from '@angular/router'
import { TranslocoTestingModule } from '@jsverse/transloco'
import th from '@/core/i18n/th.json'
import { AuthFlowStore } from '@/features/auth/auth-flow.store'
import { PhoneSignInPage } from './phone-sign-in-page'

@Component({ template: '' })
class Blank {}

const envelope = (data?: unknown) => ({ message: 'ok', timestamp: '', data })

describe('PhoneSignInPage', () => {
  let fixture: ComponentFixture<PhoneSignInPage>
  let http: HttpTestingController

  const page = () => fixture.nativeElement as HTMLElement
  const settle = async () => {
    await new Promise((resolve) => setTimeout(resolve))
    await fixture.whenStable()
    fixture.detectChanges()
  }
  const submit = async (phone: string) => {
    fixture.componentInstance.form.setValue({ phone })
    page().querySelector('form')?.dispatchEvent(new Event('submit'))
    await settle()
  }

  beforeEach(async () => {
    sessionStorage.clear()
    await TestBed.configureTestingModule({
      imports: [
        PhoneSignInPage,
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
    await TestBed.inject(Router).navigateByUrl('/auth/phone?returnUrl=%2Freports')
    fixture = TestBed.createComponent(PhoneSignInPage)
    await settle()
  })

  afterEach(() => {
    http.verify()
    sessionStorage.clear()
  })

  it('sends the number in E.164 and goes on to the code with the return path kept', async () => {
    await submit('081-234-5678')

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
    await submit('021234567')

    http.expectNone('/api/auth/phone/start')
    expect(page().textContent).toContain(th.auth.phoneInvalid)
  })

  it('says SMS is unavailable when the API answers PHONE_DISABLED', async () => {
    await submit('0812345678')

    http
      .expectOne('/api/auth/phone/start')
      .flush(
        { message: 'off', code: 'PHONE_DISABLED' },
        { status: 503, statusText: 'Service Unavailable' }
      )
    await settle()

    expect(page().textContent).toContain(th.auth.phoneDisabled)
    expect(TestBed.inject(Router).url).toBe('/auth/phone?returnUrl=%2Freports')
  })
})
