import { TestBed } from '@angular/core/testing'
import { RouterTestingHarness } from '@angular/router/testing'
import { toastState } from '@spartan-ng/brain/sonner'
import { DebtService } from '@/core/debt'
import { setUpDebts } from '@/core/debt/debt-testing'
import th from '@/core/i18n/th.json'
import type { LocalDatabase } from '@/core/offline'
import { TransactionService } from '@/core/transaction'
import debtsRoutes from './debts.routes'

describe('Debts pages and sheets', () => {
  let db: LocalDatabase
  let setup: Awaited<ReturnType<typeof setUpDebts>>
  let harness: RouterTestingHarness
  let debts: DebtService

  const body = () => document.body
  const text = () => body().textContent.replace(/\s+/g, ' ')
  const button = (label: string) =>
    [...body().querySelectorAll('button')].find(
      (b) => b.textContent.trim() === label || b.getAttribute('aria-label') === label
    )
  const settle = async () => {
    harness.detectChanges()
    await harness.fixture.whenStable()
    harness.detectChanges()
  }
  const click = async (label: string) => {
    const found = button(label)
    expect(found, label).toBeDefined()
    found?.click()
    await settle()
  }
  const submit = async () => {
    body().querySelector('hlm-drawer-content form')?.dispatchEvent(new Event('submit'))
    await settle()
  }

  beforeEach(async () => {
    toastState.dismiss()
    localStorage.clear()
    setup = await setUpDebts('2026-11-09', [{ path: 'wallets/debts', children: debtsRoutes }])
    db = setup.db
    debts = TestBed.inject(DebtService)
    setup.debt('mom', { person: 'แม่', note: 'ยืมซ่อมรถ', dueOn: '2026-12-31' })
    setup.entry('mom', 'principal', 1000000)
    setup.entry('mom', 'repayment', 400000, { occurredOn: '2026-10-15' })
    setup.debt('joe', { person: 'พี่โจ้', direction: 'lent', dueOn: '2026-06-10' })
    setup.entry('joe', 'principal', 200000)
    setup.debt('a', { person: 'เพื่อนเอ', direction: 'lent' })
    setup.entry('a', 'principal', 100000)
    setup.entry('a', 'repayment', 100000, { occurredOn: '2026-10-12' })
    harness = await RouterTestingHarness.create()
  })

  afterEach(() => {
    toastState.dismiss()
    db.close()
  })

  it('lists open debts per direction with what is left, overdue and closed ones folded', async () => {
    await harness.navigateByUrl('/wallets/debts')
    await settle()
    expect(text()).toContain(`${th.debts.borrowed} (1)`)
    expect(text()).toContain('แม่')
    expect(text()).toContain('฿6,000.00')
    expect(text()).toContain('คืนแล้ว 4,000.00 จาก 10,000.00')
    await click(`${th.debts.lent} (1)`)
    expect(text()).toContain('พี่โจ้')
    expect(text()).toContain('เลย 10 มิ.ย.')
    expect(text()).not.toContain('เพื่อนเอ')
    await click('ปิดแล้ว (1)')
    expect(text()).toContain('เพื่อนเอ')
    await click(th.debts.add.lent)
    expect(debts.sheet()).toEqual({ mode: 'create', direction: 'lent' })
  })

  it('shows a debt and repays it through the entry sheet (debt rule 3)', async () => {
    await harness.navigateByUrl('/wallets/debts/mom')
    await settle()
    expect(text()).toContain('฿6,000.00')
    expect(text()).toContain('กำหนดคืน 31 ธ.ค. 2026 · อีก 52 วัน')
    await click('คืนเงิน')
    // The sheet's validators run while its form is built (they once read fields made later).
    expect(debts.entrySheet()).toEqual({ mode: 'create', debtId: 'mom', kind: 'repayment' })
    expect(text()).toContain('ทั้งหมด ฿6,000.00')
    await click('ทั้งหมด ฿6,000.00')
    await submit()
    expect(debts.item('mom')).toMatchObject({ left: 0, closed: true })
    expect(text()).toContain(th.debts.closedLabel)
  })

  it('opens an entry from the Transactions tab (?entry=) in its sheet', async () => {
    await harness.navigateByUrl('/wallets/debts/mom?entry=mom-e2')
    await settle()
    expect(debts.entrySheet()).toEqual({ mode: 'edit', id: 'mom-e2' })
    expect(text()).toContain(th.debts.editEntry)
  })

  it('pays an instalment of a repaid debt through the transaction form, linked to it', async () => {
    setup.debt('ktc', { person: 'KTC', countAs: 'repaid', categoryId: 'shop' })
    setup.entry('ktc', 'principal', 3000000, { walletId: null })
    await harness.navigateByUrl('/wallets/debts/ktc')
    await settle()
    await click(th.debts.payInstalment)
    expect(TestBed.inject(TransactionService).sheet()).toMatchObject({
      mode: 'create',
      type: 'expense',
      values: { categoryId: 'shop', debtId: 'ktc', amount: 3000000 },
    })
  })

  it('creates a borrowed debt from the form, its money into a wallet', async () => {
    await harness.navigateByUrl('/wallets/debts')
    await settle()
    await click(th.debts.add.borrowed)
    // The button, heading and toast say which way (owner, 2026-11; "บันทึกหนี้" read as my debt).
    expect(body().querySelector('hlm-drawer-content h2')?.textContent).toContain(
      th.debts.createHeading.borrowed
    )
    const person = body().querySelector<HTMLInputElement>('hlm-drawer-content input[list]')
    person!.value = 'ลุง'
    person!.dispatchEvent(new Event('input'))
    body().querySelector<HTMLElement>('app-calc-amount-field button')?.click()
    await settle()
    for (const key of ['5', '0', '0']) {
      await click(key)
    }
    await submit()
    const created = debts.items().find((item) => item.debt.person === 'ลุง')
    expect(created).toMatchObject({ total: 50000, left: 50000 })
    expect(debts.history(created!.debt.id)).toMatchObject([
      { kind: 'entry', entry: { kind: 'principal', walletId: 'cash' } },
    ])
  })

  it('closes a lent debt as forgiven in a category, counted once (debt rule 4)', async () => {
    await harness.navigateByUrl('/wallets/debts/joe')
    await settle()
    await click(th.debts.close)
    const forgive = [...body().querySelectorAll<HTMLButtonElement>('[role=radio]')].find((radio) =>
      radio.textContent.includes(th.debts.closeHow.forgive.lent)
    )
    forgive?.click()
    await settle()
    ;[...body().querySelectorAll('button')]
      .find((b) => b.textContent.includes(th.debts.pickCategory))
      ?.click()
    await settle()
    await click('shop')
    const closeButtons = [...body().querySelectorAll('button')].filter(
      (b) => b.textContent.trim() === th.debts.close
    )
    closeButtons.at(-1)?.click()
    await settle()
    expect(debts.item('joe')).toMatchObject({ closed: true, forgiven: true })
    expect(
      TestBed.inject(TransactionService).summary({ from: '2026-11-01', to: '2026-11-30' })
    ).toEqual([expect.objectContaining({ expense: 200000 })])
  })
})
