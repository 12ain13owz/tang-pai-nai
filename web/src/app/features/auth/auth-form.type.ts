import type { FormControl, FormGroup } from '@angular/forms'

export interface EmailFormControls {
  email: FormControl<string>
}
export type EmailFormGroup = FormGroup<EmailFormControls>

export interface CodeFormControls {
  code: FormControl<string>
}
export type CodeFormGroup = FormGroup<CodeFormControls>
