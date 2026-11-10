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
import { occurrenceId } from '@/core/recurring'
import { TransactionService, TransferService } from '@/core/transaction'
import { TransferSheet } from './transfer-sheet'

describe('TransferSheet', () => {
  let fixture: ComponentFixture<TransferSheet>
  let db: LocalDatabase
  let transfers: TransferService
  const changes = signal(0)
  const trusted = signal(true)
  const online = signal(true)

  const offline = {
    isOpen: signal(true),
    sharedActive: signal(false),
    leaveShared: () => undefined,
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
  const open = async (state: Parameters<TransferService['open']>[0]) => {
    transfers.open(state)
    await settle()
  }
  /** A picker row: its text starts with the wallet's name (then its balance). */
  const choose = async (name: string) => {
    ;[...body().querySelectorAll('li button')]
      .find((b) => b.textContent.trim().startsWith(name))
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await settle()
  }
  const choices = () =>
    [...body().querySelectorAll('li button .truncate')].map((name) => name.textContent.trim())
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
    for (const [code, sortOrder] of [
      ['THB', 0],
      ['USD', 1],
    ] as const) {
      putRow(db, 'currencies', {
        code,
        minorUnit: 2,
        isActive: true,
        sortOrder,
        createdAt: 1,
        updatedAt: 1,
        changeSeq: 1,
      })
    }
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
    transfers = TestBed.inject(TransferService)
    wallet('Cash')
    wallet('Bank', { sortOrder: 1, initialBalance: 500000 })
    wallet('Old', { sortOrder: 2, isArchived: true })
    wallet('Dollars', { sortOrder: 3, currencyCode: 'USD' })
    fixture = TestBed.createComponent(TransferSheet)
    await settle()
  })

  afterEach(() => {
    fixture.destroy()
    db.close()
    toastState.dismiss()
  })

  it('moves money from one wallet to another, typed on the keypad', async () => {
    await open({ mode: 'create' })
    expect(body().querySelector('[role="group"]')).not.toBeNull()
    await click('จาก ', true)
    expect(choices()).toEqual(['Cash', 'Bank', 'Dollars'])
    await choose('Bank')
    await click('ไปยัง ', true)
    // Never the from wallet, never another currency, never an archived one.
    expect(choices()).toEqual(['Cash'])
    await choose('Cash')
    await click('จำนวนเงิน ', true)
    await keys('เพิ่ม 500', 'เพิ่ม 500')
    expect(text()).toContain('500+500')
    await submit()
    const [op] = listOps(db, 'pending')
    expect(op.table).toBe('transfers')
    expect(getRow(db, 'transfers', op.rowId)).toMatchObject({
      profileId: 'p1',
      fromWalletId: 'Bank',
      toWalletId: 'Cash',
      amount: 100000,
      note: '',
    })
    expect(transfers.sheet()).toBeNull()
  })

  it('needs a wallet to send to and an amount above 0', async () => {
    await open({ mode: 'create' })
    await submit()
    expect(text()).toContain(th.transfers.toRequired)
    expect(text()).toContain(th.transactions.amountRequired)
    expect(listOps(db, 'pending')).toEqual([])
  })

  it('starts on the wallet last sent to from that wallet (Q7), and ⇅ swaps the two', async () => {
    transfers.save(null, {
      fromWalletId: 'Bank',
      toWalletId: 'Cash',
      amount: 100,
      occurredOn: '2026-11-02',
      note: '',
    })
    await open({ mode: 'create' })
    expect(button('จาก Bank')).toBeDefined()
    expect(button('ไปยัง Cash')).toBeDefined()
    await click(th.transfers.swap)
    expect(button('จาก Cash')).toBeDefined()
    expect(button('ไปยัง Bank')).toBeDefined()
  })

  it('drops the to wallet when it becomes the from wallet', async () => {
    await open({ mode: 'create', fromWalletId: 'Cash' })
    await click('ไปยัง ', true)
    await choose('Bank')
    await click('จาก ', true)
    await choose('Bank')
    expect(button('ไปยัง ' + th.transfers.pickTo)).toBeDefined()
  })

  it('edits either side as one transfer, and deletes both at once with undo in the toast', async () => {
    putRow(db, 'transfers', {
      ...base,
      id: 'r1',
      profileId: 'p1',
      fromWalletId: 'Bank',
      toWalletId: 'Cash',
      amount: 100000,
      occurredOn: '2026-11-02',
      note: 'ATM',
    })
    changes.update((n) => n + 1)
    await open({ mode: 'edit', id: 'r1' })
    expect(text()).toContain(th.transfers.editHeading)
    expect(body().querySelector('[role="group"]')).toBeNull()
    expect(text()).toContain('1,000')
    await click(th.transfers.delete)
    expect(getRow(db, 'transfers', 'r1')?.['deletedAt']).not.toBeNull()
    expect(toastState.toasts().at(0)?.title).toBe(th.transfers.deleted)
    toastState.toasts().at(0)?.action?.onClick(new MouseEvent('click'))
    expect(getRow(db, 'transfers', 'r1')?.['deletedAt']).toBeNull()
  })

  it('copies a transfer as a new one dated today', async () => {
    putRow(db, 'transfers', {
      ...base,
      id: 'r1',
      profileId: 'p1',
      fromWalletId: 'Bank',
      toWalletId: 'Cash',
      amount: 2500,
      occurredOn: '2026-10-01',
      note: 'rent',
    })
    changes.update((n) => n + 1)
    await open({ mode: 'edit', id: 'r1' })
    await click(th.transfers.copy)
    expect(transfers.sheet()).toMatchObject({
      mode: 'create',
      values: { fromWalletId: 'Bank', toWalletId: 'Cash', amount: 2500, note: 'rent' },
    })
  })

  it('blocks saving on an untrusted device offline, and says why', async () => {
    trusted.set(false)
    online.set(false)
    await open({ mode: 'create' })
    expect(text()).toContain(th.transfers.needsOnline)
    expect(button(th.transactions.save)?.disabled).toBe(true)
  })

  it('repeats a transfer every month, recording today’s one (recurring.md Q4)', async () => {
    TestBed.inject(TransactionService).today.set('2026-11-08')
    await open({ mode: 'create', repeat: true })
    await click('จาก ', true)
    await choose('Bank')
    await click('ไปยัง ', true)
    await choose('Cash')
    await click('จำนวนเงิน ', true)
    await keys('เพิ่ม 500')
    expect(text()).toContain('ทุกเดือน วันที่ 8')
    await submit()
    const [stored] = db.selectObjects('SELECT id FROM recurring_rules')
    const ruleId = String(stored['id'])
    expect(getRow(db, 'recurring_rules', ruleId)).toMatchObject({
      kind: 'transfer',
      walletId: 'Bank',
      toWalletId: 'Cash',
      categoryId: null,
      amount: 50000,
      nextOn: '2026-12-08',
    })
    expect(getRow(db, 'transfers', occurrenceId(ruleId, '2026-11-08'))).toMatchObject({
      fromWalletId: 'Bank',
      toWalletId: 'Cash',
      recurringId: ruleId,
    })
  })
})
