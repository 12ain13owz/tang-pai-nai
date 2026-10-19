import type { ValidatorFn } from '@angular/forms'

/**
 * Mirrors `PASSWORD_POLICY` in the API (auth spec rule 11, the owner's choice): 8–128 characters
 * with a lowercase letter, an uppercase letter, a digit and one other character. The API has the
 * last word; this only spares a round trip.
 */
export const PASSWORD_POLICY = {
  MIN_LENGTH: 8,
  MAX_LENGTH: 128,
  REQUIRED_CLASSES: [/\p{Ll}/u, /\p{Lu}/u, /\p{Nd}/u, /[^\p{L}\p{N}]/u],
} as const

/**
 * Length, character classes and "not the email", in that order. Errors carry their translation
 * key (see `withMessage`); lengths count code points, as the API does.
 */
export const passwordPolicyValidator =
  (email: () => string): ValidatorFn =>
  (control) => {
    const value = String(control.value ?? '')
    if (value === '') {
      return null // `Validators.required` reports an empty field
    }
    const length = [...value].length
    if (length < PASSWORD_POLICY.MIN_LENGTH) {
      return { passwordTooShort: 'auth.passwordTooShort' }
    }
    if (length > PASSWORD_POLICY.MAX_LENGTH) {
      return { passwordTooLong: 'auth.passwordTooLong' }
    }
    if (!PASSWORD_POLICY.REQUIRED_CLASSES.every((pattern) => pattern.test(value))) {
      return { passwordWeak: 'auth.passwordWeak' }
    }
    const lowered = value.toLowerCase()
    const address = email().toLowerCase()
    if (address && (lowered === address || lowered === address.split('@')[0])) {
      return { passwordSameAsEmail: 'auth.passwordSameAsEmail' }
    }
    return null
  }
