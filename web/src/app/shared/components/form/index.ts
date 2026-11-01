import { ReactiveFormsModule } from '@angular/forms'
import { MarkTouchedOnSubmit } from './mark-touched-on-submit'

export * from './amount-field'
export * from './color-field'
export * from './field-error'
export * from './icon-field'
export * from './input-field'
export * from './name-icon-field'
export * from './mark-touched-on-submit'
export * from './otp-field'
export * from './password-field'
export * from './select-field'
export * from './switch-field'
export * from './textarea-field'

/** Import in every component that renders a `<form [formGroup]>`, then add the fields it uses. */
export const FORM_IMPORTS = [ReactiveFormsModule, MarkTouchedOnSubmit] as const
