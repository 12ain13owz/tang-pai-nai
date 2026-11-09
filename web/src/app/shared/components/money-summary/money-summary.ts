import { Component, input } from '@angular/core'
import { TranslocoPipe } from '@jsverse/transloco'

/** One currency's figures, already formatted (signed) for display. */
export interface MoneySummaryLine {
  income: string
  /** Whether there is any income: the amount takes the income colour only then. */
  hasIncome: boolean
  expense: string
  /** Income − expense. */
  net: string
  /** Transfers in − out; `null` hides the line (they cancel out). */
  transfer: string | null
  /** Debt entries in − out; `null` hides the line. */
  debt: string | null
}

/**
 * The period's summary card (transaction rule 11, DESIGN.md §6): income on the left, expense
 * right-aligned, net under a line, then the transfer and debt lines when they don't cancel out.
 * One card for the Transactions tab and a wallet shared with me, so the two never drift apart.
 */
@Component({
  selector: 'app-money-summary-card',
  imports: [TranslocoPipe],
  host: { class: 'block' },
  template: `
    <section
      class="grid grid-cols-2 gap-x-3 gap-y-2 rounded-xl border border-border bg-card px-4 py-3"
      [attr.aria-label]="'transactions.summary' | transloco"
    >
      <div class="flex flex-col">
        <span class="text-xs text-muted-foreground">{{ 'categories.income' | transloco }}</span>
        <span class="text-base font-semibold tabular-nums" [class.text-income]="line().hasIncome">
          {{ line().income }}
        </span>
      </div>
      <div class="flex flex-col items-end">
        <span class="text-xs text-muted-foreground">{{ 'categories.expense' | transloco }}</span>
        <span class="text-base font-semibold text-expense tabular-nums">{{ line().expense }}</span>
      </div>
      <div class="col-span-2 flex justify-between border-t border-border pt-2 text-sm">
        <span class="text-muted-foreground">{{ 'transactions.net' | transloco }}</span>
        <span class="font-semibold tabular-nums">{{ line().net }}</span>
      </div>
      @if (line().transfer; as transfer) {
        <div class="col-span-2 -mt-1 flex justify-between text-sm">
          <span class="text-muted-foreground">{{ 'transfers.summaryLine' | transloco }}</span>
          <span class="font-semibold tabular-nums">{{ transfer }}</span>
        </div>
      }
      @if (line().debt; as debt) {
        <div class="col-span-2 -mt-1 flex justify-between text-sm">
          <span class="text-muted-foreground">{{ 'debts.summaryLine' | transloco }}</span>
          <span class="font-semibold tabular-nums">{{ debt }}</span>
        </div>
      }
    </section>
  `,
})
export class MoneySummaryCard {
  line = input.required<MoneySummaryLine>()
}
