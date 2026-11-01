import { NgTemplateOutlet } from '@angular/common'
import { Component, input } from '@angular/core'
import { ReactiveFormsModule } from '@angular/forms'
import type { FormControl } from '@angular/forms'
import { TranslocoPipe } from '@jsverse/transloco'
import { NgIcon, provideIcons } from '@ng-icons/core'
import { glyphColor, USER_ICONS } from '@/shared/components/icon-badge'
import type { IconGroup } from '@/shared/components/icon-badge'

let nextId = 0

/**
 * Picks one icon from a curated set (lucide + `tpn`, DESIGN.md §7), as a grid (or one grid per
 * group) of 44px radio circles. The picked one shows on `color`. Icon names are labelled through `icons.<name>` keys.
 */
@Component({
  selector: 'app-icon-field',
  imports: [ReactiveFormsModule, NgTemplateOutlet, TranslocoPipe, NgIcon],
  providers: [provideIcons(USER_ICONS)],
  template: `
    <fieldset class="flex flex-col gap-3">
      <legend class="mb-3 text-sm font-medium">{{ label() }}</legend>
      @if (groups().length > 0) {
        @for (iconGroup of groups(); track iconGroup.key) {
          @let headingId = radioName + '-' + iconGroup.key;
          <p class="-mb-1 text-sm text-muted-foreground" [id]="headingId">
            {{ 'iconGroups.' + iconGroup.key | transloco }}
          </p>
          <ng-container
            *ngTemplateOutlet="grid; context: { $implicit: iconGroup.icons, labelledBy: headingId }"
          />
        }
      } @else {
        <ng-container *ngTemplateOutlet="grid; context: { $implicit: icons(), labelledBy: null }" />
      }
      <ng-template #grid let-names let-labelledBy="labelledBy">
        <div
          class="grid grid-cols-6 justify-items-center gap-2"
          [attr.role]="labelledBy ? 'group' : null"
          [attr.aria-labelledby]="labelledBy"
        >
          @for (name of names; track name) {
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
                [name]="radioName"
                [value]="name"
                [formControl]="control()"
                [attr.aria-label]="'icons.' + name | transloco"
              />
              <ng-icon [name]="name" size="20" aria-hidden="true" />
            </label>
          }
        </div>
      </ng-template>
    </fieldset>
  `,
})
export class IconField {
  control = input.required<FormControl<string>>()
  label = input.required<string>()
  /** A flat grid of icons, or `groups` for a titled grid per group. */
  icons = input<readonly string[]>([])
  groups = input<readonly IconGroup[]>([])
  /** The colour the picked icon shows on (`#rrggbb`). */
  color = input('#475569')

  protected radioName = `icon-field-${nextId++}`
  protected glyph = glyphColor
}
