import { Component, output } from '@angular/core'
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
 * ÷, ×, ⌫ / 7 8 9 − / 4 5 6 + / 1 2 3 = / 0 000 . — so the phone keyboard never opens. It only
 * emits keys; the form keeps the expression (`pressKey`).
 */
@Component({
  selector: 'app-calc-keypad',
  imports: [TranslocoPipe, NgIcon],
  providers: [provideIcons({ lucideDelete, lucideDivide, lucideMinus, lucidePlus, lucideX })],
  host: { class: 'block bg-muted p-2' },
  template: `
    <div
      class="grid grid-cols-4 gap-1.5"
      role="group"
      [attr.aria-label]="'keypad.label' | transloco"
    >
      @for (item of keys; track item.key) {
        <button
          type="button"
          class="flex h-13 items-center justify-center rounded-xl text-2xl tabular-nums focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none active:opacity-70"
          [class]="classOf(item)"
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
  pressed = output<CalcKey | '='>()

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
        return 'row-span-2 h-auto bg-primary text-xl font-semibold text-primary-foreground'
      case 'op':
        return 'bg-card font-semibold text-brand'
      default:
        return 'bg-card'
    }
  }
}
