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
import { occurrenceId, RecurringService } from '@/core/recurring'
import { QuickAmountsService, TransactionService } from '@/core/transaction'
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
    rounds: signal(0),
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

  it('drops a category the newly chosen wallet hides', async () => {
    wallet('Card', { sortOrder: 1, hiddenCategoryIds: ['Food'] })
    await open({ mode: 'create', walletId: 'Cash' })
    await click('หมวดหมู่ ', true)
    await click('Food')
    await click('กระเป๋าเงิน ', true)
    await click('Card')
    expect(text()).toContain(th.transactions.pickCategory)
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

  const keypad = () => body().querySelector(`[role="group"][aria-label="${th.keypad.label}"]`)
  const quickRow = () =>
    body().querySelector(`[role="group"][aria-label="${th.keypad.quickLabel}"]`)
  const quick = async (amount: string) => click(th.keypad.quickAdd.replace('{{ amount }}', amount))
  const coffeeRow = (id: string, extra: object = {}) => {
    putRow(db, 'transactions', {
      ...base,
      id,
      profileId: 'p1',
      walletId: 'Card',
      categoryId: 'Coffee',
      amount: 6500,
      occurredOn: '2026-11-01',
      note: 'ลาเต้เย็น',
      excludeFromReport: false,
      ...extra,
    })
    changes.update((n) => n + 1)
  }

  it('adds quick amounts like counting notes (8.2)', async () => {
    await open({ mode: 'create' })
    expect(quickRow()).not.toBeNull()
    await quick('500')
    await quick('100')
    expect(text()).toContain('500+100')
    expect(text()).toContain('= 600.00')
  })

  it('shows the amount grouped in thousands while the form keeps the plain figures', async () => {
    await open({ mode: 'create' })
    await keys('8', '5', '0', '0')
    expect(text()).toContain('8,500')
    await quick('1,000')
    expect(text()).toContain('8,500+1,000')
    await click('หมวดหมู่ ', true)
    await click('Food')
    await submit()
    const [op] = listOps(db, 'pending')
    expect(getRow(db, 'transactions', op.rowId)?.['amount']).toBe(950000)
  })

  it('leaves the quick amounts out when they are turned off', async () => {
    TestBed.inject(QuickAmountsService).setEnabled(false)
    await open({ mode: 'create' })
    expect(keypad()).not.toBeNull()
    expect(quickRow()).toBeNull()
  })

  it('closes the keypad when another control is used, and opens it again on the amount row', async () => {
    await open({ mode: 'create' })
    await keys('1', '2', '0', 'เครื่องหมายบวก', '6', '5')
    button(th.transactions.dayBefore)?.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    await settle()
    expect(keypad()).toBeNull()
    expect(text()).toContain('185')
    expect(text()).not.toContain('120+65')
    await click(th.transactions.amount, true)
    expect(keypad()).not.toBeNull()
    // A tap on blank space keeps it.
    body()
      .querySelector('form .flex.flex-col.gap-4')
      ?.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    await settle()
    expect(keypad()).not.toBeNull()
  })

  it('saves and stays for the next one: same wallet, category and date, empty amount (8.2)', async () => {
    await open({ mode: 'create', walletId: 'Card', occurredOn: '2026-10-31' })
    await quick('50')
    await click('หมวดหมู่ ', true)
    await click('Coffee')
    await click(th.transactions.saveAndAdd)
    expect(listOps(db, 'pending')).toHaveLength(1)
    expect(transactions.sheet()?.mode).toBe('create')
    expect(keypad()).not.toBeNull()
    expect(button('หมวดหมู่ Coffee')).toBeDefined()
    await quick('20')
    await submit()
    const rows = listOps(db, 'pending').map((op) => getRow(db, 'transactions', op.rowId))
    expect(
      rows.map((row) => [
        row?.['walletId'],
        row?.['categoryId'],
        row?.['amount'],
        row?.['occurredOn'],
      ])
    ).toEqual([
      ['Card', 'Coffee', 5000, '2026-10-31'],
      ['Card', 'Coffee', 2000, '2026-10-31'],
    ])
    expect(transactions.sheet()).toBeNull()
  })

  it('copies a row as a new one dated today, leaving the row as it was (8.2)', async () => {
    transactions.today.set('2026-11-02')
    coffeeRow('t1')
    await open({ mode: 'edit', id: 't1' })
    await click(th.transactions.copy)
    expect(transactions.sheet()?.mode).toBe('create')
    expect(text()).toContain(th.transactions.createHeading)
    await submit()
    const [op] = listOps(db, 'pending')
    expect(op.rowId).not.toBe('t1')
    expect(getRow(db, 'transactions', op.rowId)).toMatchObject({
      walletId: 'Card',
      categoryId: 'Coffee',
      amount: 6500,
      occurredOn: '2026-11-02',
      note: 'ลาเต้เย็น',
    })
    expect(transactions.byId('t1')?.occurredOn).toBe('2026-11-01')
  })

  it('shows the most used categories on top of the picker, the tree in its own order (8.2)', async () => {
    transactions.today.set('2026-11-02')
    await open({ mode: 'create' })
    await click('หมวดหมู่ ', true)
    expect(text()).not.toContain(th.transactions.frequent)
    await click(th.sheet.back)
    coffeeRow('t1')
    coffeeRow('t2', { categoryId: 'Old' }) // archived: not offered
    await click('หมวดหมู่ ', true)
    const frequent = body().querySelector(`ul[aria-label="${th.transactions.frequent}"]`)
    expect(frequent?.textContent).toContain('Coffee')
    expect(frequent?.textContent).not.toContain('Old')
  })

  it('starts on the type of the last one added', async () => {
    transactions.rememberType('income')
    await open({ mode: 'create' })
    await click('หมวดหมู่ ', true)
    expect(text()).toContain('Salary')
    expect(text()).not.toContain('Coffee')
  })

  it('blocks saving on an untrusted device offline, and says why', async () => {
    trusted.set(false)
    online.set(false)
    await open({ mode: 'create' })
    expect(text()).toContain(th.transactions.needsOnline)
    expect(button(th.transactions.save)?.disabled).toBe(true)
  })

  describe('recurring (docs/features/recurring.md)', () => {
    const rule = (id: string, extra: object = {}) => {
      putRow(db, 'recurring_rules', {
        ...base,
        id,
        profileId: 'p1',
        kind: 'transaction',
        walletId: 'Cash',
        categoryId: 'Food',
        toWalletId: null,
        amount: 85000,
        note: 'rent',
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
      changes.update((n) => n + 1)
    }
    /** A radio of the "ทำซ้ำ" view by the text of its row. */
    const choose = async (label: string) => {
      const row = [...body().querySelectorAll('label')].find((el) =>
        el.textContent.trim().startsWith(label)
      )
      row?.querySelector<HTMLInputElement>('input[type="radio"]')?.click()
      await settle()
    }

    beforeEach(() => {
      transactions.today.set('2026-11-08')
    })

    it('repeats from the form: a rule and its first occurrence in one save (rule 8, Q5)', async () => {
      await open({ mode: 'create', occurredOn: '2026-11-01' })
      await keys('8', '5', '0')
      await click('หมวดหมู่ ', true)
      await click('Food')
      await click(th.transactions.more)
      await click(th.recurring.repeat, true)
      await choose(th.recurring.preset.month)
      await choose(th.recurring.ask)
      await click(th.sheet.back)
      expect(text()).toContain('ทุกเดือน วันที่ 1')
      expect(text()).toContain(th.recurring.start)
      // Save and add another hides while a rule is set.
      expect(button(th.transactions.saveAndAdd)).toBeUndefined()
      await submit()
      const [stored] = db.selectObjects('SELECT id FROM recurring_rules')
      const ruleId = String(stored['id'])
      expect(getRow(db, 'recurring_rules', ruleId)).toMatchObject({
        kind: 'transaction',
        walletId: 'Cash',
        categoryId: 'Food',
        amount: 85000,
        startOn: '2026-11-01',
        frequency: 'month',
        confirm: true,
        nextOn: '2026-12-01',
      })
      expect(getRow(db, 'transactions', occurrenceId(ruleId, '2026-11-01'))).toMatchObject({
        amount: 85000,
        recurringId: ruleId,
      })
      expect(toastState.toasts().at(0)?.title).toBe(th.recurring.created)
    })

    it('edits a rule in its sheet; pause and delete sit in the header (rules 4–6)', async () => {
      rule('r1')
      await open({ mode: 'rule', id: 'r1' })
      expect(text()).toContain(th.recurring.editHeading)
      expect(text()).toContain('ทุกเดือน วันที่ 1')
      await click('จำนวนเงิน', true)
      await keys('C', '9', '0', '0')
      await submit()
      expect(getRow(db, 'recurring_rules', 'r1')).toMatchObject({
        amount: 90000,
        nextOn: '2026-12-01',
      })
      await open({ mode: 'rule', id: 'r1' })
      await click(th.recurring.pause)
      expect(getRow(db, 'recurring_rules', 'r1')?.['isPaused']).toBe(true)
      await click(th.recurring.delete)
      expect(TestBed.inject(RecurringService).byId('r1')).toBeNull()
      expect(transactions.sheet()).toBeNull()
    })

    it("records a due occurrence with this month's amount (rule 10)", async () => {
      rule('r1', { confirm: true, nextOn: '2026-11-01' })
      await open({
        mode: 'create',
        occurrence: { ruleId: 'r1', on: '2026-11-01' },
        values: {
          walletId: 'Cash',
          categoryId: 'Food',
          amount: 85000,
          occurredOn: '2026-11-01',
          note: 'rent',
          excludeFromReport: false,
        },
      })
      expect(button(th.recurring.repeat, true)).toBeUndefined()
      await keys('C', '9', '1', '2')
      await submit()
      expect(getRow(db, 'transactions', occurrenceId('r1', '2026-11-01'))).toMatchObject({
        amount: 91200,
        occurredOn: '2026-11-01',
        recurringId: 'r1',
      })
      expect(getRow(db, 'recurring_rules', 'r1')?.['nextOn']).toBe('2026-12-01')
    })

    it('shows the rule an occurrence came from, and opens it (rule 11)', async () => {
      rule('r1')
      putRow(db, 'transactions', {
        ...base,
        id: 't1',
        profileId: 'p1',
        walletId: 'Cash',
        categoryId: 'Food',
        amount: 85000,
        occurredOn: '2026-11-01',
        note: '',
        excludeFromReport: false,
        recurringId: 'r1',
      })
      changes.update((n) => n + 1)
      await open({ mode: 'edit', id: 't1' })
      expect(text()).toContain(th.recurring.fromRule)
      await click(th.recurring.fromRule, true)
      expect(transactions.sheet()).toEqual({ mode: 'rule', id: 'r1' })
    })
  })
})
