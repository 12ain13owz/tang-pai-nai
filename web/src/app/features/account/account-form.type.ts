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

/** The dev-only sync test item (offline-sync → Web screens), removed at #6. */
export interface SyncProbeFormControls {
  title: FormControl<string>
  /** Baht as typed, e.g. `65` or `65.50`. */
  amount: FormControl<string>
}
export type SyncProbeFormGroup = FormGroup<SyncProbeFormControls>
export type SyncProbeFormValue = ReturnType<SyncProbeFormGroup['getRawValue']>
