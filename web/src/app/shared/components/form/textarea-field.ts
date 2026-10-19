import { Component, input, viewChild } from '@angular/core'
import { ReactiveFormsModule } from '@angular/forms'
import type { FormControl } from '@angular/forms'
import { BrnField } from '@spartan-ng/brain/field'
import { HlmFieldImports } from '@spartan-ng/helm/field'
import { HlmTextarea } from '@spartan-ng/helm/textarea'
import { fieldErrorMessage } from './field-error'

@Component({
  selector: 'app-textarea-field',
  imports: [ReactiveFormsModule, HlmFieldImports, HlmTextarea],
  template: `
    <div hlmField>
      <label hlmFieldLabel>{{ label() }}</label>
      <textarea
        hlmTextarea
        [formControl]="control()"
        [rows]="rows()"
        [placeholder]="placeholder()"
      ></textarea>
      @if (hint()) {
        <p hlmFieldDescription class="-mt-2">{{ hint() }}</p>
      }
      <hlm-field-error class="-mt-2">{{ error() }}</hlm-field-error>
    </div>
  `,
})
export class TextareaField {
  control = input.required<FormControl<string>>()
  label = input.required<string>()
  placeholder = input('')
  hint = input('')
  rows = input(3)

  private field = viewChild.required(BrnField)
  protected error = fieldErrorMessage(this.field)
}
