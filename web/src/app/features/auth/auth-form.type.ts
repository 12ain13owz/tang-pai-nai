import type { FormControl, FormGroup } from '@angular/forms'

export interface EmailFormControls {
  email: FormControl<string>
}
export type EmailFormGroup = FormGroup<EmailFormControls>

export interface CodeFormControls {
  code: FormControl<string>
}
export type CodeFormGroup = FormGroup<CodeFormControls>

export interface PasswordSignInFormControls {
  email: FormControl<string>
  password: FormControl<string>
}
export type PasswordSignInFormGroup = FormGroup<PasswordSignInFormControls>

export interface PhoneFormControls {
  phone: FormControl<string>
}
export type PhoneFormGroup = FormGroup<PhoneFormControls>
