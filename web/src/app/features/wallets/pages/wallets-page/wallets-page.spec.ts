import { signal } from '@angular/core'
import { TestBed } from '@angular/core/testing'
import type { ComponentFixture } from '@angular/core/testing'
import { TranslocoTestingModule } from '@jsverse/transloco'
import { AuthStore } from '@/core/auth'
import type { AuthUser } from '@/core/auth'
import th from '@/core/i18n/th.json'
import { NetworkStatusService } from '@/core/network'
import { findOp, OfflineService, putRow, SyncService } from '@/core/offline'
import type { LocalDatabase } from '@/core/offline'
import { openTestDatabase } from '@/core/offline/testing-db'
import { WalletService } from '@/core/wallet'
import { WalletsPage } from './wallets-page'

describe('WalletsPage', () => {
  let fixture: ComponentFixture<WalletsPage>
  let db: LocalDatabase
  let wallets: WalletService
  const changes = signal(0)

  const offline = {
    isOpen: signal(true),
    isTrusted: signal(true),
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
    lastSyncedAt: signal<number | null>(1),
    rejectedOp: (opId: string) => findOp(db, opId),
  }

  const page = () => fixture.nativeElement as HTMLElement
  const text = () => page().textContent.replace(/\s+/g, ' ')
  const button = (label: string | RegExp) =>
    [...page().querySelectorAll('button')].find((b) => {
      const name = b.getAttribute('aria-label') ?? b.textContent.trim()
      return typeof label === 'string' ? name === label : label.test(name)
    })
  const rows = () =>
    [...page().querySelectorAll('ul')[0].querySelectorAll('li')].map((li) =>
      li.querySelector('span.truncate')?.textContent.trim()
    )
  const settle = async () => {
    fixture.detectChanges()
    await fixture.whenStable()
    fixture.detectChanges()
  }
  const wallet = (id: string, extra: object = {}) => {
    putRow(db, 'wallets', {
      id,
      profileId: 'p1',
      name: id,
      currencyCode: 'THB',
      initialBalance: 0,
      icon: 'lucideWallet',
      color: '#16a34a',
      excludeFromTotal: false,
      isArchived: false,
      sortOrder: 0,
      createdAt: 1,
      updatedAt: 1,
      deletedAt: null,
      changeSeq: 5,
      updatedBy: 'u1',
      ...extra,
    })
    changes.update((n) => n + 1)
  }

  beforeEach(async () => {
    db = await openTestDatabase()
    localStorage.clear()
    putRow(db, 'profiles', {
      id: 'p1',
      name: 'Home',
      icon: 'lucideHouse',
      color: '#16a34a',
      sortOrder: 0,
      createdAt: 1,
      updatedAt: 1,
      deletedAt: null,
      changeSeq: 1,
      updatedBy: 'u1',
    })
    putRow(db, 'currencies', {
      code: 'THB',
      minorUnit: 2,
      isActive: true,
      sortOrder: 0,
      createdAt: 1,
      updatedAt: 1,
      changeSeq: 1,
    })
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
        { provide: NetworkStatusService, useValue: { isOnline: signal(true) } },
      ],
    })
    TestBed.inject(AuthStore).user.set({ id: 'u1' } as AuthUser)
    wallets = TestBed.inject(WalletService)
    fixture = TestBed.createComponent(WalletsPage)
  })

  afterEach(() => {
    fixture.destroy()
    db.close()
  })

  it('shows the total of what counts, then the wallets with their balances (rules 6, 7)', async () => {
    wallet('Cash', { initialBalance: 150050, sortOrder: 0 })
    wallet('Card', { initialBalance: -1825075, sortOrder: 1 })
    wallet('Gold', { initialBalance: 4500000, sortOrder: 2, excludeFromTotal: true })
    wallet('Old', { initialBalance: 999, sortOrder: 3, isArchived: true })
    await settle()
    expect(text()).toContain(`${th.wallets.total} -฿16,750.25`)
    expect(rows()).toEqual(['Cash', 'Card', 'Gold'])
    expect(text()).toContain('Card -฿18,250.75')
    expect(text()).toContain(`Gold ${th.wallets.excluded} ฿45,000.00`)
    expect(text()).toContain('กระเป๋าที่ใช้อยู่ (3)')
  })

  it('shows ฿0.00 while nothing counts toward the total', async () => {
    wallet('Gold', { initialBalance: 100, excludeFromTotal: true })
    await settle()
    expect(text()).toContain(`${th.wallets.total} ฿0.00`)
  })

  it('folds the archived wallets away until the group is opened', async () => {
    wallet('Cash')
    wallet('Old', { isArchived: true })
    await settle()
    const toggle = button(/เก็บถาวร \(1\)/)
    expect(toggle?.getAttribute('aria-expanded')).toBe('false')
    expect(text()).not.toContain('Old ฿')
    toggle?.click()
    await settle()
    expect(toggle?.getAttribute('aria-expanded')).toBe('true')
    expect(text()).toContain('Old ฿0.00')
  })

  it('opens a wallet in the sheet, and the add button in create mode', async () => {
    wallet('Cash')
    await settle()
    button('แก้ไข Cash ยอดเงิน ฿0.00')?.click()
    expect(wallets.sheet()).toEqual({ mode: 'edit', id: 'Cash' })
    button(/เพิ่มกระเป๋าเงิน/)?.click()
    expect(wallets.sheet()).toEqual({ mode: 'create' })
  })

  it('hides "add" at 20 open wallets and says why (rule 3)', async () => {
    for (let i = 0; i < 20; i++) {
      wallet(`w${i}`, { sortOrder: i })
    }
    await settle()
    expect(button(/เพิ่มกระเป๋าเงิน/)).toBeUndefined()
    expect(text()).toContain(th.wallets.limit)
  })

  it('reorders in order mode with the handle’s arrow keys, twice in a row (rule 10)', async () => {
    wallet('a', { sortOrder: 0 })
    wallet('b', { sortOrder: 1 })
    wallet('c', { sortOrder: 2 })
    await settle()
    button(th.wallets.order)?.click()
    await settle()
    const handle = button(/ย้าย c/) as HTMLButtonElement
    handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp' }))
    handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp' }))
    await settle()
    expect(rows()).toEqual(['c', 'a', 'b'])
    button(th.wallets.orderDone)?.click()
    await settle()
    expect(button(/ย้าย/)).toBeUndefined()
  })
})
