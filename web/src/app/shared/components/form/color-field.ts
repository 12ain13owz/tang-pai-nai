import { Component, input } from '@angular/core'
import { ReactiveFormsModule } from '@angular/forms'
import type { FormControl } from '@angular/forms'
import { TranslocoPipe } from '@jsverse/transloco'
import { NgIcon, provideIcons } from '@ng-icons/core'
import { lucideCheck } from '@ng-icons/lucide'
import { glyphColor } from '@/shared/components/icon-badge'

let nextId = 0

/** Picks one user colour (DESIGN.md §3), as a row of 44px radio swatches with a check. */
@Component({
  selector: 'app-color-field',
  imports: [ReactiveFormsModule, TranslocoPipe, NgIcon],
  providers: [provideIcons({ lucideCheck })],
  template: `
    <fieldset class="flex flex-col gap-3">
      <legend class="mb-3 text-sm font-medium">{{ label() }}</legend>
      <div class="grid grid-cols-5 justify-items-center gap-2">
        @for (color of colors(); track color; let index = $index) {
          <label
            class="flex size-11 cursor-pointer items-center justify-center rounded-full has-focus-visible:ring-2 has-focus-visible:ring-ring has-focus-visible:ring-offset-2 has-focus-visible:ring-offset-background"
            [style.background-color]="color"
            [style.color]="glyph(color)"
          >
            <input
              type="radio"
              class="sr-only"
              [name]="group"
              [value]="color"
              [formControl]="control()"
              [attr.aria-label]="'colors.label' | transloco: { number: index + 1 }"
            />
            @if (control().value === color) {
              <ng-icon name="lucideCheck" size="20" aria-hidden="true" />
            }
          </label>
        }
      </div>
    </fieldset>
  `,
})
export class ColorField {
  control = input.required<FormControl<string>>()
  label = input.required<string>()
  colors = input.required<readonly string[]>()

  protected group = `color-field-${nextId++}`
  protected glyph = glyphColor
}
