import { TestBed } from '@angular/core/testing'
import type { ComponentFixture } from '@angular/core/testing'
import th from '@/core/i18n/th.json'
import type { LocalDatabase } from '@/core/offline'
import type { ReportService } from '@/core/report'
import { setUpReports } from '@/features/reports/report-testing'
import { ReportExcludedPage } from './report-excluded-page'

describe('ReportExcludedPage', () => {
  let fixture: ComponentFixture<ReportExcludedPage>
  let db: LocalDatabase
  let reports: ReportService

  const text = () => (fixture.nativeElement as HTMLElement).textContent.replace(/\s+/g, ' ')
  const settle = async () => {
    fixture.detectChanges()
    await fixture.whenStable()
    fixture.detectChanges()
  }

  beforeEach(async () => {
    ;({ db, reports } = await setUpReports())
    fixture = TestBed.createComponent(ReportExcludedPage)
    await settle()
  })

  afterEach(() => {
    fixture.destroy()
    db.close()
  })

  it('lists the period’s rows left out of reports, and says when there are none (rule 11)', async () => {
    expect(text()).toContain(th.reports.excludedText)
    expect(
      (fixture.nativeElement as HTMLElement).querySelectorAll('app-report-day-list li')
    ).toHaveLength(1)
    expect(text()).toContain('-200.00')
    reports.tab.set(0)
    await settle()
    expect(text()).toContain(th.reports.excludedEmpty)
  })
})
