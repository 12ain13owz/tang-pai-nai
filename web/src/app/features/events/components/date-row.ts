import { Component, computed, inject, input } from '@angular/core'
import type { FormControl } from '@angular/forms'
import { ReactiveFormsModule } from '@angular/forms'
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco'
import { NgIcon, provideIcons } from '@ng-icons/core'
import { lucideCalendar, lucideChevronLeft, lucideChevronRight } from '@ng-icons/lucide'
import { HlmButton } from '@spartan-ng/helm/button'
import { LanguageService } from '@/core/i18n'
import { TransactionService } from '@/core/transaction'
import { addDays, fromDay } from '@/shared/utils'

/**
 * A date row of the event sheet (a copy of the debts one: features don't share internals), like the transaction form's (DESIGN.md §6): ‹ › a day, the middle
 * opens the native date picker. `label` reads over the date ("วันเริ่ม", "วันจบ").
 */
@Component({
  selector: 'app-event-date-row',
  imports: [ReactiveFormsModule, TranslocoPipe, NgIcon, HlmButton],
  providers: [provideIcons({ lucideCalendar, lucideChevronLeft, lucideChevronRight })],
  template: `
    <div class="flex min-h-14 items-center gap-2 px-4 py-2">
      <span class="flex w-10 shrink-0 justify-center text-muted-foreground">
        <ng-icon name="lucideCalendar" size="22" aria-hidden="true" />
      </span>
      <button
        hlmBtn
        variant="outline"
        size="icon"
        type="button"
        class="size-10 shrink-0"
        [disabled]="day() <= min()"
        [attr.aria-label]="'transactions.dayBefore' | transloco"
        (click)="move(-1)"
      >
        <ng-icon name="lucideChevronLeft" size="20" aria-hidden="true" />
      </button>
      <label
        class="relative flex h-10 min-w-0 flex-1 items-center justify-center rounded-md text-base font-medium has-focus-visible:ring-2 has-focus-visible:ring-ring"
      >
        <span class="flex min-w-0 flex-col items-center leading-tight">
          @if (label()) {
            <span class="text-xs text-muted-foreground">{{ label() }}</span>
          }
          <span class="truncate">{{ text() }}</span>
        </span>
        <input
          type="date"
          class="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          [attr.aria-label]="label() || ('transactions.date' | transloco)"
          [min]="min()"
          [max]="max()"
          [formControl]="control()"
        />
      </label>
      <button
        hlmBtn
        variant="outline"
        size="icon"
        type="button"
        class="size-10 shrink-0"
        [disabled]="day() >= max()"
        [attr.aria-label]="'transactions.dayAfter' | transloco"
        (click)="move(1)"
      >
        <ng-icon name="lucideChevronRight" size="20" aria-hidden="true" />
      </button>
    </div>
  `,
})
export class EventDateRow {
  private languageService = inject(LanguageService)
  private transactionService = inject(TransactionService)
  private transloco = inject(TranslocoService)

  control = input.required<FormControl<string>>()
  /** The control's value (the parent's form signal: a control's own value isn't a signal). */
  value = input.required<string>()
  label = input('')
  min = input('2000-01-01')
  max = input('2099-12-31')

  protected day = computed(() => this.value() || this.transactionService.today())
  protected text = computed(() => {
    this.languageService.language()
    const day = this.day()
    const today = this.transactionService.today()
    const locale = this.languageService.locale()
    const date = new Intl.DateTimeFormat(locale, {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }).format(fromDay(day))
    const relative =
      day === today
        ? 'transactions.today'
        : day === addDays(today, -1)
          ? 'transactions.yesterday'
          : day === addDays(today, 1)
            ? 'transactions.tomorrow'
            : null
    const lead = relative
      ? this.transloco.translate(relative)
      : new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(fromDay(day))
    return `${lead} · ${date}`
  })

  protected move(days: number): void {
    const next = addDays(this.day(), days)
    if (next >= this.min() && next <= this.max()) {
      this.control().setValue(next)
      this.control().markAsDirty()
    }
  }
}
