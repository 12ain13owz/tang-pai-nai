// Thai mobile numbers (auth spec rule 21): `+66` followed by 6, 8 or 9 and 8 more digits.
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

/** The last 4 digits, as the change mail names a number (rule 31). */
export const phoneLastDigits = (phone: string): string => phone.slice(-4)

/** `+66*****5678`: how a number appears in logs (rule 27), never in full. */
export const maskPhone = (phone: string): string =>
  `${phone.slice(0, 3)}${'*'.repeat(Math.max(0, phone.length - 7))}${phone.slice(-4)}`
