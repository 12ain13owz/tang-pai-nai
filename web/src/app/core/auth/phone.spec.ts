import { FormControl } from '@angular/forms'
import { formatThaiMobile, normalizeThaiMobile, thaiMobileValidator } from './phone'

describe('normalizeThaiMobile', () => {
  it('turns the usual ways of typing a Thai mobile number into E.164', () => {
    for (const raw of [
      '0812345678',
      '081-234-5678',
      ' 081 234 5678 ',
      '+66 81-234-5678',
      '66812345678',
    ]) {
      expect(normalizeThaiMobile(raw)).toBe('+66812345678')
    }
  })

  it('refuses landlines, other countries and wrong lengths', () => {
    for (const raw of ['021234567', '0712345678', '081234567', '+15551234567', '']) {
      expect(normalizeThaiMobile(raw)).toBeNull()
    }
  })
})

describe('formatThaiMobile', () => {
  it('shows an E.164 number the Thai way', () => {
    expect(formatThaiMobile('+66812345678')).toBe('081-234-5678')
    expect(formatThaiMobile('+66612345678')).toBe('061-234-5678')
  })
})

describe('thaiMobileValidator', () => {
  const errorsOf = (value: string) => thaiMobileValidator(new FormControl(value))

  it('leaves an empty value to Validators.required', () => {
    expect(errorsOf('')).toBeNull()
    expect(errorsOf('  ')).toBeNull()
  })

  it('answers its translation key for anything that isn’t a Thai mobile', () => {
    expect(errorsOf('12345')).toEqual({ thaiMobile: 'auth.phoneInvalid' })
    expect(errorsOf('081-234-5678')).toBeNull()
  })
})
