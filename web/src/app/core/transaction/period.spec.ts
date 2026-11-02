import { FUTURE, periodLabel, periodRange, periodTabs } from './period'

const today = '2026-11-02'
const custom = { from: '2026-10-01', to: '2026-10-15' }

describe('periodRange', () => {
  it('covers each unit around today, weeks from Monday', () => {
    expect(periodRange('day', -1, today, custom)).toEqual({ from: '2026-11-01', to: '2026-11-01' })
    expect(periodRange('week', 0, today, custom)).toEqual({ from: '2026-11-02', to: '2026-11-08' })
    expect(periodRange('week', -1, today, custom)).toEqual({ from: '2026-10-26', to: '2026-11-01' })
    expect(periodRange('month', -2, '2026-03-31', custom)).toEqual({
      from: '2026-01-01',
      to: '2026-01-31',
    })
    expect(periodRange('quarter', -1, today, custom)).toEqual({
      from: '2026-07-01',
      to: '2026-09-30',
    })
    expect(periodRange('year', -1, today, custom)).toEqual({ from: '2025-01-01', to: '2025-12-31' })
    expect(periodRange('all', 0, today, custom)).toEqual({ from: null, to: null })
    expect(periodRange('custom', 0, today, custom)).toEqual(custom)
  })

  it('makes the future the days after the current month', () => {
    expect(periodRange('month', FUTURE, today, custom)).toEqual({ from: '2026-12-01', to: null })
  })
})

describe('periodTabs', () => {
  it('goes back to the oldest row, at least one period, and the month view ends with the future', () => {
    expect(periodTabs('month', today, null)).toEqual([-1, 0, FUTURE])
    expect(periodTabs('month', today, '2026-08-20')).toEqual([-3, -2, -1, 0, FUTURE])
    expect(periodTabs('quarter', today, '2026-08-20')).toEqual([-1, 0])
    expect(periodTabs('all', today, '2020-01-01')).toEqual([0])
  })
})

describe('periodLabel', () => {
  it('names this and the last period, then shows dates in ค.ศ.', () => {
    expect(periodLabel('month', 0, today, custom)).toEqual({ key: 'transactions.period.monthThis' })
    expect(periodLabel('month', -1, today, custom)).toEqual({
      key: 'transactions.period.monthLast',
    })
    expect(periodLabel('month', -2, today, custom)).toEqual({ text: '09/2026' })
    expect(periodLabel('day', -2, today, custom)).toEqual({ text: '31/10/2026' })
    expect(periodLabel('week', -2, today, custom)).toEqual({ text: '19/10 – 25/10/2026' })
    expect(periodLabel('quarter', -2, today, custom)).toEqual({ text: 'Q2 2026' })
    expect(periodLabel('year', -3, today, custom)).toEqual({ text: '2023' })
    expect(periodLabel('month', FUTURE, today, custom)).toEqual({
      key: 'transactions.period.future',
    })
    expect(periodLabel('custom', 0, today, custom)).toEqual({ text: '01/10/2026 – 15/10/2026' })
  })
})
