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
 * The label is for screen readers; project the currency after the input (`amountSuffix`).
 * The text stays a string; the form converts it to minor units (`@/shared/utils` → `parseMajor`).
 */
@Component({
  selector: 'app-amount-field',
  imports: [ReactiveFormsModule, TranslocoPipe, NgIcon, HlmButton, HlmFieldImports, HlmInput],
  providers: [provideIcons({ lucideMinus, lucidePlus })],
  template: `
    <div hlmField>
      <label class="sr-only" [for]="inputId">{{ label() }}</label>
      <div class="flex items-center gap-3">
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
          class="h-12 min-w-0 flex-1 rounded-none border-0 border-b bg-transparent px-0 text-right text-2xl font-semibold tabular-nums shadow-none focus-visible:ring-0 data-[matches-spartan-invalid=true]:ring-0 md:text-2xl dark:bg-transparent"
          inputmode="decimal"
          autocomplete="off"
          [id]="inputId"
          [formControl]="control()"
          [placeholder]="placeholder()"
        />
        <ng-content select="[amountSuffix]" />
      </div>
      <hlm-field-error class="-mt-2 pl-14">{{ error() }}</hlm-field-error>
    </div>
  `,
})
export class AmountField {
  control = input.required<FormControl<string>>()
  /** True when the amount is below zero. */
  negative = input.required<FormControl<boolean>>()
  label = input.required<string>()
  placeholder = input('0')

  protected inputId = `amount-field-${nextId++}`
  private field = viewChild.required(BrnField)
  protected error = fieldErrorMessage(this.field)

  protected flip(): void {
    const negative = this.negative()
    negative.setValue(!negative.value)
    negative.markAsDirty()
  }
}
