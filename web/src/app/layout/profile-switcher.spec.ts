import { signal } from '@angular/core'
import { TestBed } from '@angular/core/testing'
import { TranslocoTestingModule } from '@jsverse/transloco'
import th from '@/core/i18n/th.json'
import { ProfileService } from '@/core/profile'
import { ProfileSwitcher } from './profile-switcher'

describe('ProfileSwitcher', () => {
  const current = signal({ id: 'p1', name: 'บ้าน', icon: 'lucideHouse', color: '#2563eb' })
  const isShared = signal(false)
  const switchSheet = signal(false)

  const render = () => {
    TestBed.configureTestingModule({
      imports: [
        TranslocoTestingModule.forRoot({
          langs: { th },
          translocoConfig: { availableLangs: ['th'], defaultLang: 'th' },
          preloadLangs: true,
        }),
      ],
      providers: [{ provide: ProfileService, useValue: { current, isShared, switchSheet } }],
    })
    const fixture = TestBed.createComponent(ProfileSwitcher)
    fixture.detectChanges()
    return { fixture, element: fixture.nativeElement as HTMLElement }
  }

  beforeEach(() => {
    isShared.set(false)
    switchSheet.set(false)
  })

  it('is one glass capsule with the icon and a chevron, no name, that opens the switch sheet', () => {
    const { element } = render()
    const button = element.querySelector('button')!
    expect(button.classList).toContain('tpn-glass')
    expect(button.getAttribute('aria-label')).toBe(
      th.profiles.switchLabel.replace('{{name}}', 'บ้าน')
    )
    expect(button.textContent.trim()).toBe('')
    button.click()
    expect(switchSheet()).toBe(true)
  })

  it('wears a people badge for a profile shared with me', () => {
    const { fixture, element } = render()
    expect(element.querySelector('.bg-primary')).toBeNull()
    isShared.set(true)
    fixture.detectChanges()
    expect(element.querySelector('.bg-primary')).not.toBeNull()
  })
})
