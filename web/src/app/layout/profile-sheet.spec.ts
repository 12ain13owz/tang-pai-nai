import { signal } from '@angular/core'
import { TestBed } from '@angular/core/testing'
import type { ComponentFixture } from '@angular/core/testing'
import { TranslocoTestingModule } from '@jsverse/transloco'
import { AuthStore } from '@/core/auth'
import type { AuthUser } from '@/core/auth'
import th from '@/core/i18n/th.json'
import { NetworkStatusService } from '@/core/network'
import { findOp, listOps, OfflineService, putRow, SyncService } from '@/core/offline'
import type { LocalDatabase } from '@/core/offline'
import { openTestDatabase } from '@/core/offline/testing-db'
import { ProfileService } from '@/core/profile'
import { ProfileSheet } from './profile-sheet'

describe('ProfileSheet', () => {
  let fixture: ComponentFixture<ProfileSheet>
  let db: LocalDatabase
  let profiles: ProfileService
  const changes = signal(0)
  const trusted = signal(true)
  const online = signal(true)

  const offline = {
    isOpen: signal(true),
    isTrusted: trusted,
    meta: signal(null),
    changes,
    db: () => db,
    write: <T>(work: (database: LocalDatabase) => T): T => {
      const result = db.transaction(work)
      changes.update((n) => n + 1)
      return result
    },
  }
  const sync = {
    canSync: signal(false),
    isSyncing: signal(false),
    lastSyncedAt: signal<number | null>(null),
    rejectedOp: (opId: string) => findOp(db, opId),
  }

  const body = () => document.body
  const button = (label: string) =>
    [...body().querySelectorAll('button')].find((b) => b.textContent.trim() === label)
  const nameInput = () => body().querySelector('input[autocomplete="off"]') as HTMLInputElement
  const type = (value: string) => {
    nameInput().value = value
    nameInput().dispatchEvent(new Event('input'))
  }
  const settle = async () => {
    fixture.detectChanges()
    await fixture.whenStable()
    fixture.detectChanges()
  }
  const open = async (state: Parameters<ProfileService['open']>[0]) => {
    profiles.open(state)
    await settle()
  }
  const submit = async () => {
    body().querySelector('form')?.dispatchEvent(new Event('submit'))
    await settle()
  }
  const pulled = (id: string, name: string, sortOrder = 0) => {
    putRow(db, 'profiles', {
      id,
      name,
      icon: 'lucideHouse',
      color: '#16a34a',
      sortOrder,
      createdAt: 1,
      updatedAt: 1,
      deletedAt: null,
      changeSeq: 5,
      updatedBy: 'u1',
    })
    changes.update((n) => n + 1)
  }

  beforeEach(async () => {
    db = await openTestDatabase()
    localStorage.clear()
    trusted.set(true)
    online.set(true)
    TestBed.configureTestingModule({
      imports: [
        TranslocoTestingModule.forRoot({
          langs: { th },
          translocoConfig: { availableLangs: ['th'], defaultLang: 'th' },
          preloadLangs: true,
        }),
      ],
      providers: [
        { provide: OfflineService, useValue: offline },
        { provide: SyncService, useValue: sync },
        { provide: NetworkStatusService, useValue: { isOnline: online } },
      ],
    })
    TestBed.inject(AuthStore).user.set({ id: 'u1' } as AuthUser)
    profiles = TestBed.inject(ProfileService)
    fixture = TestBed.createComponent(ProfileSheet)
    await settle()
  })

  afterEach(() => {
    fixture.destroy()
    db.close()
  })

  it('creates a profile with the picked icon and colour, then closes', async () => {
    await open({ mode: 'create' })
    expect(body().textContent).toContain(th.profiles.createHeading)
    type('  ร้านกาแฟ ')
    const store = body().querySelector(
      `input[aria-label="${th.icons.lucideStore}"]`
    ) as HTMLInputElement
    store.click()
    const orange = body().querySelector('input[aria-label="สีที่ 6"]') as HTMLInputElement
    orange.click()
    await submit()
    expect(profiles.profiles()).toMatchObject([
      { name: 'ร้านกาแฟ', icon: 'lucideStore', color: '#ea580c' },
    ])
    expect(profiles.current()?.name).toBe('ร้านกาแฟ')
    expect(profiles.sheet()).toBeNull()
  })

  it('refuses an empty name and a name already in use, in place', async () => {
    pulled('p1', 'Home')
    await open({ mode: 'create' })
    await submit()
    expect(body().textContent).toContain(th.profiles.nameRequired)
    type('HOME')
    await settle()
    expect(body().textContent).toContain(th.profiles.nameTaken)
    expect(listOps(db, 'pending')).toHaveLength(0)
  })

  it('edits a profile without counting its own name as taken', async () => {
    pulled('p1', 'Home')
    await open({ mode: 'edit', id: 'p1' })
    expect(nameInput().value).toBe('Home')
    await submit()
    expect(listOps(db, 'pending')).toHaveLength(1)
    expect(profiles.sheet()).toBeNull()
  })

  it('asks before throwing away unsaved input, and can go back to it', async () => {
    await open({ mode: 'create' })
    type('ครอบครัว')
    button(th.sheet.close)?.click()
    await settle()
    expect(body().textContent).toContain(th.profiles.discardHeading)
    button(th.profiles.keepEditing)?.click()
    await settle()
    expect(nameInput().value).toBe('ครอบครัว')
    button(th.sheet.close)?.click()
    await settle()
    button(th.profiles.discard)?.click()
    await settle()
    expect(profiles.sheet()).toBeNull()
    expect(profiles.profiles()).toHaveLength(0)
  })

  it('deletes a profile only after the confirm step (rule 8)', async () => {
    pulled('p1', 'Home')
    pulled('p2', 'Work', 1)
    await open({ mode: 'edit', id: 'p2' })
    button(th.profiles.delete)?.click()
    await settle()
    expect(body().textContent).toContain('ลบโปรไฟล์ “Work” ใช่ไหม')
    button(th.sheet.back)?.click()
    await settle()
    expect(profiles.profiles()).toHaveLength(2)
    button(th.profiles.delete)?.click()
    await settle()
    button(th.profiles.deleteConfirm)?.click()
    await settle()
    expect(profiles.profiles().map((profile) => profile.name)).toEqual(['Home'])
  })

  it('opens a fix with the refused values and their error showing', async () => {
    pulled('p1', 'Home')
    await open({
      mode: 'fix',
      opId: 'o1',
      id: 'p9',
      values: { name: 'home', icon: 'lucideStar', color: '#2563eb' },
    })
    expect(body().textContent).toContain(th.profiles.fixHeading)
    expect(nameInput().value).toBe('home')
    expect(body().textContent).toContain(th.profiles.nameTaken)
  })

  it('says an untrusted device must be online, and blocks saving', async () => {
    trusted.set(false)
    online.set(false)
    await open({ mode: 'create' })
    expect(body().textContent).toContain(th.profiles.needsOnline)
    expect(button(th.profiles.save)?.disabled).toBe(true)
  })
})
