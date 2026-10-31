import { signal } from '@angular/core'
import { TestBed } from '@angular/core/testing'
import { provideRouter } from '@angular/router'
import { TranslocoTestingModule } from '@jsverse/transloco'
import th from '@/core/i18n/th.json'
import { ProfileService } from '@/core/profile'
import { BottomTabBar } from './bottom-tab-bar'

describe('BottomTabBar', () => {
  const current = signal<object | null>(null)

  const render = () => {
    TestBed.configureTestingModule({
      imports: [
        TranslocoTestingModule.forRoot({
          langs: { th },
          translocoConfig: { availableLangs: ['th'], defaultLang: 'th' },
          preloadLangs: true,
        }),
      ],
      providers: [provideRouter([]), { provide: ProfileService, useValue: { current } }],
    })
    const fixture = TestBed.createComponent(BottomTabBar)
    fixture.detectChanges()
    return fixture
  }
  const plus = (element: HTMLElement) =>
    element.querySelector(`a[aria-label="${th.nav.add}"]`)?.getAttribute('href')

  it('sends ➕ to the create step while there is no profile (profile rule 5)', () => {
    current.set(null)
    const fixture = render()
    expect(plus(fixture.nativeElement as HTMLElement)).toBe('/transactions')
  })

  it('sends ➕ to the new transaction page once a profile exists', () => {
    current.set({ id: 'p1' })
    const fixture = render()
    expect(plus(fixture.nativeElement as HTMLElement)).toBe('/transactions/new')
  })

  it('marks the active tab by colour and weight only, with no pill behind the icon', () => {
    const fixture = render()
    const tab = (fixture.nativeElement as HTMLElement).querySelector('a[href="/wallets"]')
    expect(tab?.className).toContain('[&.active]:text-brand')
    expect(tab?.innerHTML).not.toContain('bg-muted')
  })
})
