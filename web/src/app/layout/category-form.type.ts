import type { FormControl, FormGroup } from '@angular/forms'

export interface CategoryFormControls {
  name: FormControl<string>
  icon: FormControl<string>
  color: FormControl<string>
  /** `expense` | `income`. */
  type: FormControl<string>
  /** The parent's id, `''` for a top-level category. */
  parentId: FormControl<string>
}
export type CategoryFormGroup = FormGroup<CategoryFormControls>
export type CategoryFormValue = ReturnType<CategoryFormGroup['getRawValue']>
