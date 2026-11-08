import { Component, computed, inject, input, model } from '@angular/core'
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco'
import { NgIcon, provideIcons } from '@ng-icons/core'
import { lucideMinus, lucidePlus } from '@ng-icons/lucide'
import { HlmButton } from '@spartan-ng/helm/button'
import { LanguageService } from '@/core/i18n'
import {
  lastLine,
  MONTHLY,
  RECURRING_FREQUENCIES,
  RECURRING_LIMITS,
  shortDate,
  shortMonthLine,
} from '@/core/recurring'
import type { RecurringFrequency, RepeatValues } from '@/core/recurring'
import { addMonths, fromDay } from '@/shared/utils'

type Choice = 'none' | RecurringFrequency | 'custom'
type End = 'never' | 'on' | 'count'

/**
 * The "ทำซ้ำ" view of the transaction and transfer sheets (docs/features/recurring.md → Web
 * screens, mock-up frames 2 and 4): the presets named after the form's date, "every n units",
 * the end (never / a date / a count) and whether a due one is recorded by itself or asked first.
 * Every change goes straight to `value` (null: don't repeat); the sheet's ‹ goes back.
 */
@Component({
  selector: 'app-repeat-view',
  imports: [TranslocoPipe, NgIcon, HlmButton],
  providers: [provideIcons({ lucideMinus, lucidePlus })],
  host: { class: 'flex flex-col gap-4' },
  template: `
    <fieldset class="rounded-2xl border border-border bg-card">
      <legend class="sr-only">{{ 'recurring.repeat' | transloco }}</legend>
      @for (option of options(); track option.id) {
        <label
          class="flex min-h-14 items-center gap-3 border-border px-4 py-2 has-focus-visible:ring-2 has-focus-visible:ring-ring has-focus-visible:ring-inset [&:not(:first-of-type)]:border-t"
        >
          <span class="flex min-w-0 flex-1 flex-col">
            <span class="text-base">{{ option.label }}</span>
            @if (option.hint) {
              <span class="text-sm text-muted-foreground">{{ option.hint }}</span>
            }
          </span>
          <input
            type="radio"
            name="repeat-choice"
            class="size-5 accent-brand"
            [checked]="choice() === option.id"
            (change)="choose(option.id)"
          />
        </label>
      }
      <div class="flex flex-col gap-2 border-t border-border px-4 py-3">
        <label class="flex items-center gap-3">
          <span class="flex-1 text-base">{{ 'recurring.custom' | transloco }}</span>
          <input
            type="radio"
            name="repeat-choice"
            class="size-5 accent-brand"
            [checked]="choice() === 'custom'"
            (change)="choose('custom')"
          />
        </label>
        @if (choice() === 'custom') {
          <div class="flex flex-wrap items-center gap-2">
            <span class="flex items-center gap-1">
              <button
                hlmBtn
                variant="outline"
                size="icon"
                type="button"
                class="size-9"
                [disabled]="interval() <= 2"
                [attr.aria-label]="'recurring.less' | transloco"
                (click)="setInterval(interval() - 1)"
              >
                <ng-icon name="lucideMinus" size="16" aria-hidden="true" />
              </button>
              <span
                class="min-w-9 text-center text-base font-semibold tabular-nums"
                aria-live="polite"
              >
                {{ interval() }}
              </span>
              <button
                hlmBtn
                variant="outline"
                size="icon"
                type="button"
                class="size-9"
                [disabled]="interval() >= intervalMax"
                [attr.aria-label]="'recurring.more' | transloco"
                (click)="setInterval(interval() + 1)"
              >
                <ng-icon name="lucidePlus" size="16" aria-hidden="true" />
              </button>
            </span>
            <span
              class="flex flex-wrap gap-1"
              role="radiogroup"
              [attr.aria-label]="'recurring.repeat' | transloco"
            >
              @for (unit of units; track unit) {
                <button
                  type="button"
                  role="radio"
                  class="min-h-9 rounded-full px-3 text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  [class.bg-brand]="frequency() === unit"
                  [class.text-background]="frequency() === unit"
                  [class.font-semibold]="frequency() === unit"
                  [class.bg-muted]="frequency() !== unit"
                  [class.text-muted-foreground]="frequency() !== unit"
                  [attr.aria-checked]="frequency() === unit"
                  (click)="setFrequency(unit)"
                >
                  {{ 'recurring.unit.' + unit | transloco }}
                </button>
              }
            </span>
          </div>
        }
      </div>
    </fieldset>
    @if (value(); as repeat) {
      @if (shortMonth(); as line) {
        <p class="-mt-2 px-1 text-sm text-muted-foreground">{{ line }}</p>
      }
      <fieldset class="flex flex-col gap-2">
        <legend class="mb-2 px-1 text-sm font-medium text-muted-foreground">
          {{ 'recurring.end' | transloco }}
        </legend>
        <div class="rounded-2xl border border-border bg-card">
          <label
            class="flex min-h-14 items-center gap-3 px-4 py-2 has-focus-visible:ring-2 has-focus-visible:ring-ring has-focus-visible:ring-inset"
          >
            <span class="flex-1 text-base">{{ 'recurring.endNever' | transloco }}</span>
            <input
              type="radio"
              name="repeat-end"
              class="size-5 accent-brand"
              [checked]="end() === 'never'"
              (change)="setEnd('never')"
            />
          </label>
          <label
            class="flex min-h-14 items-center gap-3 border-t border-border px-4 py-2 has-focus-visible:ring-2 has-focus-visible:ring-ring has-focus-visible:ring-inset"
          >
            <span class="flex min-w-0 flex-1 flex-col">
              <span class="text-base">{{ 'recurring.endOn' | transloco }}</span>
              @if (repeat.endOn) {
                <span class="text-sm text-muted-foreground">{{ endOnText() }}</span>
              }
            </span>
            <input
              type="radio"
              name="repeat-end"
              class="size-5 accent-brand"
              [checked]="end() === 'on'"
              (change)="setEnd('on')"
            />
          </label>
          @if (end() === 'on') {
            <div class="px-4 pb-3">
              <input
                type="date"
                class="h-10 w-full rounded-md border border-border bg-background px-3 text-base"
                [attr.aria-label]="'recurring.endOn' | transloco"
                [min]="startOn()"
                [value]="repeat.endOn ?? ''"
                (change)="setEndOn($event)"
              />
            </div>
          }
          <label
            class="flex min-h-14 items-center gap-3 border-t border-border px-4 py-2 has-focus-visible:ring-2 has-focus-visible:ring-ring has-focus-visible:ring-inset"
          >
            <span class="flex min-w-0 flex-1 flex-col">
              <span class="text-base">
                {{ 'recurring.endCount' | transloco: { n: repeat.endCount ?? 12 } }}
              </span>
              @if (last(); as line) {
                <span class="text-sm text-muted-foreground">{{ line }}</span>
              }
            </span>
            <input
              type="radio"
              name="repeat-end"
              class="size-5 accent-brand"
              [checked]="end() === 'count'"
              (change)="setEnd('count')"
            />
          </label>
          @if (end() === 'count') {
            <div class="flex items-center gap-2 px-4 pb-3">
              <span class="flex-1 text-sm text-muted-foreground">
                {{ 'recurring.endCountLabel' | transloco }}
              </span>
              <button
                hlmBtn
                variant="outline"
                size="icon"
                type="button"
                class="size-9"
                [disabled]="(repeat.endCount ?? 1) <= 1"
                [attr.aria-label]="'recurring.less' | transloco"
                (click)="setCount((repeat.endCount ?? 1) - 1)"
              >
                <ng-icon name="lucideMinus" size="16" aria-hidden="true" />
              </button>
              <span
                class="min-w-9 text-center text-base font-semibold tabular-nums"
                aria-live="polite"
              >
                {{ repeat.endCount }}
              </span>
              <button
                hlmBtn
                variant="outline"
                size="icon"
                type="button"
                class="size-9"
                [disabled]="(repeat.endCount ?? 1) >= countMax"
                [attr.aria-label]="'recurring.more' | transloco"
                (click)="setCount((repeat.endCount ?? 1) + 1)"
              >
                <ng-icon name="lucidePlus" size="16" aria-hidden="true" />
              </button>
            </div>
          }
        </div>
      </fieldset>
      <fieldset class="flex flex-col gap-2">
        <legend class="mb-2 px-1 text-sm font-medium text-muted-foreground">
          {{ 'recurring.when' | transloco }}
        </legend>
        <div class="rounded-2xl border border-border bg-card">
          @for (ask of [false, true]; track ask) {
            <label
              class="flex min-h-14 items-center gap-3 border-border px-4 py-2 has-focus-visible:ring-2 has-focus-visible:ring-ring has-focus-visible:ring-inset"
              [class.border-t]="ask"
            >
              <span class="flex min-w-0 flex-1 flex-col">
                <span class="text-base">{{
                  (ask ? 'recurring.ask' : 'recurring.auto') | transloco
                }}</span>
                <span class="text-sm text-muted-foreground">
                  {{ (ask ? 'recurring.askHint' : 'recurring.autoHint') | transloco }}
                </span>
              </span>
              <input
                type="radio"
                name="repeat-when"
                class="size-5 accent-brand"
                [checked]="repeat.confirm === ask"
                (change)="update({ confirm: ask })"
              />
            </label>
          }
        </div>
      </fieldset>
    }
  `,
})
export class RepeatView {
  private transloco = inject(TranslocoService)
  private languageService = inject(LanguageService)

  /** The form's date: the presets are named after it, and the rule starts on it. */
  startOn = input.required<string>()
  value = model<RepeatValues | null>(null)

  protected units = RECURRING_FREQUENCIES
  protected intervalMax = RECURRING_LIMITS.INTERVAL_MAX
  protected countMax = RECURRING_LIMITS.COUNT_MAX
  protected interval = computed(() => this.value()?.interval ?? 2)
  protected frequency = computed(() => this.value()?.frequency ?? 'month')
  protected choice = computed<Choice>(() => {
    const value = this.value()
    if (!value) {
      return 'none'
    }
    return value.interval === 1 ? value.frequency : 'custom'
  })
  protected end = computed<End>(() => {
    const value = this.value()
    return (value?.endCount ?? null) !== null
      ? 'count'
      : (value?.endOn ?? null) !== null
        ? 'on'
        : 'never'
  })

  protected options = computed(() => {
    this.languageService.language()
    const locale = this.languageService.locale()
    const t = (key: string, params?: Record<string, unknown>) =>
      this.transloco.translate(key, params)
    const start = this.startOn()
    const date = fromDay(start)
    const params = {
      weekday: new Intl.DateTimeFormat(locale, { weekday: 'long' }).format(date),
      day: date.getDate(),
      date: shortDate(start, locale, false),
    }
    const hint = (frequency: RecurringFrequency) =>
      frequency === 'day' ? '' : t(`recurring.hint.${frequency}`, params)
    return [
      { id: 'none' as const, label: t('recurring.none'), hint: '' },
      ...RECURRING_FREQUENCIES.map((frequency) => ({
        id: frequency,
        label: t(`recurring.preset.${frequency}`),
        hint: hint(frequency),
      })),
    ]
  })
  protected shortMonth = computed(() => {
    this.languageService.language()
    const value = this.value()
    return value
      ? shortMonthLine(
          value,
          this.startOn(),
          (key, params) => this.transloco.translate(key, params),
          this.languageService.locale()
        )
      : null
  })
  protected last = computed(() => {
    this.languageService.language()
    const value = this.value()
    return value
      ? lastLine(
          { ...value, startOn: this.startOn() },
          (key, params) => this.transloco.translate(key, params),
          this.languageService.locale()
        )
      : null
  })
  protected endOnText = computed(() => {
    const endOn = this.value()?.endOn
    return endOn ? shortDate(endOn, this.languageService.locale()) : ''
  })

  protected choose(choice: Choice): void {
    if (choice === 'none') {
      this.value.set(null)
      return
    }
    const current = this.value() ?? MONTHLY
    if (choice === 'custom') {
      this.value.set({ ...current, interval: Math.max(2, current.interval) })
      return
    }
    this.value.set({ ...current, frequency: choice, interval: 1 })
  }

  protected setInterval(interval: number): void {
    this.update({ interval: Math.min(this.intervalMax, Math.max(2, interval)) })
  }

  protected setFrequency(frequency: RecurringFrequency): void {
    this.update({ frequency })
  }

  protected setEnd(end: End): void {
    const current = this.value()
    if (!current) {
      return
    }
    this.value.set({
      ...current,
      endOn: end === 'on' ? (current.endOn ?? addMonths(this.startOn(), 12)) : null,
      endCount: end === 'count' ? (current.endCount ?? 12) : null,
    })
  }

  protected setEndOn(event: Event): void {
    const day = (event.target as HTMLInputElement).value
    if (day && day >= this.startOn()) {
      this.update({ endOn: day, endCount: null })
    }
  }

  protected setCount(count: number): void {
    this.update({ endCount: Math.min(this.countMax, Math.max(1, count)), endOn: null })
  }

  protected update(changes: Partial<RepeatValues>): void {
    const current = this.value()
    if (current) {
      this.value.set({ ...current, ...changes })
    }
  }
}
