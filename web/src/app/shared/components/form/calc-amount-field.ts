import { Component, computed, inject, input, output } from '@angular/core'
import { toObservable, toSignal } from '@angular/core/rxjs-interop'
import type { FormControl } from '@angular/forms'
import { map, startWith, switchMap } from 'rxjs'
import { TranslocoService } from '@jsverse/transloco'
import { evaluate, formatAmount, groupExpression, hasOperator } from '@/shared/utils'
import { firstErrorMessage } from './field-error'

/**
 * The transaction form's amount row (transaction.md → Web screens): the currency code, the
 * expression typed on `app-calc-keypad` in large figures (grouped in thousands for display) and, while it holds an operator, its
 * result. The control holds the expression text (`120+65`); the form works it out with
 * `evaluate`. Tapping the row asks for the keypad (`activate`); the phone keyboard never opens.
 */
@Component({
  selector: 'app-calc-amount-field',
  host: { class: 'block' },
  template: `
    <button
      type="button"
      class="flex min-h-19 w-full items-end gap-3 py-2 text-left focus-visible:outline-none"
      [class.shadow-[inset_0_-2px_0_var(--brand)]]="active()"
      [attr.aria-label]="label() + ' ' + spoken()"
      [attr.aria-expanded]="active()"
      (click)="activate.emit()"
    >
      <span
        class="mb-1.5 flex w-10 shrink-0 justify-center rounded-md border border-input py-0.5 text-xs text-muted-foreground"
        aria-hidden="true"
      >
        {{ currencyCode() }}
      </span>
      <span class="flex min-w-0 flex-1 flex-col" aria-hidden="true">
        <span class="text-xs text-muted-foreground">{{ label() }}</span>
        <span class="truncate text-3xl font-semibold tabular-nums">{{ shown() }}</span>
        @if (preview(); as text) {
          <span class="text-sm text-muted-foreground tabular-nums">= {{ text }}</span>
        }
      </span>
    </button>
    @if (error()) {
      <p role="alert" class="pb-2 pl-13 text-sm text-destructive">{{ error() }}</p>
    }
  `,
})
export class CalcAmountField {
  private transloco = inject(TranslocoService)

  control = input.required<FormControl<string>>()
  label = input.required<string>()
  currencyCode = input.required<string>()
  minorUnit = input(2)
  locale = input('th-TH')
  /** The keypad is open for this row. */
  active = input(false)
  activate = output()

  /** The control's value and touched state, followed through every control event. */
  private state = toSignal(
    toObservable(this.control).pipe(
      switchMap((control) =>
        control.events.pipe(
          startWith(null),
          map(() => ({ value: control.value, touched: control.touched }))
        )
      )
    ),
    { initialValue: { value: '', touched: false } }
  )
  private value = computed(() => this.state().value)
  /** The expression grouped in thousands (`8,500`); the control keeps `8500`. */
  protected shown = computed(() => {
    const text = groupExpression(this.value(), this.locale()).replace(/-/g, '−')
    return text === '' ? '0' : text
  })
  protected preview = computed(() => {
    const text = this.value()
    if (!hasOperator(text)) {
      return null
    }
    const result = evaluate(text, this.minorUnit())
    return result.ok ? formatAmount(result.minor, this.minorUnit(), this.locale()) : null
  })
  protected spoken = computed(() => this.preview() ?? this.shown())
  protected error = computed(() =>
    this.state().touched
      ? firstErrorMessage(this.control().errors, (key, params) =>
          this.transloco.translate(key, params)
        )
      : ''
  )
}
