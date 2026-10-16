import { Component, computed, input, viewChild } from '@angular/core'
import { ReactiveFormsModule } from '@angular/forms'
import type { FormControl } from '@angular/forms'
import { BrnField } from '@spartan-ng/brain/field'
import { BrnInputOtp } from '@spartan-ng/brain/input-otp'
import { HlmFieldImports } from '@spartan-ng/helm/field'
import { HlmInputOtpImports } from '@spartan-ng/helm/input-otp'
import { fieldErrorMessage } from './field-error'

/** One-time code (sign-in email code). `autocomplete="one-time-code"` lets the phone auto-fill it. */
@Component({
  selector: 'app-otp-field',
  imports: [ReactiveFormsModule, HlmFieldImports, BrnInputOtp, HlmInputOtpImports],
  template: `
    <div hlmField class="items-center">
      <label hlmFieldLabel>{{ label() }}</label>
      <brn-input-otp
        hlmInputOtp
        inputMode="numeric"
        inputAutocomplete="one-time-code"
        [length]="length()"
        [formControl]="control()"
      >
        <div hlmInputOtpGroup>
          @for (slot of slots(); track $index) {
            <hlm-input-otp-slot [index]="$index" />
          }
        </div>
      </brn-input-otp>
      <hlm-field-error>{{ error() }}</hlm-field-error>
    </div>
  `,
})
export class OtpField {
  control = input.required<FormControl<string>>()
  label = input.required<string>()
  length = input(6)

  protected slots = computed(() => Array.from({ length: this.length() }))

  private field = viewChild.required(BrnField)
  protected error = fieldErrorMessage(this.field)
}
