import { TestBed } from '@angular/core/testing'
import type { ComponentFixture } from '@angular/core/testing'
import th from '@/core/i18n/th.json'
import type { LocalDatabase } from '@/core/offline'
import type { ReportService } from '@/core/report'
import type { TransactionService } from '@/core/transaction'
import { setUpReports } from '@/features/reports/report-testing'
import { ReportsPage } from './reports-page'

describe('ReportsPage', () => {
  let fixture: ComponentFixture<ReportsPage>
  let db: LocalDatabase
  let reports: ReportService
  let transactions: TransactionService
  let setup: Awaited<ReturnType<typeof setUpReports>>

  const element = () => fixture.nativeElement as HTMLElement
  const text = () => element().textContent.replace(/\s+/g, ' ')
  const settle = async () => {
    fixture.detectChanges()
    await fixture.whenStable()
    fixture.detectChanges()
  }
  const tab = (label: string) =>
    [...element().querySelectorAll<HTMLElement>('[role="tab"]')].find(
      (el) => el.textContent.trim() === label
    )

  beforeEach(async () => {
    setup = await setUpReports()
    ;({ db, reports, transactions } = setup)
    fixture = TestBed.createComponent(ReportsPage)
    await settle()
  })

  afterEach(() => {
    fixture.destroy()
    db.close()
  })

  it('shows the H1 summary: income and expense first, the net, the balances and the notes (rules 9–11)', () => {
    const card = (element().querySelector('app-report-summary-card')?.textContent ?? '').replace(
      /\s+/g,
      ' '
    )
    expect(card).toContain('ต.ค. 2026')
    expect(card.indexOf('+50,000.00')).toBeLessThan(card.indexOf(th.reports.net))
    expect(card).toContain('-1,450.00')
    expect(card).toContain(`${th.reports.net}+48,550.00`)
    expect(card).toContain(th.reports.start)
    expect(card).toContain('9,600.00')
    expect(card).toContain('57,450.00')
    expect(card).toContain('เฉลี่ยรายจ่าย 46.77/วัน')
    expect(card).toContain('โอนเงิน -500.00')
    const excluded = element().querySelector<HTMLAnchorElement>('a[href="/reports/excluded"]')
    expect(excluded?.textContent).toContain('ไม่รวมในรายงาน 1 รายการ')
    expect(excluded?.textContent).toContain('-200.00')
  })

  it('lists top-level categories largest first, each a link to its page (Q1-B, rules 4–6)', async () => {
    const rows = [...element().querySelectorAll<HTMLAnchorElement>('app-report-share-list a')]
    expect(rows.map((row) => row.getAttribute('href'))).toEqual([
      '/reports/category/food',
      '/reports/category/fun',
    ])
    expect(rows[0].textContent).toContain('1,300.00')
    expect(rows[0].textContent).toContain('89.7%')
    expect(rows[0].textContent).toContain('1 หมวดย่อย')
    expect(rows[1].textContent).toContain(th.reports.archived)
    tab(th.categories.income)?.click()
    await settle()
    expect(
      [...element().querySelectorAll('app-report-share-list a')].map((row) =>
        row.getAttribute('href')
      )
    ).toEqual(['/reports/category/salary'])
  })

  it('puts the breakdown before the trend, and has no trend for a month (rule 7)', async () => {
    expect(element().querySelector('app-report-trend')).toBeNull()
    reports.selectUnit('year')
    await settle()
    const order = [...element().querySelectorAll('app-report-share-list, app-report-trend')].map(
      (el) => el.tagName.toLowerCase()
    )
    expect(order).toEqual(['app-report-share-list', 'app-report-trend'])
  })

  it('splits a year into its months; a bar shows its figures and keeps the period (rule 7)', async () => {
    reports.selectUnit('year')
    await settle()
    const bars = () => [...element().querySelectorAll<HTMLButtonElement>('app-report-trend button')]
    expect(bars()).toHaveLength(12)
    expect(bars()[9].getAttribute('aria-label')).toBe(
      'ต.ค. 2026: รายรับ 50,000.00 รายจ่าย 1,450.00'
    )
    expect(text()).toContain(th.reports.trendHint.month)
    bars()[9].click()
    await settle()
    expect(reports.tab()).toBe(0)
    expect(bars()[9].getAttribute('aria-pressed')).toBe('true')
    const detail = element().querySelector('app-report-trend [aria-live]')?.textContent ?? ''
    expect(detail.replace(/\s+/g, ' ')).toContain('ต.ค. 2026 รายรับ 50,000.00 รายจ่าย 1,450.00')
    bars()[9].click()
    await settle()
    expect(text()).toContain(th.reports.trendHint.month)
  })

  it('shows the empty state for a period with nothing, and adds from there', async () => {
    tab('เดือนนี้')?.click()
    await settle()
    expect(text()).toContain(th.reports.emptyHeading)
    expect(element().querySelector('app-report-summary-card')).toBeNull()
    ;[...element().querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent.trim() === th.transactions.add)
      ?.click()
    expect(transactions.sheet()).toEqual({ mode: 'create' })
  })

  it('offers a currency switch only when the view holds more than one (Q6)', async () => {
    expect(element().querySelector(`[aria-label="${th.reports.currency}"]`)).toBeNull()
    setup.wallet('usd', { currencyCode: 'USD', sortOrder: 3 })
    setup.transaction('2026-10-11', 'food', 700, { walletId: 'usd' })
    await settle()
    expect(element().querySelectorAll('app-report-summary-card')).toHaveLength(2)
    tab('USD')?.click()
    await settle()
    expect(reports.currencyCode()).toBe('USD')
    expect(element().querySelector('app-report-share-list a')?.textContent).toContain('7.00')
  })
})
