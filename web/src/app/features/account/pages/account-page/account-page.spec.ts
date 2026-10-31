import { signal } from '@angular/core'
import { TestBed } from '@angular/core/testing'
import type { ComponentFixture } from '@angular/core/testing'
import { provideRouter, Router } from '@angular/router'
import { TranslocoTestingModule } from '@jsverse/transloco'
import { AuthService } from '@/core/auth'
import th from '@/core/i18n/th.json'
import { OfflineService, SyncService } from '@/core/offline'
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

  it('links the sync test page only while the server syncs the probe table', () => {
    expect(page().textContent).not.toContain(th.account.syncTest)
    syncService.serverTables.set(['currencies', 'sync_probes'])
    fixture.detectChanges()
    expect(page().querySelector('a[href="/account/sync-test"]')).not.toBeNull()
  })
})
