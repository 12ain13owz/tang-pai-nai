import type { FormControl, FormGroup } from '@angular/forms'

export interface ProfileFormControls {
  name: FormControl<string>
  icon: FormControl<string>
  color: FormControl<string>
}
export type ProfileFormGroup = FormGroup<ProfileFormControls>
export type ProfileFormValue = ReturnType<ProfileFormGroup['getRawValue']>
