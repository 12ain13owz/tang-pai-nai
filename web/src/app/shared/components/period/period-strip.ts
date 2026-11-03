import type { ElementRef } from '@angular/core'
import { Component, effect, input, output, viewChild } from '@angular/core'

/** One chip: the period's id (an offset, or a word such as "future") and its label. */
export interface PeriodChip {
  id: number | string
  label: string
}

/**
 * The period chips under a tab's header (transaction.md → Web screens, DESIGN.md §2): one row
 * that scrolls sideways without a scrollbar, the chosen chip kept in view.
 */
@Component({
  selector: 'app-period-strip',
  host: { class: 'block' },
  template: `
    <div
      #strip
      class="flex [scrollbar-width:none] gap-1 overflow-x-auto px-2 pb-2 [&::-webkit-scrollbar]:hidden"
      role="tablist"
      [attr.aria-label]="label()"
    >
      @for (chip of chips(); track chip.id) {
        <button
          type="button"
          role="tab"
          class="min-h-10 shrink-0 rounded-full px-3.5 text-sm whitespace-nowrap text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none aria-selected:bg-muted aria-selected:font-semibold aria-selected:text-foreground"
          [attr.aria-selected]="chip.id === selected()"
          [attr.data-tab]="chip.id"
          (click)="chosen.emit(chip.id)"
        >
          {{ chip.label }}
        </button>
      }
    </div>
  `,
})
export class PeriodStrip {
  chips = input.required<readonly PeriodChip[]>()
  selected = input.required<number | string>()
  /** The tablist's accessible name. */
  label = input.required<string>()
  chosen = output<number | string>()

  private strip = viewChild.required<ElementRef<HTMLElement>>('strip')

  constructor() {
    // Keep the chosen chip in view (the strip starts at the oldest period).
    effect(() => {
      const selected = this.selected()
      this.chips()
      const strip = this.strip().nativeElement
      queueMicrotask(() => {
        const button = strip.querySelector<HTMLElement>(`[data-tab="${String(selected)}"]`)
        if (button) {
          strip.scrollLeft = button.offsetLeft - (strip.clientWidth - button.offsetWidth) / 2
        }
      })
    })
  }
}
