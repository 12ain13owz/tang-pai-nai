import { Component, inject, model } from '@angular/core'
import { NonNullableFormBuilder, Validators } from '@angular/forms'
import type { AbstractControl, ValidationErrors } from '@angular/forms'
import { TranslocoPipe } from '@jsverse/transloco'
import { HlmButton } from '@spartan-ng/helm/button'
import { HlmDrawerImports } from '@spartan-ng/helm/drawer'
import { TransactionService } from '@/core/transaction'
import { FORM_IMPORTS, InputField } from '@/shared/components/form'
import { SheetFrame } from '@/shared/components/sheet'
import { addMonths, toDay } from '@/shared/utils'

/** "ดูตาม › กำหนดเอง": two dates, from ≤ to (transaction.md → Web screens). */
@Component({
  selector: 'app-custom-range-sheet',
  imports: [FORM_IMPORTS, TranslocoPipe, HlmButton, HlmDrawerImports, InputField, SheetFrame],
  template: `
    <hlm-drawer [state]="open() ? 'open' : 'closed'" (closed)="open.set(false)">
      <hlm-drawer-content
        *hlmDrawerPortal
        class="mx-auto h-[92dvh] w-full max-w-[480px] data-[vaul-drawer-direction=bottom]:max-h-[92dvh]"
      >
        <form [formGroup]="form" class="flex min-h-0 flex-1 flex-col" (ngSubmit)="apply()">
          <app-sheet-frame
            [title]="'transactions.customHeading' | transloco"
            [leadingLabel]="'sheet.close' | transloco"
            (leading)="open.set(false)"
          >
            <div class="flex flex-col gap-4">
              <app-input-field
                type="date"
                [control]="form.controls.from"
                [label]="'transactions.customFrom' | transloco"
              />
              <app-input-field
                type="date"
                [control]="form.controls.to"
                [label]="'transactions.customTo' | transloco"
              />
              @if (form.hasError('order')) {
                <p role="alert" class="-mt-2 text-sm text-destructive">
                  {{ 'transactions.customOrder' | transloco }}
                </p>
              }
            </div>
            <div sheetFooter class="pt-3">
              <button hlmBtn type="submit" class="h-11 w-full text-base">
                {{ 'transactions.customApply' | transloco }}
              </button>
            </div>
          </app-sheet-frame>
        </form>
      </hlm-drawer-content>
    </hlm-drawer>
  `,
})
export class CustomRangeSheet {
  private nnfb = inject(NonNullableFormBuilder)
  private transactionService = inject(TransactionService)

  open = model(false)

  protected form = this.nnfb.group(
    {
      from: [
        this.transactionService.custom().from ?? `${toDay().slice(0, 8)}01`,
        Validators.required,
      ],
      to: [this.transactionService.custom().to ?? addMonths(toDay(), 0), Validators.required],
    },
    {
      validators: (group: AbstractControl): ValidationErrors | null => {
        const { from, to } = group.value as { from?: string; to?: string }
        return from && to && from > to ? { order: true } : null
      },
    }
  )

  protected apply(): void {
    if (this.form.invalid) {
      return
    }
    const { from, to } = this.form.getRawValue()
    this.transactionService.selectCustom({ from, to })
    this.open.set(false)
  }
}
