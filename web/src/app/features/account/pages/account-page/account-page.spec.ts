import { signal } from '@angular/core'
import { TestBed } from '@angular/core/testing'
import type { ComponentFixture } from '@angular/core/testing'
import { provideRouter, Router } from '@angular/router'
import { TranslocoTestingModule } from '@jsverse/transloco'
import { AuthService, AuthStore } from '@/core/auth'
import type { AuthUser } from '@/core/auth'
import th from '@/core/i18n/th.json'
import { OfflineService, SyncService } from '@/core/offline'
import { ProfileService } from '@/core/profile'
import { DeviceStorageService } from '@/core/pwa'
import { PALETTES, ThemeService } from '@/core/theme'
import { AccountPage } from './account-page'

describe('AccountPage', () => {
  let fixture: ComponentFixture<AccountPage>
  const authService = {
    loadMe: vi.fn(async () => Promise.resolve()),
    signOut: vi.fn(async () => Promise.resolve()),
  }
  const offlineService = { wipe: vi.fn(async () => Promise.resolve()) }
  const syncService = {
    flush: vi.fn(async () => Promise.resolve(0)),
    serverTables: signal<readonly string[]>([]),
  }

  const page = () => fixture.nativeElement as HTMLElement
  const button = (label: string) =>
    [...page().querySelectorAll('button')].find((b) => b.textContent.trim() === label)
  const settle = async () => {
    await fixture.whenStable()
    fixture.detectChanges()
  }

  beforeEach(() => {
    vi.clearAllMocks()
    syncService.serverTables.set([])
    TestBed.configureTestingModule({
      imports: [
        TranslocoTestingModule.forRoot({
          langs: { th },
          translocoConfig: { availableLangs: ['th'], defaultLang: 'th' },
          preloadLangs: true,
        }),
      ],
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: authService },
        { provide: OfflineService, useValue: offlineService },
        { provide: SyncService, useValue: syncService },
        {
          provide: ProfileService,
          useValue: { current: signal({ name: 'ส่วนตัว' }), profiles: signal([{}, {}]) },
        },
        {
          provide: DeviceStorageService,
          useValue: { isInstalled: signal(false), isPersisted: signal(null) },
        },
        {
          provide: ThemeService,
          useValue: {
            preference: signal('system'),
            palette: signal(PALETTES[0]),
            setPreference: vi.fn(),
            setPalette: vi.fn(),
          },
        },
      ],
    })
    vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true)
    fixture = TestBed.createComponent(AccountPage)
    fixture.detectChanges()
  })

  it('links the profiles page and names the current profile', () => {
    TestBed.inject(AuthStore).user.set({ displayName: 'mom', email: 'm@example.com' } as AuthUser)
    fixture.detectChanges()
    const link = page().querySelector('a[href="/account/profiles"]')
    expect(link?.textContent).toContain(th.account.profiles)
    expect(link?.textContent).toContain('ใช้อยู่: ส่วนตัว · ทั้งหมด 2')
  })

  it('groups rows that each open a page, with a line on what is there (A1)', () => {
    const headings = [...page().querySelectorAll('h2')].map((h) => h.textContent.trim())
    expect(headings).toEqual([
      th.account.group.data,
      th.account.group.security,
      th.account.group.settings,
    ])
    const links = [...page().querySelectorAll('a')].map((a) => a.getAttribute('href'))
    expect(links).toEqual([
      '/account/profiles',
      '/account/categories',
      '/account/security',
      '/account/appearance',
      '/account/device',
    ])
    const text = page().textContent
    expect(text).toContain('ของโปรไฟล์ ส่วนตัว')
    expect(text).toContain('ไทย · ตามระบบ · Midnight Gold')
    expect(text).toContain('เปิดในเบราว์เซอร์ · ไม่รองรับการเก็บถาวร')
  })

  it('pushes first, then signs out and wipes when everything is synced (rule 7)', async () => {
    button(th.account.signOut)?.click()
    await settle()
    expect(syncService.flush).toHaveBeenCalledOnce()
    expect(authService.signOut).toHaveBeenCalledOnce()
    expect(offlineService.wipe).toHaveBeenCalledOnce()
  })

  it('asks before losing ops that could not be pushed, and can cancel', async () => {
    syncService.flush.mockResolvedValue(2)
    button(th.account.signOut)?.click()
    await settle()
    expect(page().textContent).toContain('ยังมี 2 รายการที่ยังไม่ได้ sync')
    expect(authService.signOut).not.toHaveBeenCalled()
    button(th.account.cancel)?.click()
    fixture.detectChanges()
    expect(page().textContent).not.toContain('ยังมี 2 รายการ')
  })

  it('signs out anyway once confirmed', async () => {
    syncService.flush.mockResolvedValue(1)
    button(th.account.signOut)?.click()
    await settle()
    button(th.account.signOutUnsyncedConfirm)?.click()
    await settle()
    expect(authService.signOut).toHaveBeenCalledOnce()
    expect(offlineService.wipe).toHaveBeenCalledOnce()
  })
})
