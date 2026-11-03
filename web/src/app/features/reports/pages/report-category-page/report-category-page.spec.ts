import { TestBed } from '@angular/core/testing'
import type { ComponentFixture } from '@angular/core/testing'
import { ActivatedRoute, convertToParamMap } from '@angular/router'
import { BehaviorSubject } from 'rxjs'
import th from '@/core/i18n/th.json'
import type { LocalDatabase } from '@/core/offline'
import type { ReportService } from '@/core/report'
import { PageTitleStrategy } from '@/core/routing'
import type { TransactionService } from '@/core/transaction'
import { setUpReports } from '@/features/reports/report-testing'
import { ReportCategoryPage } from './report-category-page'

describe('ReportCategoryPage', () => {
  let fixture: ComponentFixture<ReportCategoryPage>
  let db: LocalDatabase
  let reports: ReportService
  let transactions: TransactionService
  const params = new BehaviorSubject(convertToParamMap({ id: 'food' }))

  const element = () => fixture.nativeElement as HTMLElement
  const text = () => element().textContent.replace(/\s+/g, ' ')
  const settle = async () => {
    fixture.detectChanges()
    await fixture.whenStable()
    fixture.detectChanges()
  }
  const open = async (route: Record<string, string>) => {
    params.next(convertToParamMap(route))
    fixture = TestBed.createComponent(ReportCategoryPage)
    await settle()
  }
  const title = () => TestBed.inject(PageTitleStrategy).pageTitle()

  beforeEach(async () => {
    ;({ db, reports, transactions } = await setUpReports([
      { provide: ActivatedRoute, useValue: { paramMap: params } },
    ]))
  })

  afterEach(() => {
    fixture.destroy()
    db.close()
  })

  it('shows a parent: its total and share, the period before, its children and "ไม่ระบุหมวดย่อย" (Q4–Q5, E4)', async () => {
    await open({ id: 'food' })
    expect(title()).toBe('food')
    expect(text()).toContain('-1,300.00')
    expect(text()).toContain('89.7% ของรายจ่าย · ต.ค. 2026')
    expect(text()).toContain('เทียบกับ ก.ย. 2026: 400.00')
    const rows = [...element().querySelectorAll<HTMLAnchorElement>('app-report-share-list a')]
    expect(rows.map((row) => row.getAttribute('href'))).toEqual([
      '/reports/category/food/direct',
      '/reports/category/food/coffee',
    ])
    expect(rows[0].textContent).toContain(th.reports.direct)
    expect(rows[0].textContent).toContain(th.reports.directHint)
    // Counted rows of the parent and its child only (the left-out one is on its own page).
    expect(text()).toContain('ธุรกรรม 2 รายการ')
    expect(element().querySelectorAll('app-report-day-list li')).toHaveLength(2)
  })

  it('shows only the money on the parent itself for "direct", and only the child for a sub-category', async () => {
    await open({ id: 'food', sub: 'direct' })
    expect(title()).toBe(`food · ${th.reports.direct}`)
    expect(text()).toContain(`food › ${th.reports.direct}`)
    expect(text()).toContain('-1,000.00')
    expect(text()).toContain('76.9% ของfood')
    expect(element().querySelector('app-report-share-list')).toBeNull()
    expect(text()).toContain('ข้าวกล่อง')
    fixture.destroy()
    await open({ id: 'food', sub: 'coffee' })
    expect(title()).toBe('coffee')
    expect(text()).toContain('food › coffee')
    expect(element().querySelectorAll('app-report-day-list li')).toHaveLength(1)
  })

  it('opens the transaction sheet from a row', async () => {
    await open({ id: 'food', sub: 'direct' })
    element().querySelector<HTMLButtonElement>('app-report-day-list button')?.click()
    expect(transactions.sheet()).toEqual({ mode: 'edit', id: 't3' })
  })

  it('follows the period and says when it has nothing', async () => {
    await open({ id: 'food' })
    reports.tab.set(0)
    await settle()
    expect(text()).toContain(th.reports.noneInPeriod)
  })

  it('says so for a category that is gone, or a child under another parent', async () => {
    await open({ id: 'nope' })
    expect(text()).toContain(th.reports.notFound)
    fixture.destroy()
    await open({ id: 'fun', sub: 'coffee' })
    expect(text()).toContain(th.reports.notFound)
  })

  it('gives the header its title back when it closes', async () => {
    await open({ id: 'food' })
    fixture.destroy()
    expect(title()).not.toBe('food')
  })
})
