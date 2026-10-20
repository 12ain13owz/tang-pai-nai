import { provideHttpClient } from '@angular/common/http'
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing'
import { TestBed } from '@angular/core/testing'
import type { ComponentFixture } from '@angular/core/testing'
import { provideRouter, Router } from '@angular/router'
import { TranslocoTestingModule } from '@jsverse/transloco'
import { AuthService } from '@/core/auth'
import th from '@/core/i18n/th.json'
import { SignInPage } from './sign-in-page'

const envelope = (data?: unknown) => ({ message: 'ok', timestamp: '', data })

describe('SignInPage: Continue with Google', () => {
  let fixture: ComponentFixture<SignInPage>
  let http: HttpTestingController

  const googleButton = () =>
    [...(fixture.nativeElement as HTMLElement).querySelectorAll('button')].find((button) =>
      button.textContent.includes(th.auth.continueWithGoogle)
    )
  const settle = async () => {
    await new Promise((resolve) => setTimeout(resolve))
    await fixture.whenStable()
    fixture.detectChanges()
  }

  /** Opens the page and answers `GET /auth/providers`. */
  const open = async (url: string, providers: { google: boolean } | 'unreachable') => {
    await TestBed.inject(Router).navigateByUrl(url)
    fixture = TestBed.createComponent(SignInPage)
    fixture.detectChanges()
    await fixture.whenStable()
    const request = http.expectOne('/api/auth/providers')
    if (providers === 'unreachable') {
      request.error(new ProgressEvent('error'))
    } else {
      request.flush(envelope(providers))
    }
    await settle()
  }

  beforeEach(async () => {
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
        provideRouter([{ path: '**', component: SignInPage }]),
      ],
    }).compileComponents()
    http = TestBed.inject(HttpTestingController)
  })

  afterEach(() => http.verify())

  it('shows the button when the API says Google is on', async () => {
    await open('/auth/sign-in', { google: true })

    expect(googleButton()?.disabled).toBe(false)
    expect((fixture.nativeElement as HTMLElement).textContent).toContain(th.auth.or)
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
