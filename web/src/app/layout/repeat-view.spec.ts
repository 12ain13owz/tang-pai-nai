import { TestBed } from '@angular/core/testing'
import type { ComponentFixture } from '@angular/core/testing'
import { TranslocoTestingModule } from '@jsverse/transloco'
import th from '@/core/i18n/th.json'
import { MONTHLY } from '@/core/recurring'
import { RepeatView } from './repeat-view'

describe('RepeatView', () => {
  let fixture: ComponentFixture<RepeatView>
  const element = () => fixture.nativeElement as HTMLElement
  const settle = async () => {
    fixture.detectChanges()
    await fixture.whenStable()
  }
  /** A radio by the text its row starts with. */
  const choose = async (label: string) => {
    const row = [...element().querySelectorAll('label')].find((el) =>
      el.textContent.trim().startsWith(label)
    )
    row?.querySelector<HTMLInputElement>('input')?.click()
    await settle()
  }
  const press = async (label: string) => {
    ;[...element().querySelectorAll<HTMLButtonElement>('button')]
      .find((b) => b.getAttribute('aria-label') === label || b.textContent.trim() === label)
      ?.click()
    await settle()
  }

  beforeEach(async () => {
    TestBed.configureTestingModule({
      imports: [
        TranslocoTestingModule.forRoot({
          langs: { th },
          translocoConfig: { availableLangs: ['th'], defaultLang: 'th' },
          preloadLangs: true,
        }),
      ],
    })
    fixture = TestBed.createComponent(RepeatView)
    fixture.componentRef.setInput('startOn', '2026-01-31')
    await settle()
  })

  it('names the presets after the date, and says what a short month does (rule 3)', async () => {
    expect(element().textContent).toContain('วันที่ 31')
    expect(element().textContent).not.toContain(th.recurring.end)
    await choose(th.recurring.preset.month)
    expect(fixture.componentInstance.value()).toEqual(MONTHLY)
    expect(element().textContent).toContain('เดือนที่ไม่มีวันที่ 31')
    expect(element().textContent).toContain('28 ก.พ. 2026')
  })

  it('sets every n units, an end by date or count, and asking first', async () => {
    await choose(th.recurring.custom)
    expect(fixture.componentInstance.value()).toMatchObject({ frequency: 'month', interval: 2 })
    await press(th.recurring.more)
    await press(th.recurring.unit.week)
    expect(fixture.componentInstance.value()).toMatchObject({ frequency: 'week', interval: 3 })
    await choose('ครบ')
    expect(fixture.componentInstance.value()).toMatchObject({ endCount: 12, endOn: null })
    // The count's own − (the last one; the first steps "every n").
    ;[...element().querySelectorAll<HTMLButtonElement>(`button[aria-label="${th.recurring.less}"]`)]
      .at(-1)
      ?.click()
    await settle()
    expect(fixture.componentInstance.value()).toMatchObject({ endCount: 11, interval: 3 })
    await choose(th.recurring.endOn)
    expect(fixture.componentInstance.value()).toMatchObject({ endCount: null, endOn: '2027-01-31' })
    await choose(th.recurring.ask)
    expect(fixture.componentInstance.value()?.confirm).toBe(true)
    await choose(th.recurring.none)
    expect(fixture.componentInstance.value()).toBeNull()
  })
})
