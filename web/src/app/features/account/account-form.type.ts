import type { FormControl, FormGroup } from '@angular/forms'

export interface NewPasswordFormControls {
  newPassword: FormControl<string>
  confirmPassword: FormControl<string>
}
export type NewPasswordFormGroup = FormGroup<NewPasswordFormControls>

export interface CurrentPasswordFormControls {
  currentPassword: FormControl<string>
}
export type CurrentPasswordFormGroup = FormGroup<CurrentPasswordFormControls>

export interface ReauthCodeFormControls {
  code: FormControl<string>
}
export type ReauthCodeFormGroup = FormGroup<ReauthCodeFormControls>

/** How the user proves it's them before a password change (auth spec rule 13). */
export type ReauthMethod = 'password' | 'code'

export interface PhoneNumberFormControls {
  phone: FormControl<string>
}
export type PhoneNumberFormGroup = FormGroup<PhoneNumberFormControls>

export interface PhoneCodeFormControls {
  code: FormControl<string>
}
export type PhoneCodeFormGroup = FormGroup<PhoneCodeFormControls>
