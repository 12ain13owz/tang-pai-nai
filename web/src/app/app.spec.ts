import { provideHttpClient } from '@angular/common/http'
import { provideHttpClientTesting } from '@angular/common/http/testing'
import { signal } from '@angular/core'
import { TestBed } from '@angular/core/testing'
import { provideRouter, Router, TitleStrategy } from '@angular/router'
import { provideServiceWorker } from '@angular/service-worker'
import { TranslocoTestingModule } from '@jsverse/transloco'
import { AuthStore } from '@/core/auth'
import th from '@/core/i18n/th.json'
import { NetworkStatusService } from '@/core/network'
import { OfflineService, OPEN_LOCAL_DATABASE } from '@/core/offline'
import { openTestDatabase } from '@/core/offline/testing-db'
import { ProfileService } from '@/core/profile'
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

  const signIn = () =>
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

  it('renders the shell with the bottom tab bar', async () => {
    // The shell sits behind the auth guard.
    signIn()
    const fixture = TestBed.createComponent(App)
    await TestBed.inject(Router).navigateByUrl('/')
    await fixture.whenStable()
    const compiled = fixture.nativeElement as HTMLElement
    const tabs = [...compiled.querySelectorAll('nav a')].map((a) => a.textContent.trim())
    expect(tabs).toEqual(['ธุรกรรม', 'กระเป๋า', 'รายงาน', 'บัญชีผู้ใช้'])
    expect(compiled.querySelector('nav button')?.getAttribute('aria-label')).toBe('เพิ่มธุรกรรม')
    expect(compiled.querySelector('h1')?.textContent).toContain('ธุรกรรม')
  })

  it('fades the page in when the bottom tab changes, not inside a tab', async () => {
    signIn()
    const animate = vi.fn(() => ({ cancel: vi.fn() }) as unknown as Animation)
    HTMLElement.prototype.animate = animate
    window.matchMedia = vi.fn(
      () =>
        ({
          matches: false,
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
        }) as unknown as MediaQueryList
    )
    const fixture = TestBed.createComponent(App)
    try {
      const router = TestBed.inject(Router)
      const go = async (url: string) => {
        await router.navigateByUrl(url)
        await fixture.whenStable()
      }
      await go('/reports')
      const main = (fixture.nativeElement as HTMLElement).querySelector('main')
      const onMain = () => animate.mock.contexts.filter((element) => element === main).length
      expect(onMain()).toBe(0)
      await go('/account')
      expect(onMain()).toBe(1)
      await go('/account/security')
      expect(onMain()).toBe(1)
    } finally {
      // The theme stops listening to `matchMedia` on destroy, so it goes before the stub.
      fixture.destroy()
      Reflect.deleteProperty(HTMLElement.prototype, 'animate')
      Reflect.deleteProperty(window, 'matchMedia')
    }
  })

  it('keeps the toaster beside <body>, so an open sheet neither hides it nor closes on its taps', async () => {
    const fixture = TestBed.createComponent(App)
    await fixture.whenStable()
    const toaster = document.querySelector('hlm-toaster')
    expect(toaster?.parentElement).toBe(document.documentElement)
    fixture.destroy()
    toaster?.remove()
  })

  it('shows a note instead of what a shared profile lacks, and blocks it offline (sharing rule 10)', async () => {
    signIn()
    const fixture = TestBed.createComponent(App)
    const router = TestBed.inject(Router)
    await router.navigateByUrl('/transactions')
    await fixture.whenStable()
    TestBed.inject(OfflineService).enterShared()
    TestBed.inject(ProfileService).shared.set({
      profile: {
        id: 'pz',
        name: 'Family',
        icon: 'lucideHouse',
        color: '#000',
        sortOrder: 0,
        createdAt: 1,
        updatedAt: 1,
        deletedAt: null,
        changeSeq: null,
      },
      role: 'editor',
      owner: { id: 'z', displayName: 'Dad' },
      status: 'ready',
    })
    const text = async (url: string) => {
      await router.navigateByUrl(url)
      await fixture.whenStable()
      return (fixture.nativeElement as HTMLElement).textContent
    }
    expect(await text('/reports')).toContain(th.sharing.reportsHeading)
    expect(await text('/account/categories')).toContain(th.sharing.mineHeading)
    TestBed.inject(NetworkStatusService).isOnline.set(false)
    expect(await text('/transactions')).toContain(th.sharing.offlineHeading)
  })
})
