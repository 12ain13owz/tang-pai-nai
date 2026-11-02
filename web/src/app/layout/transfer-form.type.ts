import type { FormControl, FormGroup } from '@angular/forms'

export interface TransferFormControls {
  fromWalletId: FormControl<string>
  toWalletId: FormControl<string>
  /** The keypad's expression in major units (`500+500`), worked out on save. */
  amount: FormControl<string>
  note: FormControl<string>
  /** `YYYY-MM-DD`. */
  occurredOn: FormControl<string>
}
export type TransferFormGroup = FormGroup<TransferFormControls>
