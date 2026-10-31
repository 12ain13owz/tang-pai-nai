import { Component, input } from '@angular/core'
import { ReactiveFormsModule } from '@angular/forms'
import type { FormControl } from '@angular/forms'
import { TranslocoPipe } from '@jsverse/transloco'
import { NgIcon, provideIcons } from '@ng-icons/core'
import { glyphColor, PROFILE_ICONS } from '@/shared/components/icon-badge'

let nextId = 0

/**
 * Picks one icon from a curated lucide set (DESIGN.md §7), as a grid of 44px radio circles. The
 * picked one shows on `color`. Icon names are labelled through `icons.<name>` keys.
 */
@Component({
  selector: 'app-icon-field',
  imports: [ReactiveFormsModule, TranslocoPipe, NgIcon],
  providers: [provideIcons(PROFILE_ICONS)],
  template: `
    <fieldset class="flex flex-col gap-3">
      <legend class="mb-3 text-sm font-medium">{{ label() }}</legend>
      <div class="grid grid-cols-6 justify-items-center gap-2">
        @for (name of icons(); track name) {
          @let picked = control().value === name;
          <label
            class="flex size-11 cursor-pointer items-center justify-center rounded-full has-focus-visible:ring-2 has-focus-visible:ring-ring"
            [class.bg-muted]="!picked"
            [class.text-muted-foreground]="!picked"
            [style.background-color]="picked ? color() : null"
            [style.color]="picked ? glyph(color()) : null"
          >
            <input
              type="radio"
              class="sr-only"
              [name]="group"
              [value]="name"
              [formControl]="control()"
              [attr.aria-label]="'icons.' + name | transloco"
            />
            <ng-icon [name]="name" size="20" aria-hidden="true" />
          </label>
        }
      </div>
    </fieldset>
  `,
})
export class IconField {
  control = input.required<FormControl<string>>()
  label = input.required<string>()
  icons = input.required<readonly string[]>()
  /** The colour the picked icon shows on (`#rrggbb`). */
  color = input('#475569')

  protected group = `icon-field-${nextId++}`
  protected glyph = glyphColor
}
