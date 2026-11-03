import { periodName, sharePercent } from './report-view'

describe('periodName', () => {
  it('names a period by its dates, ค.ศ. in both languages', () => {
    const october = { from: '2026-10-01', to: '2026-10-31' }
    expect(periodName('month', october, 'th-TH-u-ca-gregory')).toBe('ต.ค. 2026')
    expect(periodName('month', october, 'en-GB')).toBe('Oct 2026')
    expect(periodName('quarter', october, 'en-GB')).toBe('Q4 2026')
    expect(periodName('year', { from: '2026-01-01', to: '2026-12-31' }, 'th')).toBe('2026')
    expect(periodName('custom', { from: '2026-09-15', to: '2026-10-14' }, 'th')).toBe(
      '15/09/2026 – 14/10/2026'
    )
  })
})

describe('sharePercent', () => {
  it('rounds to one decimal and is 0% of nothing', () => {
    expect(sharePercent(1300, 1450, 'en-GB')).toBe('89.7%')
    expect(sharePercent(1, 3, 'en-GB')).toBe('33.3%')
    expect(sharePercent(5, 0, 'en-GB')).toBe('0%')
  })
})
