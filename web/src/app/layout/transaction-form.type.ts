import type { FormControl, FormGroup } from '@angular/forms'

export interface TransactionFormControls {
  /** `expense` | `income`: which categories the picker offers (the sign comes from them). */
  type: FormControl<string>
  walletId: FormControl<string>
  /** The keypad's expression in major units (`120+65`), worked out on save. */
  amount: FormControl<string>
  categoryId: FormControl<string>
  note: FormControl<string>
  /** `YYYY-MM-DD`. */
  occurredOn: FormControl<string>
  excludeFromReport: FormControl<boolean>
}
export type TransactionFormGroup = FormGroup<TransactionFormControls>
export type TransactionFormValue = ReturnType<TransactionFormGroup['getRawValue']>
