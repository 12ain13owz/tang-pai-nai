// The amount keypad's calculator (transaction.md → Web screens): + − × ÷ on typed major-unit
// numbers, worked as exact fractions of BigInts (never floats), the result rounded half up to
// the currency's minor unit.

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
 * counting notes. An empty amount, "0" or one ending in an operator takes the number; otherwise
 * `+<major>` is appended (`500` → `500+100`). Typed through `pressKey`, so it stays well formed.
 */
export const addQuickAmount = (expr: string, major: number, minorUnit: number): string => {
  let next = expr === '0' ? '' : expr.replace(/\.$/, '')
  if (next !== '' && !isOperator(next.at(-1))) {
    next = pressKey(next, '+', minorUnit)
  }
  for (const digit of String(major)) {
    next = pressKey(next, digit as CalcKey, minorUnit)
  }
  return next
}
