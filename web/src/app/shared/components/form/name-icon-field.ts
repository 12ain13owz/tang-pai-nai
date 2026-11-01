import { Component, input, output, viewChild } from '@angular/core'
import { ReactiveFormsModule } from '@angular/forms'
import type { FormControl } from '@angular/forms'
import { NgIcon, provideIcons } from '@ng-icons/core'
import { lucidePencil } from '@ng-icons/lucide'
import { BrnField } from '@spartan-ng/brain/field'
import { HlmFieldImports } from '@spartan-ng/helm/field'
import { HlmInput } from '@spartan-ng/helm/input'
import { FALLBACK_ICON, IconBadge } from '@/shared/components/icon-badge'
import type { UserIcon } from '@/shared/components/icon-badge'
import { fieldErrorMessage } from './field-error'

let nextId = 0

/**
 * The compact sheet's first row (DESIGN.md §6 Compact sheet forms): the item's icon on its colour
 * (a button that opens the icon picker) and its name across the rest of the row. The label is for
 * screen readers; the placeholder says it on screen.
 */
@Component({
  selector: 'app-name-icon-field',
  imports: [ReactiveFormsModule, NgIcon, HlmFieldImports, HlmInput, IconBadge],
  providers: [provideIcons({ lucidePencil })],
  template: `
    <div hlmField>
      <div class="flex items-center gap-3">
        <button
          type="button"
          class="relative shrink-0 rounded-full focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card focus-visible:outline-none"
          [attr.aria-label]="iconLabel()"
          (click)="iconClick.emit()"
        >
          <app-icon-badge [icon]="icon()" [color]="color()" [size]="52" [fallback]="fallback()" />
          <span
            class="absolute -right-0.5 -bottom-0.5 flex size-5 items-center justify-center rounded-full bg-card text-foreground ring-1 ring-border"
            aria-hidden="true"
          >
            <ng-icon name="lucidePencil" size="11" />
          </span>
        </button>
        <label class="sr-only" [for]="inputId">{{ label() }}</label>
        <input
          hlmInput
          class="h-12 rounded-none border-0 border-b bg-transparent px-0 text-lg shadow-none focus-visible:ring-0 data-[matches-spartan-invalid=true]:ring-0 md:text-lg dark:bg-transparent"
          autocomplete="off"
          [id]="inputId"
          [formControl]="control()"
          [placeholder]="label()"
        />
      </div>
      <hlm-field-error class="-mt-2 pl-16">{{ error() }}</hlm-field-error>
    </div>
  `,
})
export class NameIconField {
  control = input.required<FormControl<string>>()
  /** The name's label: read by screen readers and shown as the placeholder. */
  label = input.required<string>()
  icon = input.required<string>()
  color = input.required<string>()
  fallback = input<UserIcon>(FALLBACK_ICON)
  /** The icon button's label, e.g. "เปลี่ยนไอคอนและสี". */
  iconLabel = input.required<string>()
  iconClick = output()

  protected inputId = `name-icon-field-${nextId++}`
  private field = viewChild.required(BrnField)
  protected error = fieldErrorMessage(this.field)
}
