import type { ValidatorFn } from '@angular/forms'

// Thai mobile numbers (auth spec rule 21): `+66` followed by 6, 8 or 9 and 8 more digits. Mirrors
// `normalizeThaiMobile` in the API (`api/src/shared/utils/phone.ts`).
const THAI_MOBILE = /^[689]\d{8}$/

/**
 * `081-234-5678`, `0812345678`, `+66 81 234 5678` or `66812345678` → `+66812345678`; anything
 * that isn't a Thai mobile number → `null`.
 */
export const normalizeThaiMobile = (raw: string): string | null => {
  const digits = raw.trim().replace(/[\s\-.()]/g, '')
  let national: string | null = null
  if (digits.startsWith('+66')) {
    national = digits.slice(3)
  } else if (digits.startsWith('66') && digits.length === 11) {
    national = digits.slice(2)
  } else if (digits.startsWith('0')) {
    national = digits.slice(1)
  }
  return national !== null && THAI_MOBILE.test(national) ? `+66${national}` : null
}

/** `+66812345678` → `081-234-5678`, the Thai way (decided at the start of 4.4). */
export const formatThaiMobile = (e164: string): string => {
  const national = `0${e164.replace(/^\+66/, '')}`
  return national.length === 10
    ? `${national.slice(0, 3)}-${national.slice(3, 6)}-${national.slice(6)}`
    : e164
}

/** An empty value is left to `Validators.required`. */
export const thaiMobileValidator: ValidatorFn = (control) => {
  const value: unknown = control.value
  return typeof value === 'string' && value.trim() && !normalizeThaiMobile(value)
    ? { thaiMobile: 'auth.phoneInvalid' }
    : null
}
