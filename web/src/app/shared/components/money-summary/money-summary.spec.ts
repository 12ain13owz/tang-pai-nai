import { TestBed } from '@angular/core/testing'
import { TranslocoTestingModule } from '@jsverse/transloco'
import th from '@/core/i18n/th.json'
import { MoneySummaryCard } from './money-summary'
import type { MoneySummaryLine } from './money-summary'

describe('MoneySummaryCard', () => {
  const render = (line: MoneySummaryLine) => {
    TestBed.configureTestingModule({
      imports: [
        TranslocoTestingModule.forRoot({
          langs: { th },
          translocoConfig: { availableLangs: ['th'], defaultLang: 'th' },
          preloadLangs: true,
        }),
      ],
    })
    const fixture = TestBed.createComponent(MoneySummaryCard)
    fixture.componentRef.setInput('line', line)
    fixture.detectChanges()
    return fixture.nativeElement as HTMLElement
  }
  const line: MoneySummaryLine = {
    income: '+15,000.00',
    hasIncome: true,
    expense: '-13,577.00',
    net: '+1,423.00',
    transfer: null,
    debt: null,
  }

  it('puts income left and expense right-aligned, net under a line', () => {
    const element = render(line)
    const [income, expense] = element.querySelectorAll('section > div')
    expect(income.textContent).toContain('+15,000.00')
    expect(income.querySelector('.text-income')).not.toBeNull()
    expect(expense.className).toContain('items-end')
    expect(expense.textContent).toContain('-13,577.00')
    expect(element.textContent).toContain(th.transactions.net)
    expect(element.textContent).not.toContain(th.transfers.summaryLine)
  })

  it('adds the transfer and debt lines only when they are set', () => {
    const element = render({ ...line, hasIncome: false, transfer: '-2,000.00', debt: '+300.00' })
    expect(element.querySelector('.text-income')).toBeNull()
    expect(element.textContent).toContain(th.transfers.summaryLine)
    expect(element.textContent).toContain('-2,000.00')
    expect(element.textContent).toContain(th.debts.summaryLine)
  })
})
