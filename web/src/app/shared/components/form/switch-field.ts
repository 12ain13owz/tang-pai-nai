import { Component, input } from '@angular/core'
import { ReactiveFormsModule } from '@angular/forms'
import type { FormControl } from '@angular/forms'
import { HlmFieldImports } from '@spartan-ng/helm/field'
import { HlmSwitch } from '@spartan-ng/helm/switch'

/** On/off setting row: label (+ optional hint) on the left, switch on the right. */
@Component({
  selector: 'app-switch-field',
  imports: [ReactiveFormsModule, HlmFieldImports, HlmSwitch],
  template: `
    <div hlmField orientation="horizontal">
      <div hlmFieldContent>
        <label hlmFieldLabel>{{ label() }}</label>
        @if (hint()) {
          <p hlmFieldDescription>{{ hint() }}</p>
        }
      </div>
      <hlm-switch [formControl]="control()" />
    </div>
  `,
})
export class SwitchField {
  control = input.required<FormControl<boolean>>()
  label = input.required<string>()
  hint = input('')
}
