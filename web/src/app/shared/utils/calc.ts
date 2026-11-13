// The amount keypad's number (transaction.md → Web screens): typed major-unit digits worked
// out as exact fractions of BigInts (never floats), the result rounded half up to the
// currency's minor unit. The keypad has no operator keys (owner's choice, 2026-11: it read as
// a calculator and took the form's space); `pressKey` and `evaluate` still understand + − × ÷.

export type CalcKey =
  | '0'
  | '1'
  | '2'
  | '3'
  | '4'
  | '5'
  | '6'
  | '7'
  | '8'
  | '9'
  | '000'
  | '.'
  | '+'
  | '-'
  | '×'
  | '÷'
  | 'C'
  | '⌫'

const OPERATORS = ['+', '-', '×', '÷'] as const
type Operator = (typeof OPERATORS)[number]

/** Digits a typed number may hold before its decimal point (10¹⁵ fits). */
const WHOLE_DIGITS = 16

const isOperator = (char: string | undefined): char is Operator =>
  char !== undefined && (OPERATORS as readonly string[]).includes(char)

/** The number being typed at the end of `expr` (after its last operator). */
const lastNumber = (expr: string): string => expr.split(/[+\-×÷]/).at(-1) ?? ''

/** `expr` after pressing `key`; keys that would make it malformed change nothing. */
export const pressKey = (expr: string, key: CalcKey, minorUnit: number): string => {
  if (key === 'C') {
    return ''
  }
  if (key === '⌫') {
    return expr.slice(0, -1)
  }
  const last = expr.at(-1)
  if (isOperator(key)) {
    if (expr === '' || last === '.') {
      return expr
    }
    // A second operator in a row replaces the first.
    return isOperator(last) ? `${expr.slice(0, -1)}${key}` : `${expr}${key}`
  }
  const current = lastNumber(expr)
  if (key === '.') {
    if (minorUnit === 0 || current.includes('.')) {
      return expr
    }
    return `${expr}${current === '' ? '0' : ''}.`
  }
  const [whole, fraction] = current.split('.') as [string, string?]
  if (fraction !== undefined) {
    const room = minorUnit - fraction.length
    return room <= 0 ? expr : `${expr}${key.slice(0, room)}`
  }
  if (whole === '0') {
    // No leading zeros: "0" then "5" is "5", "0" then "000" stays "0".
    return key === '000' || key === '0' ? expr : `${expr.slice(0, -1)}${key}`
  }
  if (whole === '' && key === '000') {
    return `${expr}0`
  }
  if (whole.length + key.length > WHOLE_DIGITS) {
    return expr
  }
  return `${expr}${key}`
}

/** Whether `expr` holds an operator, so "=" has something to work out. */
/**
 * The expression as the amount row shows it: each number's whole part grouped in thousands the
 * locale's way (`8500+1200.5` → `8,500+1,200.5`), the decimals as typed. Display only: the
 * control keeps `8500` (owner, after #12).
 */
export const groupExpression = (expr: string, locale: string): string => {
  const group =
    new Intl.NumberFormat(locale).formatToParts(1000).find((part) => part.type === 'group')
      ?.value ?? ','
  return expr.replace(/\d+/g, (digits, offset: number) =>
    // Digits after a decimal point stay as typed.
    expr[offset - 1] === '.' ? digits : digits.replace(/\B(?=(\d{3})+(?!\d))/g, group)
  )
}

export const hasOperator = (expr: string): boolean => /[+\-×÷]/.test(expr.replace(/^-/, ''))

interface Fraction {
  n: bigint
  d: bigint
}

const toFraction = (text: string): Fraction => {
  const [whole, fraction = ''] = text.split('.')
  return { n: BigInt(`${whole || '0'}${fraction}`), d: 10n ** BigInt(fraction.length) }
}

const apply = (a: Fraction, op: Operator, b: Fraction): Fraction | null => {
  switch (op) {
    case '+':
      return { n: a.n * b.d + b.n * a.d, d: a.d * b.d }
    case '-':
      return { n: a.n * b.d - b.n * a.d, d: a.d * b.d }
    case '×':
      return { n: a.n * b.n, d: a.d * b.d }
    case '÷':
      return b.n === 0n ? null : { n: a.n * b.d, d: a.d * b.n }
  }
}

export type CalcResult = { ok: true; minor: number } | { ok: false; error: 'format' | 'divide' }

/**
 * `expr` worked out to minor units: × and ÷ before + and −, left to right, rounded half away
 * from zero. A trailing operator is ignored ("120+" is 120). The result may be zero or negative;
 * the form decides what it accepts.
 */
export const evaluate = (expr: string, minorUnit: number): CalcResult => {
  const text = isOperator(expr.at(-1)) ? expr.slice(0, -1) : expr
  if (text === '') {
    return { ok: true, minor: 0 }
  }
  const parts = text.split(/([+\-×÷])/)
  if (parts.some((part, i) => (i % 2 === 0 ? !/^\d*\.?\d*$/.test(part) || part === '' : false))) {
    return { ok: false, error: 'format' }
  }
  // First × and ÷ into terms, then + and − across them.
  const terms: Fraction[] = [toFraction(parts[0])]
  const signs: Operator[] = []
  for (let i = 1; i < parts.length; i += 2) {
    const op = parts[i] as Operator
    const value = toFraction(parts[i + 1])
    if (op === '×' || op === '÷') {
      const product = apply(terms[terms.length - 1], op, value)
      if (!product) {
        return { ok: false, error: 'divide' }
      }
      terms[terms.length - 1] = product
    } else {
      signs.push(op)
      terms.push(value)
    }
  }
  let total = terms[0]
  signs.forEach((op, i) => {
    total = apply(total, op, terms[i + 1]) ?? total
  })
  // To minor units: n / d × 10^minor, rounded half away from zero.
  const scaled = total.n * 10n ** BigInt(minorUnit)
  const negative = scaled < 0n !== total.d < 0n
  const n = scaled < 0n ? -scaled : scaled
  const d = total.d < 0n ? -total.d : total.d
  const rounded = (n * 2n + d) / (2n * d)
  const minor = negative ? -rounded : rounded
  if (minor > BigInt(Number.MAX_SAFE_INTEGER) || minor < -BigInt(Number.MAX_SAFE_INTEGER)) {
    return { ok: false, error: 'format' }
  }
  return { ok: true, minor: Number(minor) }
}

/**
 * `expr` after a quick amount (`major`, a whole number of major units; 8.2): it adds, like
 * counting notes, and the amount shows the total at once (`500` → `600`). The keypad has no
 * operators, so the amount stays a plain number. An amount that
 * can't be worked out, or a total past `WHOLE_DIGITS`, is left as it was.
 */
export const addQuickAmount = (expr: string, major: number, minorUnit: number): string => {
  const current = evaluate(expr, minorUnit)
  if (!current.ok) {
    return expr
  }
  const scale = 10n ** BigInt(minorUnit)
  const total = BigInt(current.minor) + BigInt(major) * scale
  const whole = total / scale
  if (whole.toString().length > WHOLE_DIGITS) {
    return expr
  }
  const fraction = (total % scale).toString().padStart(minorUnit, '0').replace(/0+$/, '')
  return fraction === '' ? whole.toString() : `${whole}.${fraction}`
}

/**
 * Keys a hardware keyboard may type into the on-screen keypad (digits map to themselves): the
 * keypad's own keys only, so no operators.
 */
export const CALC_KEYBOARD: Readonly<Partial<Record<string, CalcKey | '='>>> = {
  '.': '.',
  ',': '.',
  Backspace: '⌫',
  Delete: 'C',
  Escape: '=',
  Enter: '=',
}
