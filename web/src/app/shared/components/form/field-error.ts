import { computed } from '@angular/core'
import type { Signal } from '@angular/core'
import type { ValidationErrors, ValidatorFn } from '@angular/forms'
import type { BrnField } from '@spartan-ng/brain/field'

type MessageBuilder = (error: Record<string, unknown>) => string

const FALLBACK_MESSAGE = 'ข้อมูลไม่ถูกต้อง'

// Default Thai messages for Angular's built-in validators, so forms can use `Validators.*` as-is.
// Keys match the error keys Angular sets; params come from the error object Angular attaches.
const DEFAULT_MESSAGES = new Map<string, MessageBuilder>([
  ['required', () => 'กรุณากรอกข้อมูลนี้'],
  ['email', () => 'รูปแบบอีเมลไม่ถูกต้อง'],
  ['minlength', (e) => `ต้องมีอย่างน้อย ${String(e['requiredLength'])} ตัวอักษร`],
  ['maxlength', (e) => `ต้องไม่เกิน ${String(e['requiredLength'])} ตัวอักษร`],
  ['min', (e) => `ต้องไม่น้อยกว่า ${String(e['min'])}`],
  ['max', (e) => `ต้องไม่เกิน ${String(e['max'])}`],
  ['pattern', () => 'รูปแบบไม่ถูกต้อง'],
])

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

/**
 * Message for the first error of a control. An error whose value is a string *is* the message
 * (see `withMessage`); otherwise the default for that error key is used.
 */
export const firstErrorMessage = (errors: ValidationErrors | null): string => {
  const first = errors ? Object.entries<unknown>(errors)[0] : undefined
  if (!first) {
    return ''
  }

  const [key, value] = first
  if (typeof value === 'string') {
    return value
  }

  const builder = DEFAULT_MESSAGES.get(key)
  return builder ? builder(isRecord(value) ? value : {}) : FALLBACK_MESSAGE
}

/** Field-level error text, recomputed whenever spartan's field state changes. */
export const fieldErrorMessage = (field: Signal<BrnField>): Signal<string> =>
  computed(() => firstErrorMessage(field().errors()))

/**
 * Replace a validator's error value with a custom message, keeping its error key:
 * `withMessage(Validators.required, 'กรุณาใส่ชื่อกระเป๋าเงิน')`.
 */
export const withMessage =
  (validator: ValidatorFn, message: string): ValidatorFn =>
  (control) => {
    const errors = validator(control)
    if (!errors) {
      return null
    }

    return Object.fromEntries(Object.keys(errors).map((key) => [key, message]))
  }
