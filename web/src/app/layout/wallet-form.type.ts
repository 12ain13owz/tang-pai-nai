import type { FormControl, FormGroup } from '@angular/forms'

export interface WalletFormControls {
  name: FormControl<string>
  /** Typed major-unit text, without the sign. */
  initialBalance: FormControl<string>
  /** The +/− button (wallet rule 5). */
  negative: FormControl<boolean>
  currencyCode: FormControl<string>
  excludeFromTotal: FormControl<boolean>
  icon: FormControl<string>
  color: FormControl<string>
  /** Category rule 13: the ids switched off in the categories view. */
  hiddenCategoryIds: FormControl<string[]>
}
export type WalletFormGroup = FormGroup<WalletFormControls>
export type WalletFormValue = ReturnType<WalletFormGroup['getRawValue']>
