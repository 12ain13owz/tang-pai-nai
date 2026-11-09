import { RouterTestingHarness } from '@angular/router/testing'
import th from '@/core/i18n/th.json'
import type { SharedEntries, SharedWallet } from '@/core/sharing'
import { envelope, NOTHING, setUpSharing } from '@/core/sharing/sharing-testing'
import { periodRange, today } from '@/core/transaction'
import { SharedWalletPage } from './shared-wallet-page'

const wallet: SharedWallet = {
  wallet: {
    id: 'w1',
    name: 'ค่าบ้าน',
    icon: 'lucideHouse',
    color: '#1d4ed8',
    currencyCode: 'THB',
    balance: 1_245_000,
    firstOn: '2026-01-01',
  },
  role: 'editor',
  owner: { displayName: 'พ่อ', email: 'dad@example.com' },
  categories: [
    {
      id: 'food',
      type: 'expense',
      parentId: null,
      name: 'อาหาร',
      icon: 'lucideUtensils',
      color: '#c2410c',
      isArchived: false,
      sortOrder: 0,
    },
    {
      id: 'pay',
      type: 'income',
      parentId: null,
      name: 'เงินเดือน',
      icon: 'lucideBanknote',
      color: '#15803d',
      isArchived: false,
      sortOrder: 1,
    },
  ],
}

describe('SharedWalletPage', () => {
  let setup: Awaited<ReturnType<typeof setUpSharing>>
  let harness: RouterTestingHarness
  const { from, to } = periodRange('month', 0, today(), { from: null, to: null })
  const text = () => (harness.routeNativeElement as HTMLElement).textContent
  const settle = async () => {
    for (let i = 0; i < 3; i++) {
      harness.detectChanges()
      await harness.fixture.whenStable()
      await new Promise((resolve) => setTimeout(resolve))
    }
    harness.detectChanges()
  }
  const day = (n: number) => `${from?.slice(0, 8)}${String(n).padStart(2, '0')}`
  const entries: SharedEntries = {
    truncated: false,
    entries: [
      {
        id: 't1',
        kind: 'transaction',
        occurredOn: day(2),
        amount: -42_000,
        categoryId: 'food',
        note: 'กับข้าว',
        excludeFromReport: false,
      },
      {
        id: 'tr',
        kind: 'transfer',
        occurredOn: day(1),
        amount: -200_000,
        categoryId: null,
        note: '',
        excludeFromReport: false,
      },
      {
        id: 't2',
        kind: 'transaction',
        occurredOn: day(1),
        amount: 1_500_000,
        categoryId: 'pay',
        note: '',
        excludeFromReport: false,
      },
    ],
  }

  beforeEach(async () => {
    setup = await setUpSharing([{ path: 'wallets/shared/:id', component: SharedWalletPage }])
    harness = await RouterTestingHarness.create()
    await harness.navigateByUrl('/wallets/shared/w1')
    setup.http.match('/api/sharing/with-me').forEach((req) => req.flush(envelope(NOTHING)))
  })

  it('shows the balance, the owner, the summary and the rows with the owner’s categories (rule 9)', async () => {
    setup.http.expectOne('/api/sharing/wallets/w1').flush(envelope(wallet))
    await settle()
    setup.http
      .expectOne(`/api/sharing/wallets/w1/entries?from=${from}&to=${to}`)
      .flush(envelope(entries))
    await settle()
    expect(text()).toContain('12,450.00')
    expect(text()).toContain('ของ พ่อ')
    expect(text()).toContain(th.sharing.editor)
    expect(text()).toContain(th.sharing.readOnly)
    expect(text()).toContain('+15,000.00')
    expect(text()).toContain('-420.00')
    expect(text()).toContain('อาหาร')
    expect(text()).toContain('กับข้าว')
    expect(text()).toContain(th.sharing.transferOut)
    // The Transactions tab's card: net = income − expense, transfers on their own line.
    expect(text()).toContain('+14,580.00')
    expect(text()).toContain(th.transfers.summaryLine)
    expect(text()).not.toContain(th.debts.summaryLine)
  })

  it('keeps what it read when the network goes, and says so (rule 15)', async () => {
    setup.http.expectOne('/api/sharing/wallets/w1').flush(envelope(wallet))
    await settle()
    setup.http
      .expectOne(`/api/sharing/wallets/w1/entries?from=${from}&to=${to}`)
      .flush(envelope(entries))
    await settle()
    setup.network.isOnline.set(false)
    await settle()
    expect(text()).toContain('ออฟไลน์ · แสดงข้อมูลที่โหลดไว้เมื่อ')
    expect(text()).toContain('อาหาร')
  })

  it('says the wallet is gone on a 404 (rule 8)', async () => {
    setup.http
      .expectOne('/api/sharing/wallets/w1')
      .flush({ message: 'Wallet not found' }, { status: 404, statusText: 'Not Found' })
    await settle()
    expect(text()).toContain(th.sharing.goneHeading)
  })
})
