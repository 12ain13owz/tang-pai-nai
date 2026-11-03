import { Component, signal } from '@angular/core'
import { TestBed } from '@angular/core/testing'
import { TranslocoTestingModule } from '@jsverse/transloco'
import th from '@/core/i18n/th.json'
import { CustomRangeSheet } from './custom-range-sheet'
import type { DaySpan } from './custom-range-sheet'

@Component({
  imports: [CustomRangeSheet],
  template: `
    <app-custom-range-sheet [(open)]="open" [range]="range()" (applied)="applied.push($event)" />
  `,
})
class Host {
  open = signal(false)
  range = signal<DaySpan>({ from: '2026-09-15', to: '2026-10-14' })
  applied: DaySpan[] = []
}

describe('CustomRangeSheet', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [
        TranslocoTestingModule.forRoot({
          langs: { th },
          translocoConfig: { availableLangs: ['th'], defaultLang: 'th' },
          preloadLangs: true,
        }),
      ],
    })
  })

  const dates = () => [...document.body.querySelectorAll<HTMLInputElement>('input[type="date"]')]
  const apply = () =>
    [...document.body.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent.trim() === th.transactions.customApply)
      ?.click()

  it('starts from the range in use, refuses an end before the start, and emits the range', async () => {
    const fixture = TestBed.createComponent(Host)
    const host = fixture.componentInstance
    host.open.set(true)
    fixture.detectChanges()
    await fixture.whenStable()
    fixture.detectChanges()
    expect(dates().map((input) => input.value)).toEqual(['2026-09-15', '2026-10-14'])
    const [from, to] = dates()
    from.value = '2026-10-20'
    from.dispatchEvent(new Event('input'))
    apply()
    fixture.detectChanges()
    expect(document.body.textContent).toContain(th.transactions.customOrder)
    expect(host.applied).toEqual([])
    to.value = '2026-10-31'
    to.dispatchEvent(new Event('input'))
    apply()
    fixture.detectChanges()
    expect(host.applied).toEqual([{ from: '2026-10-20', to: '2026-10-31' }])
    expect(host.open()).toBe(false)
    fixture.destroy()
  })
})
