import { TestBed } from '@angular/core/testing'
import { provideRouter, Router, TitleStrategy } from '@angular/router'
import { provideServiceWorker } from '@angular/service-worker'
import { TranslocoTestingModule } from '@jsverse/transloco'
import th from '@/core/i18n/th.json'
import { PageTitleStrategy } from '@/core/routing'
import { App } from './app'
import { routes } from './app.routes'

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
      ],
    }).compileComponents()
  })

  it('renders the shell with the bottom tab bar', async () => {
    const fixture = TestBed.createComponent(App)
    await TestBed.inject(Router).navigateByUrl('/')
    await fixture.whenStable()
    const compiled = fixture.nativeElement as HTMLElement
    const tabs = [...compiled.querySelectorAll('nav a')].map((a) => a.textContent.trim())
    expect(tabs).toEqual(['ธุรกรรม', 'กระเป๋า', '', 'รายงาน', 'บัญชีผู้ใช้'])
    expect(compiled.querySelector('h1')?.textContent).toContain('ธุรกรรม')
  })
})
