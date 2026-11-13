import { Component, computed, input, output } from '@angular/core'
import { TranslocoPipe } from '@jsverse/transloco'
import { NgIcon, provideIcons } from '@ng-icons/core'
import { lucideDelete, lucideDivide, lucideMinus, lucidePlus, lucideX } from '@ng-icons/lucide'
import type { CalcKey } from '@/shared/utils'

interface Key {
  key: CalcKey | '='
  /** Shown text, or an icon name. */
  text?: string
  icon?: string
  /** Translation key of the spoken name (operators and actions). */
  label?: string
  kind: 'digit' | 'op' | 'done'
}

/**
 * The amount keypad (transaction.md → Web screens, from the owner's Money Lover screenshot): C,
 * ÷, ×, ⌫ / 7 8 9 − / 4 5 6 + / 1 2 3 = / 0 000 . — so the phone keyboard never opens. With
 * `quickAmounts` a row of chips sits on top and the keys get 4px shorter (8.2). It only emits
 * keys; the form keeps the expression (`pressKey`, `addQuickAmount`).
 */
@Component({
  selector: 'app-calc-keypad',
  imports: [TranslocoPipe, NgIcon],
  providers: [provideIcons({ lucideDelete, lucideDivide, lucideMinus, lucidePlus, lucideX })],
  // Quick taps on the same key must not zoom the page (pinch zoom still works).
  host: { class: 'block touch-manipulation bg-muted p-2' },
  template: `
    @if (quickAmounts().length > 0) {
      <div
        class="mb-1.5 flex gap-1.5"
        role="group"
        [attr.aria-label]="'keypad.quickLabel' | transloco"
      >
        @for (item of quick(); track item.value) {
          <button
            type="button"
            class="flex h-9 min-w-0 flex-1 items-center justify-center rounded-full border border-border bg-card text-[0.9375rem] font-medium tabular-nums focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none active:opacity-70"
            [attr.aria-label]="'keypad.quickAdd' | transloco: { amount: item.text }"
            (click)="quickPressed.emit(item.value)"
          >
            {{ item.text }}
          </button>
        }
      </div>
    }
    <div
      class="grid grid-cols-4 gap-1.5"
      role="group"
      [attr.aria-label]="'keypad.label' | transloco"
    >
      @for (item of keys; track item.key) {
        <button
          type="button"
          class="flex items-center justify-center rounded-xl text-2xl tabular-nums focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none active:opacity-70"
          [class]="classOf(item)"
          [class.h-13]="item.kind !== 'done' && quickAmounts().length === 0"
          [class.h-12]="item.kind !== 'done' && quickAmounts().length > 0"
          [attr.aria-label]="item.label ? (item.label | transloco) : null"
          (click)="pressed.emit(item.key)"
        >
          @if (item.icon) {
            <ng-icon [name]="item.icon" size="22" aria-hidden="true" />
          } @else {
            {{ item.text ?? item.key }}
          }
        </button>
      }
    </div>
  `,
})
export class CalcKeypad {
  /** Quick amounts in whole major units (8.2), a chip row above the keys; none hides it. */
  quickAmounts = input<readonly number[]>([])
  locale = input('th-TH')
  pressed = output<CalcKey | '='>()
  quickPressed = output<number>()

  protected quick = computed(() => {
    const format = new Intl.NumberFormat(this.locale(), { maximumFractionDigits: 0 })
    return this.quickAmounts().map((value) => ({ value, text: format.format(value) }))
  })

  protected readonly keys: readonly Key[] = [
    { key: 'C', label: 'keypad.clear', kind: 'op' },
    { key: '÷', icon: 'lucideDivide', label: 'keypad.divide', kind: 'op' },
    { key: '×', icon: 'lucideX', label: 'keypad.times', kind: 'op' },
    { key: '⌫', icon: 'lucideDelete', label: 'keypad.backspace', kind: 'op' },
    { key: '7', kind: 'digit' },
    { key: '8', kind: 'digit' },
    { key: '9', kind: 'digit' },
    { key: '-', icon: 'lucideMinus', label: 'keypad.minus', kind: 'op' },
    { key: '4', kind: 'digit' },
    { key: '5', kind: 'digit' },
    { key: '6', kind: 'digit' },
    { key: '+', icon: 'lucidePlus', label: 'keypad.plus', kind: 'op' },
    { key: '1', kind: 'digit' },
    { key: '2', kind: 'digit' },
    { key: '3', kind: 'digit' },
    { key: '=', text: '=', label: 'keypad.done', kind: 'done' },
    { key: '0', kind: 'digit' },
    { key: '000', kind: 'digit' },
    { key: '.', label: 'keypad.point', kind: 'digit' },
  ]

  protected classOf(item: Key): string {
    switch (item.kind) {
      case 'done':
        return 'row-span-2 bg-primary text-xl font-semibold text-primary-foreground'
      case 'op':
        return 'bg-card font-semibold text-brand'
      default:
        return 'bg-card'
    }
  }
}
