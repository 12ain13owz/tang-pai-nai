import { computed, signal } from '@angular/core'
import { TestBed } from '@angular/core/testing'
import type { ComponentFixture } from '@angular/core/testing'
import { TranslocoTestingModule } from '@jsverse/transloco'
import th from '@/core/i18n/th.json'
import { SyncService } from '@/core/offline'
import type { SyncStatus } from '@/core/offline'
import { ProfileService } from '@/core/profile'
import { ReportService } from '@/core/report'
import { TransactionService, TransferService } from '@/core/transaction'
import type { PeriodUnit, TransferSheetState } from '@/core/transaction'
import { TransactionsHeader } from './transactions-header'

describe('TransactionsHeader', () => {
  let fixture: ComponentFixture<TransactionsHeader>
  const unit = signal<PeriodUnit>('month')
  const customSheet = signal(false)
  const transferSheet = signal<TransferSheetState | null>(null)
  const transactions = {
    viewWallet: signal(null),
    walletSheet: signal(false),
    customSheet,
    unit,
    selectUnit: (next: PeriodUnit) => unit.set(next),
  }

  const element = () => fixture.nativeElement as HTMLElement
  const items = () =>
    [...element().querySelectorAll('[role^="menuitem"]')].map((item) => item.textContent.trim())
  const item = (text: string) =>
    [...element().querySelectorAll<HTMLElement>('[role^="menuitem"]')].find((el) =>
      el.textContent.trim().startsWith(text)
    )
  const settle = async () => {
    fixture.detectChanges()
    await fixture.whenStable()
    fixture.detectChanges()
  }
  const menuButton = () =>
    element().querySelector<HTMLElement>(`button[aria-label="${th.transfers.menu}"]`)

  beforeEach(async () => {
    unit.set('month')
    transferSheet.set(null)
    TestBed.configureTestingModule({
      imports: [
        TranslocoTestingModule.forRoot({
          langs: { th },
          translocoConfig: { availableLangs: ['th'], defaultLang: 'th' },
          preloadLangs: true,
        }),
      ],
      providers: [
        { provide: TransactionService, useValue: transactions },
        {
          provide: ReportService,
          useValue: { unit: signal('month'), customSheet: signal(false), selectUnit: vi.fn() },
        },
        {
          provide: TransferService,
          useValue: { open: (state: TransferSheetState) => transferSheet.set(state) },
        },
        {
          provide: ProfileService,
          useValue: {
            current: signal(null),
            switchSheet: signal(false),
            rejectedItems: computed(() => []),
          },
        },
        {
          provide: SyncService,
          useValue: { status: signal<SyncStatus>('synced'), pendingCount: signal(0) },
        },
      ],
    })
    fixture = TestBed.createComponent(TransactionsHeader)
    await settle()
  })

  afterEach(() => fixture.destroy())

  it('opens a two-level menu: โอนเงิน and ดูตาม with the current unit (owner’s choice B)', async () => {
    menuButton()?.click()
    await settle()
    expect(items()).toHaveLength(2)
    expect(item(th.transfers.open)).toBeDefined()
    expect(item(th.transactions.viewBy)?.textContent).toContain(th.transactions.unit.month)
  })

  it('turns into the units on ดูตาม, goes back on ‹, and stays open in between', async () => {
    menuButton()?.click()
    await settle()
    item(th.transactions.viewBy)?.click()
    await settle()
    expect(items().slice(1)).toEqual(Object.values(th.transactions.unit))
    item(th.transactions.viewBy)?.click() // the ‹ back item reads "ดูตาม" too
    await settle()
    expect(items()).toHaveLength(2)
  })

  it('chooses a unit and closes, or opens the custom range sheet', async () => {
    menuButton()?.click()
    await settle()
    item(th.transactions.viewBy)?.click()
    await settle()
    item(th.transactions.unit.year)?.click()
    await settle()
    expect(unit()).toBe('year')
    expect(items()).toEqual([])
    menuButton()?.click()
    await settle()
    item(th.transactions.viewBy)?.click()
    await settle()
    item(th.transactions.unit.custom)?.click()
    expect(customSheet()).toBe(true)
  })

  it('opens the transfer sheet from the menu', async () => {
    menuButton()?.click()
    await settle()
    item(th.transfers.open)?.click()
    await settle()
    expect(transferSheet()).toEqual({ mode: 'create' })
    expect(items()).toEqual([])
  })
})
