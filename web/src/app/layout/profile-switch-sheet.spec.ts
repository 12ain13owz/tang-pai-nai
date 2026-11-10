import { signal } from '@angular/core'
import { TestBed } from '@angular/core/testing'
import { provideRouter } from '@angular/router'
import { TranslocoTestingModule } from '@jsverse/transloco'
import th from '@/core/i18n/th.json'
import { ProfileService } from '@/core/profile'
import type { SharingService, ShareGroup } from '@/core/sharing'
import { ProfileSwitchSheet } from './profile-switch-sheet'

describe('ProfileSwitchSheet › แชร์กับฉัน (sharing rule 10)', () => {
  const group: ShareGroup = {
    profileId: 'pz',
    profile: { id: 'pz', name: 'ครอบครัว', icon: 'lucideHouse', color: '#b45309' },
    role: 'editor',
    owner: { id: 'z', displayName: 'พ่อ', email: 'z@x' },
    wallets: [
      { id: 'w1', name: 'ค่าบ้าน', icon: 'x', color: '#000', currencyCode: 'THB', balance: 0 },
      { id: 'w2', name: 'เงินสด', icon: 'x', color: '#000', currencyCode: 'THB', balance: 0 },
    ],
  }
  const canCall = signal(true)
  const openShared = vi.fn(async () => Promise.resolve())
  const sharing = {
    withMe: signal({ invites: [], shares: [group] }),
    canCall,
    openShared,
  } as unknown as SharingService
  const profileService = {
    profiles: signal([{ id: 'p1', name: 'ส่วนตัว', icon: 'lucideUser', color: '#0f766e' }]),
    current: signal({ id: 'p1' }),
    shared: signal(null),
    isShared: signal(false),
    pendingIds: signal(new Set<string>()),
    atLimit: signal(false),
    canWrite: signal(true),
    select: vi.fn(),
    leaveShared: vi.fn(),
    open: vi.fn(),
  }

  const render = () => {
    TestBed.configureTestingModule({
      imports: [
        TranslocoTestingModule.forRoot({
          langs: { th },
          translocoConfig: { availableLangs: ['th'], defaultLang: 'th' },
          preloadLangs: true,
        }),
      ],
      providers: [provideRouter([]), { provide: ProfileService, useValue: profileService }],
    })
    const fixture = TestBed.createComponent(ProfileSwitchSheet)
    fixture.componentRef.setInput('open', true)
    fixture.componentRef.setInput('sharing', sharing)
    fixture.detectChanges()
    return fixture
  }
  const sharedButton = () =>
    [...document.body.querySelectorAll('button')].find((b) => b.textContent.includes('ครอบครัว'))

  beforeEach(() => {
    canCall.set(true)
    openShared.mockClear()
  })

  it('lists profiles shared with me under my own, with owner, wallets and role', async () => {
    const fixture = render()
    await fixture.whenStable()
    const text = document.body.textContent.replace(/\s+/g, ' ')
    expect(text).toContain(th.sharing.withMe)
    expect(text).toContain('ของ พ่อ · 2 กระเป๋า')
    expect(text).toContain(th.sharing.editor)
    sharedButton()?.click()
    expect(openShared).toHaveBeenCalledWith(group)
    fixture.destroy()
  })

  it('turns the group off offline, and says why', async () => {
    canCall.set(false)
    const fixture = render()
    await fixture.whenStable()
    expect(sharedButton()?.disabled).toBe(true)
    expect(document.body.textContent).toContain(th.sharing.profileOnline)
    fixture.destroy()
  })
})
