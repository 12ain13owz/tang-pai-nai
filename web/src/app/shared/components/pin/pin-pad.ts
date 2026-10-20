import { Component, computed, input, output, signal } from '@angular/core'
import { NgIcon, provideIcons } from '@ng-icons/core'
import { lucideDelete } from '@ng-icons/lucide'

export const PIN_LENGTH = 6

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'] as const

/**
 * A 6-digit PIN typed on an on-screen 3×4 keypad, like a banking app, so the phone keyboard never
 * opens (offline-sync → Web screens). The sixth digit emits `completed`; the parent calls
 * `clear()` for the next try. A hardware keyboard works too (digits, Backspace).
 */
@Component({
  selector: 'app-pin-pad',
  imports: [NgIcon],
  providers: [provideIcons({ lucideDelete })],
  host: {
    class: 'flex flex-col items-center gap-8',
    '(document:keydown)': 'onKey($event)',
  },
  template: `
    <div class="flex gap-4" role="img" [attr.aria-label]="filledLabel()">
      @for (dot of dots; track dot) {
        <span
          class="size-3.5 rounded-full border-2 border-foreground transition-colors"
          [class.bg-foreground]="dot < digits().length"
          aria-hidden="true"
        ></span>
      }
    </div>
    <div class="grid grid-cols-3 gap-x-6 gap-y-3">
      @for (key of keys; track key) {
        <button
          type="button"
          class="flex size-16 items-center justify-center rounded-full bg-muted text-2xl font-medium tabular-nums transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none active:bg-border disabled:opacity-50"
          [disabled]="disabled()"
          (click)="press(key)"
        >
          {{ key }}
        </button>
      }
      <span aria-hidden="true"></span>
      <button
        type="button"
        class="flex size-16 items-center justify-center rounded-full bg-muted text-2xl font-medium tabular-nums transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none active:bg-border disabled:opacity-50"
        [disabled]="disabled()"
        (click)="press('0')"
      >
        0
      </button>
      <button
        type="button"
        class="flex size-16 items-center justify-center rounded-full text-2xl text-muted-foreground transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none active:bg-muted disabled:opacity-50"
        [attr.aria-label]="deleteLabel()"
        [disabled]="disabled() || digits().length === 0"
        (click)="backspace()"
      >
        <ng-icon name="lucideDelete" aria-hidden="true" />
      </button>
    </div>
  `,
})
export class PinPad {
  /** Read out with the count, e.g. "PIN, 2 of 6 digits entered" (translated by the parent). */
  filledLabel = input.required<string>()
  deleteLabel = input.required<string>()
  disabled = input(false)
  completed = output<string>()

  protected readonly keys = KEYS
  protected readonly dots = Array.from({ length: PIN_LENGTH }, (_, i) => i)
  protected digits = signal('')
  /** How many digits are in, for the parent's label. */
  length = computed(() => this.digits().length)

  clear(): void {
    this.digits.set('')
  }

  protected press(key: string): void {
    if (this.disabled() || this.digits().length >= PIN_LENGTH) {
      return
    }
    const next = this.digits() + key
    this.digits.set(next)
    if (next.length === PIN_LENGTH) {
      this.completed.emit(next)
    }
  }

  protected backspace(): void {
    if (!this.disabled()) {
      this.digits.update((digits) => digits.slice(0, -1))
    }
  }

  protected onKey(event: KeyboardEvent): void {
    if (event.ctrlKey || event.metaKey || event.altKey) {
      return
    }
    if (/^\d$/.test(event.key)) {
      event.preventDefault()
      this.press(event.key)
    } else if (event.key === 'Backspace') {
      event.preventDefault()
      this.backspace()
    }
  }
}
