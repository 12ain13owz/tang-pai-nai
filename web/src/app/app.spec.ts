import { provideHttpClient } from '@angular/common/http'
import { provideHttpClientTesting } from '@angular/common/http/testing'
import { signal } from '@angular/core'
import { TestBed } from '@angular/core/testing'
import { provideRouter, Router, TitleStrategy } from '@angular/router'
import { provideServiceWorker } from '@angular/service-worker'
import { TranslocoTestingModule } from '@jsverse/transloco'
import { AuthStore } from '@/core/auth'
import th from '@/core/i18n/th.json'
import { OPEN_LOCAL_DATABASE } from '@/core/offline'
import { openTestDatabase } from '@/core/offline/testing-db'
import { DeviceStorageService } from '@/core/pwa'
import { PageTitleStrategy } from '@/core/routing'
import { App } from './app'
import { routes } from './app.routes'

/** jsdom has no `matchMedia` / storage manager; the device facts don't matter here. */
const deviceStorageStub = {
  provide: DeviceStorageService,
  useValue: {
    isInstalled: signal(false),
    isPersisted: signal(null),
    persist: async () => Promise.resolve(false),
  },
}

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        App,
        TranslocoTestingModule.forRoot({
          langs: { th },
          translocoConfig: { availableLangs: ['th', 'en'], defaultLang: 'th' },
          preloadLangs: true,
        }),
      ],
      providers: [
        provideRouter(routes),
        { provide: TitleStrategy, useExisting: PageTitleStrategy },
        provideServiceWorker('ngsw-worker.js', { enabled: false }),
        deviceStorageStub,
        // The shell opens the database in memory (untrusted device) and starts syncing.
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: OPEN_LOCAL_DATABASE, useValue: openTestDatabase },
      ],
    }).compileComponents()
  })

  it('renders the shell with the bottom tab bar', async () => {
    // The shell sits behind the auth guard.
    TestBed.inject(AuthStore).setSession({
      accessToken: 'token',
      expiresIn: 600,
      user: {
        id: 'u1',
        email: 'me@example.com',
        displayName: 'me',
        avatarUrl: null,
        timezone: 'Asia/Bangkok',
        hasPassword: false,
        phone: null,
        identities: [],
      },
    })
    const fixture = TestBed.createComponent(App)
    await TestBed.inject(Router).navigateByUrl('/')
    await fixture.whenStable()
    const compiled = fixture.nativeElement as HTMLElement
    const tabs = [...compiled.querySelectorAll('nav a')].map((a) => a.textContent.trim())
    expect(tabs).toEqual(['ธุรกรรม', 'กระเป๋า', '', 'รายงาน', 'บัญชีผู้ใช้'])
    expect(compiled.querySelector('h1')?.textContent).toContain('ธุรกรรม')
  })
})
