import { computed, inject } from '@angular/core'
import type { Signal } from '@angular/core'
import { toSignal } from '@angular/core/rxjs-interop'
import type { ValidationErrors, ValidatorFn } from '@angular/forms'
import { TranslocoService } from '@jsverse/transloco'
import type { BrnField } from '@spartan-ng/brain/field'

// Angular's built-in validator error keys → translation keys (`form.*` in core/i18n/*.json), so
// forms can use `Validators.*` as-is. The error object Angular attaches becomes the params.
const DEFAULT_MESSAGES = new Map<string, string>([
  ['required', 'form.required'],
  ['email', 'form.email'],
  ['minlength', 'form.minlength'],
  ['maxlength', 'form.maxlength'],
  ['min', 'form.min'],
  ['max', 'form.max'],
  ['pattern', 'form.pattern'],
])

const FALLBACK_MESSAGE = 'form.invalid'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

type Translate = (key: string, params?: Record<string, unknown>) => string

/**
 * Message for the first error of a control. An error whose value is a string is a translation key
 * (see `withMessage`); otherwise the default key for that error is used.
 */
export const firstErrorMessage = (
  errors: ValidationErrors | null,
  translate: Translate
): string => {
  const first = errors ? Object.entries<unknown>(errors)[0] : undefined
  if (!first) {
    return ''
  }

  const [key, value] = first
  if (typeof value === 'string') {
    return translate(value)
  }

  return translate(DEFAULT_MESSAGES.get(key) ?? FALLBACK_MESSAGE, isRecord(value) ? value : {})
}

/**
 * Field-level error text, recomputed whenever spartan's field state or the language changes.
 * Call it in a field initializer (it needs an injection context).
 */
export const fieldErrorMessage = (field: Signal<BrnField>): Signal<string> => {
  const transloco = inject(TranslocoService)
  const language = toSignal(transloco.langChanges$, { initialValue: transloco.getActiveLang() })
  return computed(() => {
    language()
    return firstErrorMessage(field().errors(), (key, params) => transloco.translate(key, params))
  })
}

/**
 * Replace a validator's error value with a custom message (a translation key), keeping its error
 * key: `withMessage(Validators.required, 'wallets.nameRequired')`.
 */
export const withMessage =
  (validator: ValidatorFn, messageKey: string): ValidatorFn =>
  (control) => {
    const errors = validator(control)
    if (!errors) {
      return null
    }

    return Object.fromEntries(Object.keys(errors).map((key) => [key, messageKey]))
  }
