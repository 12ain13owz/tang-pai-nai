import { Component, computed, input, output } from '@angular/core'
import { TranslocoPipe } from '@jsverse/transloco'
import { NgIcon, provideIcons } from '@ng-icons/core'
import { lucideCheck, lucideDelete } from '@ng-icons/lucide'
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
 * The amount keypad (transaction.md → Web screens): numbers only, 7 8 9 ⌫ / 4 5 6 C /
 * 1 2 3 ✓ / 000 0 . in four 44px rows, so the phone keyboard never opens and the form
 * keeps most of the sheet (owner's choice, 2026-11: no + − × ÷, and ✓ "เสร็จ" instead of "=",
 * like a phone's number pad, so it never reads as a sum or the save button). ✓ emits `=`, which
 * settles the amount and closes the keypad. With `quickAmounts` a row of chips sits on top (8.2). It only emits keys; the form
 * keeps the text (`pressKey`, `addQuickAmount`).
 */
@Component({
  selector: 'app-calc-keypad',
  imports: [TranslocoPipe, NgIcon],
  providers: [provideIcons({ lucideCheck, lucideDelete })],
  // Quick taps on the same key must not zoom the page (pinch zoom still works).
  host: {
    class: 'block touch-manipulation bg-muted p-2',
    // Slides up as it opens and down as it closes (DESIGN.md §8); the sheet's `@if` removes it.
    'animate.enter': 'keypad-enter',
    'animate.leave': 'keypad-leave',
  },
  styles: `
    :host(.keypad-enter) {
      animation: keypad-up 200ms cubic-bezier(0, 0, 0.58, 1);
    }
    :host(.keypad-leave) {
      animation: keypad-down 150ms cubic-bezier(0.42, 0, 1, 1) forwards;
    }
    @keyframes keypad-up {
      from {
        transform: translateY(100%);
      }
    }
    @keyframes keypad-down {
      to {
        transform: translateY(100%);
      }
    }
    @media (prefers-reduced-motion: reduce) {
      @keyframes keypad-up {
        from {
          opacity: 0;
        }
      }
      @keyframes keypad-down {
        to {
          opacity: 0;
        }
      }
    }
  `,
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
          [class.h-11]="item.kind !== 'done'"
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
    { key: '7', kind: 'digit' },
    { key: '8', kind: 'digit' },
    { key: '9', kind: 'digit' },
    { key: '⌫', icon: 'lucideDelete', label: 'keypad.backspace', kind: 'op' },
    { key: '4', kind: 'digit' },
    { key: '5', kind: 'digit' },
    { key: '6', kind: 'digit' },
    { key: 'C', label: 'keypad.clear', kind: 'op' },
    { key: '1', kind: 'digit' },
    { key: '2', kind: 'digit' },
    { key: '3', kind: 'digit' },
    { key: '=', icon: 'lucideCheck', label: 'keypad.done', kind: 'done' },
    { key: '000', kind: 'digit' },
    { key: '0', kind: 'digit' },
    { key: '.', label: 'keypad.point', kind: 'digit' },
  ]

  protected classOf(item: Key): string {
    switch (item.kind) {
      case 'done':
        return 'row-span-2 bg-primary text-primary-foreground'
      case 'op':
        return 'bg-card font-semibold text-brand'
      default:
        return 'bg-card'
    }
  }
}
