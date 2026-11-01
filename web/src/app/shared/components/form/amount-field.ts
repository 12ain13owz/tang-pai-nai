import { Component, input, viewChild } from '@angular/core'
import { ReactiveFormsModule } from '@angular/forms'
import type { FormControl } from '@angular/forms'
import { TranslocoPipe } from '@jsverse/transloco'
import { NgIcon, provideIcons } from '@ng-icons/core'
import { lucideMinus, lucidePlus } from '@ng-icons/lucide'
import { BrnField } from '@spartan-ng/brain/field'
import { HlmButton } from '@spartan-ng/helm/button'
import { HlmFieldImports } from '@spartan-ng/helm/field'
import { HlmInput } from '@spartan-ng/helm/input'
import { fieldErrorMessage } from './field-error'

let nextId = 0

/**
 * A money amount typed in the currency's major unit (`inputmode="decimal"`), with a +/− button on
 * its left that flips the sign, because phone decimal keypads have no minus key (wallet rule 5).
 * The text stays a string; the form converts it to minor units (`@/shared/utils` → `parseMajor`).
 */
@Component({
  selector: 'app-amount-field',
  imports: [ReactiveFormsModule, TranslocoPipe, NgIcon, HlmButton, HlmFieldImports, HlmInput],
  providers: [provideIcons({ lucideMinus, lucidePlus })],
  template: `
    <div hlmField>
      <label hlmFieldLabel [for]="inputId">{{ label() }}</label>
      <div class="flex items-center gap-2">
        <button
          hlmBtn
          variant="outline"
          size="icon"
          type="button"
          class="size-11 shrink-0"
          [class.text-expense]="negative().value"
          [attr.aria-pressed]="negative().value"
          [attr.aria-label]="'form.negativeAmount' | transloco"
          [disabled]="negative().disabled"
          (click)="flip()"
        >
          <ng-icon [name]="negative().value ? 'lucideMinus' : 'lucidePlus'" size="20" />
        </button>
        <input
          hlmInput
          class="min-w-0 flex-1 text-right tabular-nums"
          inputmode="decimal"
          autocomplete="off"
          [id]="inputId"
          [formControl]="control()"
          [placeholder]="placeholder()"
        />
        @if (suffix()) {
          <span class="shrink-0 text-sm text-muted-foreground">{{ suffix() }}</span>
        }
      </div>
      @if (hint()) {
        <p hlmFieldDescription class="-mt-2">{{ hint() }}</p>
      }
      <hlm-field-error class="-mt-2">{{ error() }}</hlm-field-error>
    </div>
  `,
})
export class AmountField {
  control = input.required<FormControl<string>>()
  /** True when the amount is below zero. */
  negative = input.required<FormControl<boolean>>()
  label = input.required<string>()
  /** Shown after the input, e.g. the currency code. */
  suffix = input('')
  placeholder = input('0')
  hint = input('')

  protected inputId = `amount-field-${nextId++}`
  private field = viewChild.required(BrnField)
  protected error = fieldErrorMessage(this.field)

  protected flip(): void {
    const negative = this.negative()
    negative.setValue(!negative.value)
    negative.markAsDirty()
  }
}
