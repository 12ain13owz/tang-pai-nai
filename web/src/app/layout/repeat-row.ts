import { Component, input, output } from '@angular/core'
import { NgIcon, provideIcons } from '@ng-icons/core'
import { lucideChevronRight, lucideRepeat } from '@ng-icons/lucide'

/**
 * A row of the transaction and transfer forms for recurring (docs/features/recurring.md → Web
 * screens): "ทำซ้ำ · ไม่ทำซ้ำ ›", the rule once one is set (in the accent colour, its end and
 * how it records under it), or "จากรายการซ้ำ" on a recorded occurrence. A tap opens it.
 */
@Component({
  selector: 'app-repeat-row',
  imports: [NgIcon],
  providers: [provideIcons({ lucideChevronRight, lucideRepeat })],
  template: `
    <button
      type="button"
      class="flex min-h-14 w-full items-center gap-3 px-4 py-2 text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset"
      [attr.aria-label]="label() + ' ' + title() + (sub() ? ' · ' + sub() : '')"
      (click)="pressed.emit()"
    >
      <span class="flex w-10 shrink-0 justify-center text-muted-foreground">
        <ng-icon name="lucideRepeat" size="22" aria-hidden="true" />
      </span>
      <span class="flex min-w-0 flex-1 flex-col">
        <span
          class="truncate text-base"
          [class.font-semibold]="active()"
          [class.text-brand]="active()"
        >
          {{ title() }}
        </span>
        @if (sub()) {
          <span class="truncate text-sm text-muted-foreground">{{ sub() }}</span>
        }
      </span>
      <ng-icon
        name="lucideChevronRight"
        size="20"
        class="text-muted-foreground"
        aria-hidden="true"
      />
    </button>
  `,
})
export class RepeatRow {
  /** What the row is, for screen readers ("ทำซ้ำ", "จากรายการซ้ำ"). */
  label = input.required<string>()
  title = input.required<string>()
  sub = input('')
  /** A rule is set: the title in the accent colour. */
  active = input(false)
  pressed = output()
}
