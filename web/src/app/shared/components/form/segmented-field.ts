import { Component, input } from '@angular/core'
import { ReactiveFormsModule } from '@angular/forms'
import type { FormControl } from '@angular/forms'
import type { SelectOption } from '@/shared/types'

let nextId = 0

/**
 * Picks one of two or three short options as a segmented control (radios under the hood), e.g.
 * รายจ่าย / รายรับ. The label is for screen readers; a disabled control reads as locked.
 */
@Component({
  selector: 'app-segmented-field',
  imports: [ReactiveFormsModule],
  template: `
    <fieldset class="flex flex-col" [disabled]="control().disabled">
      <legend class="sr-only">{{ label() }}</legend>
      <div class="flex rounded-lg bg-muted p-1" [class.opacity-60]="control().disabled">
        @for (option of options(); track option.value) {
          <label
            class="flex h-10 flex-1 cursor-pointer items-center justify-center rounded-md text-sm text-muted-foreground has-checked:bg-card has-checked:font-semibold has-checked:text-foreground has-checked:shadow-sm has-focus-visible:ring-2 has-focus-visible:ring-ring"
          >
            <input
              type="radio"
              class="sr-only"
              [name]="group"
              [value]="option.value"
              [formControl]="control()"
            />
            {{ option.label }}
          </label>
        }
      </div>
    </fieldset>
  `,
})
export class SegmentedField {
  control = input.required<FormControl<string>>()
  label = input.required<string>()
  options = input.required<readonly SelectOption[]>()

  protected group = `segmented-field-${nextId++}`
}
