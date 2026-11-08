import { addQuickAmount, evaluate, groupExpression, hasOperator, pressKey } from './calc'
import type { CalcKey } from './calc'

const type = (keys: CalcKey[], minorUnit = 2) =>
  keys.reduce((expr, key) => pressKey(expr, key, minorUnit), '')

describe('pressKey', () => {
  it('builds numbers without leading zeros, one point and the currency digits after it', () => {
    expect(type(['0', '0', '5'])).toBe('5')
    expect(type(['.', '5'])).toBe('0.5')
    expect(type(['1', '.', '2', '3', '4'])).toBe('1.23')
    expect(type(['1', '.', '.', '5'])).toBe('1.5')
    expect(type(['1', '.', '5'], 0)).toBe('15')
    expect(type(['000'])).toBe('0')
    expect(type(['1', '000', '000'])).toBe('1000000')
  })

  it('keeps operators well placed: none first or after a point, a second one replaces the first', () => {
    expect(type(['+', '1'])).toBe('1')
    expect(type(['1', '+', '-', '2'])).toBe('1-2')
    expect(type(['1', '.', '×'])).toBe('1.')
    expect(type(['1', '2', '⌫'])).toBe('1')
    expect(type(['1', '2', 'C'])).toBe('')
  })

  it('stops a number at 16 digits before the point', () => {
    const keys = Array.from({ length: 18 }, () => '9' as const)
    expect(type(keys)).toHaveLength(16)
  })
})

describe('evaluate', () => {
  it('works × and ÷ before + and −, exactly, rounding half away from zero to minor units', () => {
    expect(evaluate('120+65', 2)).toEqual({ ok: true, minor: 18500 })
    expect(evaluate('2+3×4', 2)).toEqual({ ok: true, minor: 1400 })
    expect(evaluate('10÷3', 2)).toEqual({ ok: true, minor: 333 })
    expect(evaluate('20÷3', 2)).toEqual({ ok: true, minor: 667 })
    expect(evaluate('1.25÷2', 2)).toEqual({ ok: true, minor: 63 })
    expect(evaluate('0.1+0.2', 2)).toEqual({ ok: true, minor: 30 })
    expect(evaluate('100-150', 2)).toEqual({ ok: true, minor: -5000 })
    expect(evaluate('7÷2', 0)).toEqual({ ok: true, minor: 4 })
  })

  it('ignores a trailing operator, reads empty as 0 and refuses ÷ 0 or a huge result', () => {
    expect(evaluate('120+', 2)).toEqual({ ok: true, minor: 12000 })
    expect(evaluate('', 2)).toEqual({ ok: true, minor: 0 })
    expect(evaluate('7÷0', 2)).toEqual({ ok: false, error: 'divide' })
    expect(evaluate('9999999999999999×9999', 2)).toEqual({ ok: false, error: 'format' })
  })
})

describe('groupExpression', () => {
  it('groups each whole number in thousands, leaving the decimals as typed', () => {
    expect(groupExpression('8500', 'th-TH-u-ca-gregory')).toBe('8,500')
    expect(groupExpression('8500+1200.5', 'en-GB')).toBe('8,500+1,200.5')
    expect(groupExpression('1234567.12345×3', 'en-GB')).toBe('1,234,567.12345×3')
    expect(groupExpression('-120÷1000', 'en-GB')).toBe('-120÷1,000')
    expect(groupExpression('0.0005', 'en-GB')).toBe('0.0005')
    expect(groupExpression('', 'en-GB')).toBe('')
  })
})

describe('hasOperator', () => {
  it('says whether "=" has something to work out', () => {
    expect(hasOperator('120')).toBe(false)
    expect(hasOperator('120+5')).toBe(true)
  })
})

describe('addQuickAmount', () => {
  it('takes the amount when empty, "0" or after an operator', () => {
    expect(addQuickAmount('', 500, 2)).toBe('500')
    expect(addQuickAmount('0', 100, 2)).toBe('100')
    expect(addQuickAmount('500×', 2, 2)).toBe('500×2')
  })

  it('adds otherwise, like counting notes', () => {
    expect(addQuickAmount('500', 100, 2)).toBe('500+100')
    expect(addQuickAmount('500+100', 1000, 2)).toBe('500+100+1000')
    expect(addQuickAmount('12.', 20, 2)).toBe('12+20')
    expect(evaluate(addQuickAmount(addQuickAmount('', 500, 2), 100, 2), 2)).toEqual({
      ok: true,
      minor: 60000,
    })
  })
})
