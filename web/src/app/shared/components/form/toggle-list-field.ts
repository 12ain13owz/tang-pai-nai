import { Component, input } from '@angular/core'
import type { FormControl } from '@angular/forms'
import { IconBadge } from '@/shared/components/icon-badge'
import type { UserIcon } from '@/shared/components/icon-badge'

/** One row of `app-toggle-list-field`. */
export interface ToggleListItem {
  id: string
  label: string
  icon: string
  color: string
  fallback: UserIcon
  /** A child row: a 32px badge, indented under its parent. */
  child?: boolean
  /**
   * Shown off and can't change, with this line under the label (e.g. hidden with its parent).
   */
  lockedNote?: string | null
}

/**
 * A list of things with a switch each (category rule 13: the categories a wallet uses, the
 * wallets a category is used in). The control holds the ids switched **off**. Each row is one
 * 56px switch button (the whole row toggles), drawn like `hlm-switch`.
 */
@Component({
  selector: 'app-toggle-list-field',
  imports: [IconBadge],
  template: `
    <ul
      class="divide-y divide-border rounded-xl border border-border bg-card text-card-foreground"
      [attr.aria-label]="label()"
    >
      @for (item of items(); track item.id) {
        @let locked = !!item.lockedNote;
        @let on = !locked && !control().value.includes(item.id);
        <li>
          <button
            type="button"
            role="switch"
            class="flex w-full items-center gap-3 py-2 pr-4 text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset disabled:cursor-not-allowed"
            [class.min-h-14]="!item.child"
            [class.min-h-12]="item.child"
            [class.pl-4]="!item.child"
            [class.pl-17]="item.child"
            [attr.aria-checked]="on"
            [disabled]="locked || control().disabled"
            (click)="toggle(item.id)"
          >
            <app-icon-badge
              [class.opacity-50]="locked"
              [icon]="item.icon"
              [color]="item.color"
              [fallback]="item.fallback"
              [size]="item.child ? 32 : 40"
            />
            <span class="flex min-w-0 flex-1 flex-col">
              <span class="truncate" [class.font-medium]="!item.child">{{ item.label }}</span>
              @if (item.lockedNote) {
                <span class="text-xs text-muted-foreground">{{ item.lockedNote }}</span>
              }
            </span>
            <span
              aria-hidden="true"
              class="inline-flex h-[18.4px] w-8 shrink-0 items-center rounded-full border border-transparent transition-all {{
                on ? 'bg-primary' : 'bg-input dark:bg-input/80'
              }}"
              [class.opacity-50]="locked"
            >
              <span
                class="block size-4 rounded-full transition-transform {{
                  on
                    ? 'translate-x-[calc(100%-2px)] bg-background dark:bg-primary-foreground'
                    : 'bg-background dark:bg-foreground'
                }}"
              ></span>
            </span>
          </button>
        </li>
      }
    </ul>
  `,
})
export class ToggleListField {
  control = input.required<FormControl<string[]>>()
  /** Names the list for screen readers. */
  label = input.required<string>()
  items = input.required<readonly ToggleListItem[]>()

  protected toggle(id: string): void {
    const control = this.control()
    const off = control.value
    control.setValue(off.includes(id) ? off.filter((other) => other !== id) : [...off, id])
    control.markAsDirty()
  }
}
