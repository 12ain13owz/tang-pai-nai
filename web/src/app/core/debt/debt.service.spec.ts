import { TestBed } from '@angular/core/testing'
import { CategoryService } from '@/core/category'
import { getRow, listOps } from '@/core/offline'
import type { LocalDatabase } from '@/core/offline'
import { RecurringService } from '@/core/recurring'
import { TransactionService } from '@/core/transaction'
import { WalletService } from '@/core/wallet'
import { setUpDebts } from './debt-testing'
import { DebtService } from './debt.service'
import type { DebtValues } from './debt.type'

describe('DebtService', () => {
  let db: LocalDatabase
  let service: DebtService
  let setup: Awaited<ReturnType<typeof setUpDebts>>
  const balance = (id: string) => {
    const walletService = TestBed.inject(WalletService)
    const wallet = walletService.byId(id)
    return wallet ? walletService.balance(wallet) : NaN
  }
  const values = (extra: Partial<DebtValues> = {}): DebtValues => ({
    direction: 'borrowed',
    person: ' แม่ ',
    note: '',
    countAs: 'spent',
    categoryId: null,
    dueOn: null,
    amount: 1000000,
    walletId: 'cash',
    occurredOn: '2026-08-15',
    currencyCode: 'THB',
    ...extra,
  })

  beforeEach(async () => {
    localStorage.clear()
    setup = await setUpDebts()
    db = setup.db
    service = TestBed.inject(DebtService)
  })

  afterEach(() => db.close())

  it('creates a debt and its principal in one write, the debt pushed first (debt rule 3)', () => {
    const id = service.create(values())
    expect(getRow(db, 'debts', id)).toMatchObject({ person: 'แม่', countAs: 'spent' })
    expect(listOps(db, 'pending').map((op) => op.table)).toEqual(['debts', 'debt_entries'])
    // Borrowed money comes into the wallet but isn't income.
    expect(balance('cash')).toBe(1500000)
    const month = TestBed.inject(TransactionService).summary({
      from: '2026-08-01',
      to: '2026-08-31',
    })
    expect(month).toEqual([expect.objectContaining({ income: 0, expense: 0, debt: 1000000 })])
    expect(service.item(id)).toMatchObject({ total: 1000000, paid: 0, left: 1000000 })
  })

  it('computes what is left: repayments settle, interest does not (debt rules 3–4, Q5)', () => {
    setup.debt('mom', { dueOn: '2026-10-31' })
    setup.entry('mom', 'principal', 1000000)
    service.saveEntry(
      null,
      'mom',
      { kind: 'repayment', amount: 400000, walletId: 'bank', occurredOn: '2026-11-01', note: '' },
      { amount: 40000, categoryId: 'interest' }
    )
    expect(service.item('mom')).toMatchObject({
      total: 1000000,
      paid: 400000,
      left: 600000,
      interest: 40000,
      closed: false,
      overdue: true,
    })
    // 4,000 repaid and 400 of interest left the bank; only the interest is an expense.
    expect(balance('bank')).toBe(6000000 - 440000)
    expect(
      TestBed.inject(TransactionService).summary({ from: '2026-11-01', to: '2026-11-30' })
    ).toEqual([expect.objectContaining({ expense: 40000, debt: -400000 })])
    expect(service.interestCategory('mom')).toBe('interest')
  })

  it('counts a repaid debt when it is paid: no wallet at first, instalments settle it', () => {
    setup.debt('ktc', { countAs: 'repaid', categoryId: 'shop' })
    setup.entry('ktc', 'principal', 3000000, { walletId: null })
    setup.transaction('i1', { debtId: 'ktc' })
    setup.transaction('i2', { debtId: 'ktc', occurredOn: '2026-11-05' })
    expect(service.item('ktc')).toMatchObject({ paid: 600000, left: 2400000, instalments: 2 })
    expect(balance('cash')).toBe(500000)
    expect(service.history('ktc').map((row) => row.kind)).toEqual([
      'transaction',
      'transaction',
      'entry',
    ])
  })

  it('closes with the rest repaid, or forgiven: counted once, the wallet unmoved (debt rule 4)', () => {
    setup.debt('joe', { direction: 'lent' })
    setup.entry('joe', 'principal', 200000)
    setup.debt('bee', { direction: 'lent' })
    setup.entry('bee', 'principal', 500000, { walletId: 'bank' })
    service.close('bee', { kind: 'rest', walletId: 'bank' }, '2026-11-09')
    expect(service.item('bee')).toMatchObject({ left: 0, closed: true, forgiven: false })
    expect(balance('bank')).toBe(6000000)

    const cash = balance('cash')
    service.close('joe', { kind: 'forgive', categoryId: 'shop' }, '2026-11-09', 'ยกหนี้')
    expect(service.item('joe')).toMatchObject({ left: 0, closed: true, forgiven: true })
    expect(balance('cash')).toBe(cash)
    expect(
      TestBed.inject(TransactionService).summary({ from: '2026-11-01', to: '2026-11-30' })
    ).toEqual([expect.objectContaining({ expense: 200000 })])
  })

  it('forgives a repaid debt uncounted, without a wallet', () => {
    setup.debt('ktc', { countAs: 'repaid', categoryId: 'shop' })
    setup.entry('ktc', 'principal', 3000000, { walletId: null })
    service.close('ktc', { kind: 'forgive', categoryId: null }, '2026-11-09')
    expect(service.item('ktc')).toMatchObject({ closed: true, forgiven: true })
    expect(db.selectValue(`SELECT count(*) FROM transactions`)).toBe(0)
  })

  it('makes an instalment plan a recurring rule that records what is due (debt rule 13)', () => {
    const id = service.create(
      values({
        person: 'KTC',
        countAs: 'repaid',
        categoryId: 'shop',
        walletId: null,
        amount: 3000000,
      }),
      {
        repeat: { frequency: 'month', interval: 1, endOn: null, endCount: 10, confirm: false },
        startOn: '2026-09-05',
        amount: 300000,
        walletId: 'bank',
      }
    )
    const [ruleId] = service.rules(id)
    expect(TestBed.inject(RecurringService).byId(ruleId)).toMatchObject({
      kind: 'transaction',
      debtId: id,
      categoryId: 'shop',
      nextOn: '2026-12-05',
    })
    expect(service.item(id)).toMatchObject({ instalments: 3, left: 2100000 })
  })

  it('records a debt rule’s occurrences as repayments, and a closed debt stops it', () => {
    const id = service.create(values(), {
      repeat: { frequency: 'month', interval: 1, endOn: null, endCount: 10, confirm: false },
      startOn: '2026-10-01',
      amount: 500000,
      walletId: 'cash',
    })
    expect(service.item(id)).toMatchObject({ paid: 1000000, left: 0, closed: true })
    const [ruleId] = service.rules(id)
    const recurring = TestBed.inject(RecurringService)
    expect(recurring.itemOf(recurring.byId(ruleId)!)).toMatchObject({
      state: 'stopped',
      stoppedBy: { kind: 'debt', name: 'แม่' },
    })
  })

  it('deletes a debt with its entries and rules; its counted rows stay (debt rule 5)', () => {
    setup.debt('coop')
    setup.entry('coop', 'principal', 5000000, { walletId: 'bank' })
    setup.transaction('fee', { debtId: 'coop', categoryId: 'interest', amount: 40000 })
    setup.pulled('recurring_rules', {
      id: 'r1',
      profileId: 'p1',
      kind: 'debt',
      walletId: 'bank',
      categoryId: null,
      toWalletId: null,
      debtId: 'coop',
      amount: 460000,
      note: '',
      excludeFromReport: false,
      startOn: '2026-12-01',
      frequency: 'month',
      interval: 1,
      endOn: null,
      endCount: null,
      confirm: false,
      nextOn: '2026-12-01',
      isPaused: false,
    })
    service.remove('coop')
    expect(service.item('coop')).toBeNull()
    expect(getRow(db, 'debt_entries', 'coop-e1')?.['deletedAt']).not.toBeNull()
    expect(getRow(db, 'recurring_rules', 'r1')?.['deletedAt']).not.toBeNull()
    expect(getRow(db, 'transactions', 'fee')?.['deletedAt']).toBeNull()
    expect(balance('bank')).toBe(6000000 - 40000)
  })

  it('removes an entry with undo, and edits keep their debt', () => {
    setup.debt('mom')
    setup.entry('mom', 'principal', 1000000)
    service.removeEntry('mom-e1')
    expect(service.item('mom')?.total).toBe(0)
    service.restoreEntry('mom-e1')
    expect(service.item('mom')?.total).toBe(1000000)
    service.saveEntry('mom-e1', 'mom', {
      kind: 'principal',
      amount: 1200000,
      walletId: 'bank',
      occurredOn: '2026-10-01',
      note: ' x ',
    })
    expect(getRow(db, 'debt_entries', 'mom-e1')).toMatchObject({
      amount: 1200000,
      walletId: 'bank',
      note: 'x',
      debtId: 'mom',
    })
  })

  it('lists open ones by due date and knows the names used before (Q3)', () => {
    setup.debt('b', { dueOn: '2026-12-01' })
    setup.entry('b', 'principal', 100)
    setup.debt('a', { dueOn: '2026-11-20' })
    setup.entry('a', 'principal', 100)
    setup.debt('none')
    setup.entry('none', 'principal', 100)
    expect(service.openItems().map((item) => item.debt.id)).toEqual(['a', 'b', 'none'])
    expect(new Set(service.people())).toEqual(new Set(['a', 'b', 'none']))
  })

  it('lists entries with a wallet among the Transactions tab rows, signed by the wallet', () => {
    setup.debt('mom')
    setup.entry('mom', 'principal', 1000000, { occurredOn: '2026-11-02' })
    setup.entry('mom', 'repayment', 200000, { occurredOn: '2026-11-03' })
    setup.debt('ktc', { countAs: 'repaid', categoryId: 'shop' })
    setup.entry('ktc', 'principal', 3000000, { walletId: null, occurredOn: '2026-11-04' })
    setup.transaction('t1', { occurredOn: '2026-11-03', amount: 5000 })
    const rows = TestBed.inject(TransactionService).entries({
      from: '2026-11-01',
      to: '2026-11-30',
    })
    expect(
      rows.map((row) => (row.kind === 'debt' ? `${row.entryKind} ${row.signed}` : row.id))
    ).toEqual(['t1', 'repayment -200000', 'principal 1000000'])
  })

  it('tombstones entries of a debt or wallet deleted elsewhere, and a repaid debt’s (rule 10)', () => {
    setup.debt('mom')
    setup.entry('mom', 'principal', 1000000)
    setup.debt('ktc', { countAs: 'repaid', categoryId: 'shop' })
    setup.entry('ktc', 'principal', 3000000, { walletId: null })
    TestBed.inject(TransactionService)
    setup.pulled('debts', {
      ...getRow(db, 'debts', 'mom'),
      deletedAt: 5,
    })
    setup.pulled('categories', { ...getRow(db, 'categories', 'shop'), deletedAt: 5 })
    TestBed.tick()
    expect(getRow(db, 'debt_entries', 'mom-e1')?.['deletedAt']).not.toBeNull()
    expect(getRow(db, 'debts', 'ktc')?.['deletedAt']).not.toBeNull()
    expect(getRow(db, 'debt_entries', 'ktc-e2')?.['deletedAt']).not.toBeNull()
  })

  it('locks a wallet with entries and a category a live debt uses; a merge moves it (rule 9)', () => {
    setup.debt('ktc', { countAs: 'repaid', categoryId: 'shop' })
    setup.entry('ktc', 'principal', 3000000, { walletId: 'bank' })
    expect(TestBed.inject(WalletService).hasTransactions('bank')).toBe(true)
    const categories = TestBed.inject(CategoryService)
    expect(categories.hasTransactions('shop')).toBe(true)
    setup.pulled('categories', {
      id: 'shop2',
      profileId: 'p1',
      type: 'expense',
      parentId: null,
      name: 'shop2',
      icon: 'lucideShapes',
      color: '#475569',
      isArchived: false,
      sortOrder: 1,
    })
    categories.merge('shop', 'shop2', 'move')
    expect(getRow(db, 'debts', 'ktc')?.['categoryId']).toBe('shop2')
  })
})
