import { Component, input, output, signal, viewChild } from '@angular/core'
import { TranslocoPipe } from '@jsverse/transloco'
import { PinPad } from './pin-pad'

/**
 * Choosing a PIN: type it, then type it again (offline-sync rule 1). Emits `chosen` once both
 * match; a mismatch starts over with one error line.
 */
@Component({
  selector: 'app-pin-setup',
  imports: [TranslocoPipe, PinPad],
  host: { class: 'flex flex-col items-center gap-6' },
  template: `
    <div class="flex flex-col items-center gap-2 text-center">
      <h2 class="text-xl font-semibold">
        {{ (first() === null ? newHeading() : 'pin.confirmHeading') | transloco }}
      </h2>
      <p class="text-sm text-muted-foreground">
        {{ (first() === null ? 'pin.newHint' : 'pin.confirmHint') | transloco }}
      </p>
    </div>
    <p role="alert" class="min-h-5 text-center text-sm text-destructive">
      @if (mismatch()) {
        {{ 'pin.mismatch' | transloco }}
      }
    </p>
    <app-pin-pad
      #pad
      [filledLabel]="'pin.filled' | transloco: { count: pad.length() }"
      [deleteLabel]="'pin.delete' | transloco"
      [disabled]="isProcessing()"
      (completed)="onCompleted($event)"
    />
  `,
})
export class PinSetup {
  isProcessing = input(false)
  /** Translation key of the first step's heading. */
  newHeading = input('pin.newHeading')
  chosen = output<string>()

  private pad = viewChild.required(PinPad)
  protected first = signal<string | null>(null)
  protected mismatch = signal(false)

  /** Back to the first entry (e.g. after the parent failed to save). */
  reset(): void {
    this.first.set(null)
    this.pad().clear()
  }

  protected onCompleted(pin: string): void {
    const first = this.first()
    this.pad().clear()
    if (first === null) {
      this.first.set(pin)
      this.mismatch.set(false)
      return
    }
    if (first !== pin) {
      this.first.set(null)
      this.mismatch.set(true)
      return
    }
    this.chosen.emit(pin)
  }
}
