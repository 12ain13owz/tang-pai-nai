// Money on the device (ROADMAP → Money & data): amounts are integers in the currency's minor
// unit. Converting typed text and formatting go through strings, never floats.

/** Integers up to this many digits are exact as a JS number (< 2⁵³). */
const SAFE_DIGITS = 15

export type ParsedAmount = { ok: true; minor: number } | { ok: false; error: 'format' | 'decimals' }

/**
 * Typed major-unit text (`1,500.50`, `1500`, `.5`) to a non-negative amount in minor units. Commas
 * and spaces are grouping; one `.` is the decimal point, with at most `minorUnit` digits after it.
 * An empty text is 0.
 */
export const parseMajor = (text: string, minorUnit: number): ParsedAmount => {
  const plain = text.replace(/[\s,]/g, '')
  if (plain === '') {
    return { ok: true, minor: 0 }
  }
  const match = /^(\d*)(?:\.(\d*))?$/.exec(plain)
  if (!match || (match[1] === '' && !match[2])) {
    return { ok: false, error: 'format' }
  }
  const [, whole, fraction = ''] = match
  if (fraction.length > minorUnit) {
    return { ok: false, error: 'decimals' }
  }
  const digits = `${whole}${fraction.padEnd(minorUnit, '0')}`.replace(/^0+(?=\d)/, '')
  if (digits.length > SAFE_DIGITS + 1) {
    return { ok: false, error: 'format' }
  }
  return { ok: true, minor: Number(digits) }
}

/**
 * A minor amount's size as major text for an input, grouped with commas (which `parseMajor`
 * reads back): `1825075` (2) → `18,250.75`, `150000` (2) → `1,500`.
 */
export const toMajorText = (minor: number, minorUnit: number): string => {
  const digits = String(Math.abs(Math.trunc(minor))).padStart(minorUnit + 1, '0')
  const whole = minorUnit === 0 ? digits : digits.slice(0, -minorUnit)
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  const fraction = minorUnit === 0 ? '' : digits.slice(-minorUnit)
  return fraction === '' || /^0+$/.test(fraction) ? grouped : `${grouped}.${fraction}`
}

/** A signed minor amount as an exact decimal string for `Intl.NumberFormat`: `-5` (2) → `-0.05`. */
const toDecimalString = (minor: number, minorUnit: number): string => {
  const digits = String(Math.abs(Math.trunc(minor))).padStart(minorUnit + 1, '0')
  const sign = minor < 0 ? '-' : ''
  return minorUnit === 0
    ? `${sign}${digits}`
    : `${sign}${digits.slice(0, -minorUnit)}.${digits.slice(-minorUnit)}`
}

/** `150050` THB → `฿1,500.50` in the UI language's format (DESIGN.md §5). */
export const formatMoney = (
  minor: number,
  currencyCode: string,
  minorUnit: number,
  locale: string
): string =>
  new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: currencyCode,
    currencyDisplay: 'narrowSymbol',
    minimumFractionDigits: minorUnit,
    maximumFractionDigits: minorUnit,
    // An exact decimal string (Intl.NumberFormat v3, every current browser); TS's lib only
    // types numbers.
  }).format(toDecimalString(minor, minorUnit) as unknown as number)
