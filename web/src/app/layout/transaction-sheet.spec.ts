import { signal } from '@angular/core'
import { TestBed } from '@angular/core/testing'
import type { ComponentFixture } from '@angular/core/testing'
import { TranslocoTestingModule } from '@jsverse/transloco'
import { toastState } from '@spartan-ng/brain/sonner'
import { AuthStore } from '@/core/auth'
import type { AuthUser } from '@/core/auth'
import th from '@/core/i18n/th.json'
import { NetworkStatusService } from '@/core/network'
import { findOp, getRow, listOps, OfflineService, putRow, SyncService } from '@/core/offline'
import type { LocalDatabase } from '@/core/offline'
import { openTestDatabase } from '@/core/offline/testing-db'
import { TransactionService } from '@/core/transaction'
import { TransactionSheet } from './transaction-sheet'

describe('TransactionSheet', () => {
  let fixture: ComponentFixture<TransactionSheet>
  let db: LocalDatabase
  let transactions: TransactionService
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
    lastSyncedAt: signal<number | null>(1),
    rejectedOp: (opId: string) => findOp(db, opId),
  }
  const base = { createdAt: 1, updatedAt: 1, deletedAt: null, changeSeq: 5, updatedBy: 'u1' }

  const body = () => document.body
  const text = () => body().textContent
  /** A button by its text or aria-label, or (prefix) the first whose aria-label starts so. */
  const button = (label: string, prefix = false) =>
    [...body().querySelectorAll('button')].find((b) => {
      const aria = b.getAttribute('aria-label') ?? ''
      return prefix ? aria.startsWith(label) : b.textContent.trim() === label || aria === label
    })
  const settle = async () => {
    fixture.detectChanges()
    await fixture.whenStable()
    fixture.detectChanges()
  }
  const click = async (label: string, prefix = false) => {
    button(label, prefix)?.click()
    await settle()
  }
  const keys = async (...labels: string[]) => {
    for (const label of labels) {
      await click(label)
    }
  }
  const submit = async () => {
    body().querySelector('form')?.dispatchEvent(new Event('submit'))
    await settle()
  }
  const open = async (state: Parameters<TransactionService['open']>[0]) => {
    transactions.open(state)
    await settle()
  }
  const wallet = (id: string, extra: object = {}) => {
    putRow(db, 'wallets', {
      ...base,
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
    changes.update((n) => n + 1)
  }
  const category = (id: string, extra: object = {}) => {
    putRow(db, 'categories', {
      ...base,
      id,
      profileId: 'p1',
      type: 'expense',
      parentId: null,
      name: id,
      icon: 'lucideShapes',
      color: '#475569',
      isArchived: false,
      sortOrder: 0,
      ...extra,
    })
    changes.update((n) => n + 1)
  }

  beforeEach(async () => {
    db = await openTestDatabase()
    localStorage.clear()
    trusted.set(true)
    online.set(true)
    toastState.dismiss()
    putRow(db, 'profiles', {
      ...base,
      id: 'p1',
      name: 'Home',
      icon: 'lucideHouse',
      color: '#16a34a',
      sortOrder: 0,
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
        {
          provide: NetworkStatusService,
          useValue: { isOnline: online, serverReachable: signal(true) },
        },
      ],
    })
    TestBed.inject(AuthStore).user.set({ id: 'u1' } as AuthUser)
    transactions = TestBed.inject(TransactionService)
    wallet('Cash')
    wallet('Card', { sortOrder: 1 })
    category('Food')
    category('Coffee', { parentId: 'Food' })
    category('Old', { isArchived: true })
    category('Salary', { type: 'income' })
    fixture = TestBed.createComponent(TransactionSheet)
    await settle()
  })

  afterEach(() => {
    fixture.destroy()
    db.close()
    toastState.dismiss()
  })

  it('adds an expense typed on the keypad: the expression settles, the category is picked', async () => {
    await open({ mode: 'create' })
    expect(body().querySelector('[role="group"]')).not.toBeNull()
    await keys('1', '2', '0', 'เครื่องหมายบวก', '6', '5')
    expect(text()).toContain('120+65')
    expect(text()).toContain('= 185.00')
    await click('หมวดหมู่ ', true)
    await click('Coffee')
    expect(text()).toContain('185')
    await submit()
    const [op] = listOps(db, 'pending')
    expect(getRow(db, 'transactions', op.rowId)).toMatchObject({
      profileId: 'p1',
      walletId: 'Cash',
      categoryId: 'Coffee',
      amount: 18500,
      note: '',
      excludeFromReport: false,
    })
    expect(transactions.sheet()).toBeNull()
  })

  it('needs an amount above 0 and a category before saving', async () => {
    await open({ mode: 'create' })
    await submit()
    expect(text()).toContain(th.transactions.amountRequired)
    expect(text()).toContain(th.transactions.categoryRequired)
    expect(listOps(db, 'pending')).toEqual([])
  })

  it("offers the wallet's open, non-hidden categories of the type, and says when none is left", async () => {
    wallet('Card', { sortOrder: 1, hiddenCategoryIds: ['Food', 'Salary'] })
    await open({ mode: 'create', walletId: 'Card' })
    await click('หมวดหมู่ ', true)
    expect(text()).not.toContain('Old')
    expect(text()).not.toContain('Coffee') // follows its hidden parent
    expect(text()).toContain(th.transactions.noCategories.expense.replace('{{name}}', 'Card'))
    expect(button(th.transactions.toWalletCategories)).toBeDefined()
  })

  it('drops a category of the other type when the type changes', async () => {
    await open({ mode: 'create' })
    await click('หมวดหมู่ ', true)
    await click('Food')
    ;[...body().querySelectorAll('label')]
      .find((label) => label.textContent.trim() === th.categories.income)
      ?.click()
    await settle()
    expect(text()).toContain(th.transactions.pickCategory)
  })

  it('edits a row with the keypad closed, and deletes it at once with undo in the toast', async () => {
    putRow(db, 'transactions', {
      ...base,
      id: 't1',
      profileId: 'p1',
      walletId: 'Cash',
      categoryId: 'Coffee',
      amount: 6500,
      occurredOn: '2026-11-02',
      note: 'ลาเต้เย็น',
      excludeFromReport: false,
    })
    changes.update((n) => n + 1)
    await open({ mode: 'edit', id: 't1' })
    expect(body().querySelector('[role="group"]')).toBeNull()
    expect(text()).toContain('65')
    expect(text()).toContain('ลาเต้เย็น')
    await click(th.transactions.delete)
    expect(transactions.byId('t1')).toBeNull()
    expect(toastState.toasts().map((toast) => toast.title)).toContain(th.transactions.deleted)
  })

  it('opens the folded options by itself for a row left out of reports', async () => {
    putRow(db, 'transactions', {
      ...base,
      id: 't1',
      profileId: 'p1',
      walletId: 'Cash',
      categoryId: 'Food',
      amount: 100,
      occurredOn: '2026-11-02',
      note: '',
      excludeFromReport: true,
    })
    changes.update((n) => n + 1)
    await open({ mode: 'edit', id: 't1' })
    expect(text()).toContain(th.transactions.excludeFromReport)
    await open({ mode: 'create' })
    expect(text()).not.toContain(th.transactions.excludeFromReport)
  })

  it('blocks saving on an untrusted device offline, and says why', async () => {
    trusted.set(false)
    online.set(false)
    await open({ mode: 'create' })
    expect(text()).toContain(th.transactions.needsOnline)
    expect(button(th.transactions.save)?.disabled).toBe(true)
  })
})
