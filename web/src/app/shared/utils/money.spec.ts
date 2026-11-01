import { formatMoney, parseMajor, toMajorText } from './money'

describe('parseMajor', () => {
  it('reads typed major units into minor units, grouping commas and spaces allowed', () => {
    expect(parseMajor('1,500.50', 2)).toEqual({ ok: true, minor: 150050 })
    expect(parseMajor(' 1 500 ', 2)).toEqual({ ok: true, minor: 150000 })
    expect(parseMajor('.5', 2)).toEqual({ ok: true, minor: 50 })
    expect(parseMajor('7.', 2)).toEqual({ ok: true, minor: 700 })
    expect(parseMajor('0.05', 2)).toEqual({ ok: true, minor: 5 })
    expect(parseMajor('15000', 0)).toEqual({ ok: true, minor: 15000 })
    expect(parseMajor('1.234', 3)).toEqual({ ok: true, minor: 1234 })
  })

  it('reads an empty text as 0', () => {
    expect(parseMajor('', 2)).toEqual({ ok: true, minor: 0 })
    expect(parseMajor('  ', 2)).toEqual({ ok: true, minor: 0 })
  })

  it('stays exact where floats would not (no 0.1 + 0.2 drift)', () => {
    expect(parseMajor('0.29', 2)).toEqual({ ok: true, minor: 29 })
    expect(parseMajor('10000000000000.00', 2)).toEqual({ ok: true, minor: 1_000_000_000_000_000 })
  })

  it('refuses more decimals than the currency has', () => {
    expect(parseMajor('12.345', 2)).toEqual({ ok: false, error: 'decimals' })
    expect(parseMajor('1.5', 0)).toEqual({ ok: false, error: 'decimals' })
  })

  it('refuses what is not a plain number, and numbers too long to be exact', () => {
    for (const text of ['abc', '-5', '1.2.3', '.', '1e5', '฿10']) {
      expect(parseMajor(text, 2)).toEqual({ ok: false, error: 'format' })
    }
    expect(parseMajor('123456789012345678', 2)).toEqual({ ok: false, error: 'format' })
  })
})

describe('toMajorText', () => {
  it('writes the size of a minor amount as grouped major text that parseMajor reads back', () => {
    expect(toMajorText(1825075, 2)).toBe('18,250.75')
    expect(toMajorText(-1825075, 2)).toBe('18,250.75')
    expect(toMajorText(150000, 2)).toBe('1,500')
    expect(toMajorText(5, 2)).toBe('0.05')
    expect(toMajorText(15000, 0)).toBe('15,000')
    expect(parseMajor(toMajorText(123456789, 2), 2)).toEqual({ ok: true, minor: 123456789 })
  })
})

describe('formatMoney', () => {
  it('formats in the UI language with the currency digits and a narrow symbol', () => {
    expect(formatMoney(150050, 'THB', 2, 'th-TH')).toBe('฿1,500.50')
    expect(formatMoney(-1825075, 'THB', 2, 'en-GB')).toBe('-฿18,250.75')
    expect(formatMoney(0, 'THB', 2, 'en-GB')).toBe('฿0.00')
    expect(formatMoney(15000, 'JPY', 0, 'en-GB')).toBe('¥15,000')
  })
})
