import { Component, input } from '@angular/core'
import { ReactiveFormsModule } from '@angular/forms'
import type { FormControl } from '@angular/forms'
import { TranslocoPipe } from '@jsverse/transloco'
import type { Palette, PaletteId } from '@/core/theme'

/**
 * Colour palette chooser: native radios (arrow keys, screen readers) drawn as swatches. Each swatch
 * sets `data-palette`, so it shows that palette's own background and accent in the current mode.
 */
@Component({
  selector: 'app-palette-picker',
  imports: [TranslocoPipe, ReactiveFormsModule],
  template: `
    <fieldset>
      <legend class="mb-3 text-sm font-medium">{{ 'account.palette' | transloco }}</legend>
      <div class="grid grid-cols-4 gap-2">
        @for (palette of palettes(); track palette.id) {
          <label
            class="flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-transparent px-1 py-2 text-center text-xs has-checked:border-brand has-checked:font-medium has-focus-visible:ring-2 has-focus-visible:ring-ring"
          >
            <input
              type="radio"
              class="sr-only"
              name="palette"
              [value]="palette.id"
              [formControl]="control()"
            />
            <span
              [attr.data-palette]="palette.id"
              class="flex size-11 items-center justify-center rounded-full bg-background ring-1 ring-border"
              aria-hidden="true"
            >
              <span class="size-4 rounded-full bg-primary"></span>
            </span>
            {{ palette.label }}
          </label>
        }
      </div>
    </fieldset>
  `,
})
export class PalettePicker {
  control = input.required<FormControl<PaletteId>>()
  palettes = input.required<readonly Palette[]>()
}
