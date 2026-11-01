import { signal } from '@angular/core'
import { TestBed } from '@angular/core/testing'
import type { ComponentFixture } from '@angular/core/testing'
import { TranslocoTestingModule } from '@jsverse/transloco'
import { toastState } from '@spartan-ng/brain/sonner'
import { AuthStore } from '@/core/auth'
import type { AuthUser } from '@/core/auth'
import th from '@/core/i18n/th.json'
import { NetworkStatusService } from '@/core/network'
import { findOp, listOps, OfflineService, putRow, queueWrite, SyncService } from '@/core/offline'
import type { LocalDatabase } from '@/core/offline'
import { openTestDatabase } from '@/core/offline/testing-db'
import { WalletService } from '@/core/wallet'
import { WalletSheet } from './wallet-sheet'

describe('WalletSheet', () => {
  let fixture: ComponentFixture<WalletSheet>
  let db: LocalDatabase
  let wallets: WalletService
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

  const body = () => document.body
  const text = () => body().textContent
  /** A button by its text, or by its aria-label for an icon button. */
  const button = (label: string) =>
    [...body().querySelectorAll('button')].find(
      (b) => b.textContent.trim() === label || b.getAttribute('aria-label') === label
    )
  /** The input a (screen-reader) label names. */
  const input = (label: string) => {
    const id = [...body().querySelectorAll('label')].find(
      (l) => l.textContent.trim() === label
    )?.htmlFor
    return body().querySelector(`input[id="${id}"]`) as HTMLInputElement
  }
  const type = async (label: string, value: string) => {
    const field = input(label)
    field.value = value
    field.dispatchEvent(new Event('input'))
    field.dispatchEvent(new Event('blur'))
    await settle()
  }
  const settle = async () => {
    fixture.detectChanges()
    await fixture.whenStable()
    fixture.detectChanges()
  }
  const click = async (label: string) => {
    button(label)?.click()
    await settle()
  }
  const submit = async () => {
    body().querySelector('form')?.dispatchEvent(new Event('submit'))
    await settle()
  }
  const radio = async (label: string) => {
    ;(body().querySelector(`input[aria-label="${label}"]`) as HTMLInputElement).click()
    await settle()
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
  const currency = (code: string, minorUnit: number, isActive: boolean, sortOrder: number) =>
    putRow(db, 'currencies', {
      code,
      minorUnit,
      isActive,
      sortOrder,
      createdAt: 1,
      updatedAt: 1,
      changeSeq: 1,
    })

  beforeEach(async () => {
    db = await openTestDatabase()
    localStorage.clear()
    trusted.set(true)
    online.set(true)
    toastState.toasts().forEach((toast) => toastState.dismiss(toast.id))
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
    currency('THB', 2, true, 0)
    currency('JPY', 0, false, 3)
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
    wallets = TestBed.inject(WalletService)
    fixture = TestBed.createComponent(WalletSheet)
    changes.update((n) => n + 1)
    await settle()
  })

  afterEach(() => {
    fixture.destroy()
    db.close()
  })

  it('creates a wallet: name, a negative balance, an icon and colour from their view, excluded', async () => {
    wallets.open({ mode: 'create' })
    await settle()
    expect(text()).toContain(th.wallets.createHeading)
    expect(text()).toContain('THB')
    // One currency is active, so there is no picker (rule 4).
    expect(body().querySelector('select')).toBeNull()
    await type(th.wallets.name, '  บัตรเครดิต ')
    await type(th.wallets.initialBalance, '18,250.75')
    await click(th.form.negativeAmount)
    expect(button(th.form.negativeAmount)?.getAttribute('aria-pressed')).toBe('true')
    await click(th.wallets.changeIcon)
    expect(text()).toContain(th.wallets.iconHeading)
    await radio('สีที่ 7')
    await radio(th.icons.tpnCardChip)
    // Picking the icon goes back to the form.
    expect(input(th.wallets.name).value).toBe('  บัตรเครดิต ')
    ;(body().querySelector('[role="switch"]') as HTMLElement).click()
    await settle()
    await submit()
    expect(wallets.wallets()).toMatchObject([
      {
        name: 'บัตรเครดิต',
        initialBalance: -1825075,
        icon: 'tpnCardChip',
        color: '#dc2626',
        currencyCode: 'THB',
        excludeFromTotal: true,
      },
    ])
    expect(wallets.sheet()).toBeNull()
    expect(toastState.toasts().map((toast) => toast.title)).toEqual([th.wallets.created])
  })

  it('starts a new wallet with the default icon, colour and an empty balance (rule 8)', async () => {
    wallets.open({ mode: 'create' })
    await settle()
    await type(th.wallets.name, 'เงินสด')
    await submit()
    expect(wallets.wallets()).toMatchObject([
      { icon: 'lucideWallet', color: '#2563eb', initialBalance: 0, excludeFromTotal: false },
    ])
  })

  it('refuses an empty name, a taken one, and a balance it cannot read, in place', async () => {
    wallet('w1', { name: 'Cash' })
    wallets.open({ mode: 'create' })
    await settle()
    await submit()
    expect(text()).toContain(th.wallets.nameRequired)
    await type(th.wallets.name, 'CASH')
    expect(text()).toContain(th.wallets.nameTaken)
    await type(th.wallets.name, 'Bank')
    await type(th.wallets.initialBalance, '12.345')
    expect(text()).toContain(th.wallets.balanceDecimals)
    await type(th.wallets.initialBalance, 'abc')
    expect(text()).toContain(th.wallets.balanceFormat)
    await type(th.wallets.initialBalance, '10000000000000.01')
    expect(text()).toContain(th.wallets.balanceTooBig)
    await submit()
    expect(listOps(db, 'pending')).toHaveLength(0)
  })

  it('offers a currency picker once two are active, and the decimals follow it', async () => {
    currency('JPY', 0, true, 3)
    changes.update((n) => n + 1)
    wallets.open({ mode: 'create' })
    await settle()
    const select = body().querySelector('select') as HTMLSelectElement
    expect([...select.options].map((option) => option.value)).toEqual(['THB', 'JPY'])
    await type(th.wallets.name, 'เยน')
    await type(th.wallets.initialBalance, '15000.5')
    select.value = 'JPY'
    select.dispatchEvent(new Event('change'))
    await settle()
    expect(text()).toContain(th.wallets.balanceDecimals)
    await type(th.wallets.initialBalance, '15,000')
    await submit()
    expect(wallets.wallets()).toMatchObject([{ currencyCode: 'JPY', initialBalance: 15000 }])
  })

  it('edits a wallet with its balance grouped and its sign, keeping its own name free', async () => {
    wallet('w1', { name: 'Card', initialBalance: -1825075 })
    wallets.open({ mode: 'edit', id: 'w1' })
    await settle()
    expect(text()).toContain(th.wallets.editHeading)
    expect(input(th.wallets.initialBalance).value).toBe('18,250.75')
    expect(button(th.form.negativeAmount)?.getAttribute('aria-pressed')).toBe('true')
    await submit()
    expect(listOps(db, 'pending')).toMatchObject([{ rowId: 'w1', baseSeq: 5 }])
  })

  it('archives from the header at once, and undoes it from the toast (rule 6)', async () => {
    wallet('w1', { name: 'Card' })
    wallets.open({ mode: 'edit', id: 'w1' })
    await settle()
    await click(th.wallets.archive)
    expect(wallets.byId('w1')?.isArchived).toBe(true)
    expect(wallets.sheet()).toBeNull()
    const [shown] = toastState.toasts()
    expect(shown.title).toBe('เก็บ “Card” ถาวรแล้ว')
    const action = shown.action as { label: string; onClick: () => void }
    expect(action.label).toBe(th.wallets.undo)
    action.onClick()
    expect(wallets.byId('w1')?.isArchived).toBe(false)
  })

  it('says why an archived wallet cannot come back, and lets its name be edited', async () => {
    wallet('w1', { name: 'Card', isArchived: true })
    wallet('w2', { name: 'card' })
    wallets.open({ mode: 'edit', id: 'w1' })
    await settle()
    // An archived wallet holds no name (rule 3).
    expect(text()).not.toContain(th.wallets.nameTaken)
    await click(th.wallets.unarchive)
    expect(text()).toContain(th.wallets.unarchiveNameTaken)
    expect(wallets.byId('w1')?.isArchived).toBe(true)
    await type(th.wallets.name, 'Card 2')
    expect(text()).not.toContain(th.wallets.unarchiveNameTaken)
  })

  it('deletes only after the confirm view, which can go back', async () => {
    wallet('w1', { name: 'Card' })
    wallets.open({ mode: 'edit', id: 'w1' })
    await settle()
    await click(th.wallets.delete)
    expect(text()).toContain('ลบกระเป๋าเงิน “Card” ใช่ไหม')
    await click(th.sheet.back)
    expect(wallets.byId('w1')).not.toBeNull()
    await click(th.wallets.delete)
    await click(th.wallets.deleteConfirm)
    expect(wallets.byId('w1')).toBeNull()
    expect(listOps(db, 'pending')).toMatchObject([{ rowId: 'w1', op: 'delete' }])
  })

  it('asks before throwing away unsaved input, and can go back to it', async () => {
    wallets.open({ mode: 'create' })
    await settle()
    await type(th.wallets.name, 'เงินสด')
    await click(th.sheet.close)
    expect(text()).toContain(th.wallets.discardHeading)
    await click(th.wallets.keepEditing)
    expect(input(th.wallets.name).value).toBe('เงินสด')
    await click(th.sheet.close)
    await click(th.wallets.discard)
    expect(wallets.sheet()).toBeNull()
    expect(wallets.wallets()).toHaveLength(0)
  })

  it('opens a fix with the refused values and their error, and saves it in place of the op', async () => {
    wallet('w1', { name: 'Cash' })
    db.transaction((tx) =>
      queueWrite(tx, 'wallets', 'upsert', {
        id: 'w9',
        profileId: 'p1',
        name: 'cash',
        currencyCode: 'THB',
        initialBalance: 100,
        icon: 'tpnBahtNote',
        color: '#2563eb',
        excludeFromTotal: false,
        isArchived: false,
        sortOrder: 1,
        createdAt: 1,
        updatedAt: 1,
        deletedAt: null,
      })
    )
    db.exec(
      `UPDATE outbox SET status = 'rejected', code = 'CONFLICT'; DELETE FROM wallets WHERE id = 'w9'`
    )
    const opId = listOps(db, 'rejected')[0].opId
    wallets.openFix(opId)
    await settle()
    expect(text()).toContain(th.wallets.fixHeading)
    expect(input(th.wallets.initialBalance).value).toBe('1')
    expect(text()).toContain(th.wallets.nameTaken)
    await type(th.wallets.name, 'Cash 2')
    await submit()
    expect(listOps(db, 'rejected')).toHaveLength(0)
    expect(wallets.byId('w9')).toMatchObject({ name: 'Cash 2', icon: 'tpnBahtNote' })
  })

  it('says an untrusted device must be online, and blocks saving', async () => {
    trusted.set(false)
    online.set(false)
    wallets.open({ mode: 'create' })
    await settle()
    expect(text()).toContain(th.wallets.needsOnline)
    expect(button(th.wallets.save)?.disabled).toBe(true)
  })
})
