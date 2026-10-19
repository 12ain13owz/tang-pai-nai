import { Component, input, viewChild } from '@angular/core'
import { ReactiveFormsModule } from '@angular/forms'
import type { FormControl } from '@angular/forms'
import { BrnField } from '@spartan-ng/brain/field'
import { HlmFieldImports } from '@spartan-ng/helm/field'
import { HlmInput } from '@spartan-ng/helm/input'
import { fieldErrorMessage } from './field-error'

type InputType = 'text' | 'email' | 'tel' | 'url' | 'search'
type InputMode = 'text' | 'email' | 'tel' | 'url' | 'search' | 'numeric' | 'decimal'

@Component({
  selector: 'app-input-field',
  imports: [ReactiveFormsModule, HlmFieldImports, HlmInput],
  template: `
    <div hlmField>
      <label hlmFieldLabel>{{ label() }}</label>
      <input
        hlmInput
        [formControl]="control()"
        [type]="type()"
        [placeholder]="placeholder()"
        [attr.autocomplete]="autocomplete()"
        [attr.inputmode]="inputmode()"
      />
      @if (hint()) {
        <p hlmFieldDescription class="-mt-2">{{ hint() }}</p>
      }
      <hlm-field-error class="-mt-2">{{ error() }}</hlm-field-error>
    </div>
  `,
})
export class InputField {
  control = input.required<FormControl<string>>()
  label = input.required<string>()
  type = input<InputType>('text')
  placeholder = input('')
  hint = input('')
  autocomplete = input<string | null>(null)
  inputmode = input<InputMode | null>(null)

  private field = viewChild.required(BrnField)
  protected error = fieldErrorMessage(this.field)
}
