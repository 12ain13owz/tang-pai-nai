import { describe, expect, it } from 'vitest'
import { maskPhone, normalizeThaiMobile, phoneLastDigits } from './phone'

describe('normalizeThaiMobile', () => {
  it('turns the usual ways of typing a Thai mobile number into E.164', () => {
    for (const raw of [
      '0812345678',
      '081-234-5678',
      ' 081 234 5678 ',
      '+66812345678',
      '+66 81-234-5678',
      '66812345678',
      '(081) 234.5678',
    ]) {
      expect(normalizeThaiMobile(raw)).toBe('+66812345678')
    }
    expect(normalizeThaiMobile('0612345678')).toBe('+66612345678')
    expect(normalizeThaiMobile('0912345678')).toBe('+66912345678')
  })

  it('refuses landlines, other countries, wrong lengths and junk', () => {
    for (const raw of [
      '021234567',
      '0712345678',
      '081234567',
      '08123456789',
      '+15551234567',
      '+660812345678',
      '812345678',
      'O812345678',
      '',
    ]) {
      expect(normalizeThaiMobile(raw)).toBeNull()
    }
  })
})

describe('maskPhone', () => {
  it('keeps the country code and the last 4 digits only', () => {
    expect(maskPhone('+66812345678')).toBe('+66*****5678')
  })
})

describe('phoneLastDigits', () => {
  it('answers the last 4 digits', () => {
    expect(phoneLastDigits('+66812345678')).toBe('5678')
  })
})
