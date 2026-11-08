import { signal } from '@angular/core'
import { TestBed } from '@angular/core/testing'
import type { ComponentFixture } from '@angular/core/testing'
import { provideRouter } from '@angular/router'
import { TranslocoTestingModule } from '@jsverse/transloco'
import { toastState } from '@spartan-ng/brain/sonner'
import { AuthStore } from '@/core/auth'
import type { AuthUser } from '@/core/auth'
import th from '@/core/i18n/th.json'
import { NetworkStatusService } from '@/core/network'
import { findOp, OfflineService, putRow, SyncService } from '@/core/offline'
import type { LocalDatabase } from '@/core/offline'
import { openTestDatabase } from '@/core/offline/testing-db'
import { TransactionService, TransferService } from '@/core/transaction'
import { RecurringPage } from './recurring-page'

describe('RecurringPage', () => {
  let fixture: ComponentFixture<RecurringPage>
  let db: LocalDatabase
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
    rounds: signal(0),
    lastSyncedAt: signal<number | null>(1),
    rejectedOp: (opId: string) => findOp(db, opId),
  }
  const base = { createdAt: 1, updatedAt: 1, deletedAt: null, changeSeq: 1, updatedBy: 'u1' }
  const put = (table: string, row: object) => {
    putRow(db, table, { ...base, ...row })
    changes.update((n) => n + 1)
  }
  const rule = (id: string, extra: object = {}) =>
    put('recurring_rules', {
      id,
      profileId: 'p1',
      kind: 'transaction',
      walletId: 'bank',
      categoryId: 'rent',
      toWalletId: null,
      amount: 850000,
      note: '',
      excludeFromReport: false,
      startOn: '2026-10-01',
      frequency: 'month',
      interval: 1,
      endOn: null,
      endCount: null,
      confirm: false,
      nextOn: '2026-12-01',
      isPaused: false,
      ...extra,
    })
  const wallet = (id: string, extra: object = {}) =>
    put('wallets', {
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
      ...extra,
    })
  const text = () => (fixture.nativeElement as HTMLElement).textContent
  const settle = async () => {
    fixture.detectChanges()
    await fixture.whenStable()
    fixture.detectChanges()
  }

  beforeEach(async () => {
    toastState.dismiss()
    db = await openTestDatabase()
    localStorage.clear()
    put('profiles', { id: 'p1', name: 'Home', icon: 'lucideHouse', color: '#16a34a', sortOrder: 0 })
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
        provideRouter([]),
        { provide: OfflineService, useValue: offline },
        { provide: SyncService, useValue: sync },
        {
          provide: NetworkStatusService,
          useValue: { isOnline: signal(true), serverReachable: signal(true) },
        },
      ],
    })
    TestBed.inject(AuthStore).user.set({ id: 'u1' } as AuthUser)
    TestBed.inject(TransactionService).today.set('2026-11-08')
    wallet('bank')
    wallet('save', { sortOrder: 1 })
    wallet('old', { sortOrder: 2, isArchived: true })
    put('categories', {
      id: 'rent',
      profileId: 'p1',
      type: 'expense',
      parentId: null,
      name: 'Rent',
      icon: 'lucideShapes',
      color: '#475569',
      isArchived: false,
      sortOrder: 0,
    })
  })

  afterEach(() => {
    fixture.destroy()
    db.close()
    toastState.dismiss()
  })

  it('groups the rules: active by next date, paused or stopped with why, ended folded (Q5, rule 12)', async () => {
    rule('a1', { note: 'ห้อง' })
    rule('a2', { kind: 'transfer', categoryId: null, toWalletId: 'save', nextOn: '2026-11-26' })
    rule('ask', { confirm: true, nextOn: '2026-11-05' })
    rule('paused', { isPaused: true })
    rule('stopped', { walletId: 'old' })
    rule('ended', { nextOn: null, endCount: 2 })
    fixture = TestBed.createComponent(RecurringPage)
    await settle()
    const headings = [
      ...(fixture.nativeElement as HTMLElement).querySelectorAll('h2, button[aria-expanded]'),
    ].map((el) => el.textContent.trim())
    expect(headings).toEqual(['ใช้อยู่ (3)', 'หยุดไว้ (2)', 'สิ้นสุดแล้ว (1)'])
    expect(text()).toContain('โอนเงิน bank → save')
    expect(text()).toContain(th.recurring.askTag)
    expect(text()).toContain('ถึงกำหนด 5 พ.ย.')
    expect(text()).toContain('กระเป๋า "old" ถูกเก็บถาวร')
    expect(text()).toMatch(/[−-]8,500\.00/)
    expect(text()).not.toContain('2 ครั้ง')
    ;(fixture.nativeElement as HTMLElement)
      .querySelector<HTMLElement>('button[aria-expanded]')
      ?.click()
    await settle()
    expect(text()).toContain('0 จาก 2 ครั้ง')
  })

  it('opens a rule in its sheet, and adds one with "ทำซ้ำ" set', async () => {
    rule('a1')
    rule('t1', { kind: 'transfer', categoryId: null, toWalletId: 'save' })
    fixture = TestBed.createComponent(RecurringPage)
    await settle()
    const rows = [
      ...(fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>('li button'),
    ]
    rows[0].click()
    expect(TestBed.inject(TransactionService).sheet()).toEqual({ mode: 'rule', id: 'a1' })
    rows[1].click()
    expect(TestBed.inject(TransferService).sheet()).toEqual({ mode: 'rule', id: 't1' })
    const add = [...(fixture.nativeElement as HTMLElement).querySelectorAll('button')].find(
      (b) => b.textContent.trim() === th.recurring.add
    )
    add?.click()
    expect(TestBed.inject(TransactionService).sheet()).toEqual({ mode: 'create', repeat: true })
  })

  it('says how to start when there is none', async () => {
    fixture = TestBed.createComponent(RecurringPage)
    await settle()
    expect(text()).toContain(th.recurring.emptyHeading)
  })
})
