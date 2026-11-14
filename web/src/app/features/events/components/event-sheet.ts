import { Component, computed, effect, inject, signal, untracked } from '@angular/core'
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop'
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms'
import type { ValidatorFn } from '@angular/forms'
import { Router } from '@angular/router'
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco'
import { NgIcon, provideIcons } from '@ng-icons/core'
import { lucideCalendarCheck, lucidePlus, lucideTrash2, lucideX } from '@ng-icons/lucide'
import { toast } from '@spartan-ng/brain/sonner'
import { HlmButton } from '@spartan-ng/helm/button'
import { HlmDrawerImports } from '@spartan-ng/helm/drawer'
import {
  EVENT_DEFAULT_ICON,
  EVENT_ICONS,
  EVENT_LIMITS,
  EVENTS_ROUTE,
  EventService,
  toEvent,
} from '@/core/event'
import type { EventValues, TripEvent } from '@/core/event'
import { LanguageService } from '@/core/i18n'
import { NavHistory } from '@/core/routing'
import { TransactionService } from '@/core/transaction'
import { DateRow } from '@/shared/components/date-row'
import {
  ColorField,
  FORM_IMPORTS,
  IconField,
  NameIconField,
  withMessage,
} from '@/shared/components/form'
import { USER_COLORS } from '@/shared/components/icon-badge'
import { SheetFrame } from '@/shared/components/sheet'
import { Slide } from '@/shared/components/slide'
import { addDays } from '@/shared/utils'

type View = 'form' | 'icons' | 'confirmDelete'

/** Event rule 2: an end, when set, not before the start (reads the sibling: runs while built). */
const endAfterStart: ValidatorFn = (control) => {
  const start: unknown = control.parent?.get('startOn')?.value
  return typeof control.value === 'string' &&
    control.value &&
    typeof start === 'string' &&
    control.value < start
    ? { endBeforeStart: 'events.endBeforeStart' }
    : null
}

/**
 * The event form (docs/features/event.md → Web screens 3, mock-up frame 3): name with its icon
 * and colour, start (today by default) and an optional end; editing adds delete in the header,
 * which asks first (event rule 7).
 */
@Component({
  selector: 'app-event-sheet',
  imports: [
    FORM_IMPORTS,
    ReactiveFormsModule,
    TranslocoPipe,
    NgIcon,
    HlmButton,
    HlmDrawerImports,
    NameIconField,
    IconField,
    ColorField,
    SheetFrame,
    Slide,
    DateRow,
  ],
  providers: [provideIcons({ lucideCalendarCheck, lucidePlus, lucideTrash2, lucideX })],
  template: `
    @let f = form.controls;
    <hlm-drawer [state]="open() ? 'open' : 'closed'" (closed)="finish()">
      <hlm-drawer-content
        *hlmDrawerPortal
        class="mx-auto h-[92dvh] w-full max-w-[480px] overflow-x-clip data-[vaul-drawer-direction=bottom]:max-h-[92dvh]"
      >
        <div class="flex min-h-0 flex-1 flex-col" [appSlide]="depth()">
          @switch (view()) {
            @case ('form') {
              <form [formGroup]="form" class="flex min-h-0 flex-1 flex-col" (ngSubmit)="save()">
                <app-sheet-frame
                  [title]="heading() | transloco"
                  [leadingLabel]="'sheet.close' | transloco"
                  (leading)="finish()"
                >
                  @if (editing()) {
                    <div sheetActions class="flex">
                      <button
                        hlmBtn
                        variant="ghost"
                        size="icon"
                        type="button"
                        class="tpn-hit size-9 text-destructive"
                        [disabled]="!eventService.canWrite()"
                        [attr.aria-label]="'events.delete' | transloco"
                        (click)="view.set('confirmDelete')"
                      >
                        <ng-icon name="lucideTrash2" size="18" aria-hidden="true" />
                      </button>
                    </div>
                  }
                  <div class="flex flex-col gap-4">
                    @if (!eventService.canWrite()) {
                      <p class="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
                        {{
                          (eventService.serverDown()
                            ? 'sync.serverDownWrite'
                            : 'events.needsOnline'
                          ) | transloco
                        }}
                      </p>
                    }
                    <app-name-icon-field
                      [control]="f.name"
                      [label]="'events.name' | transloco"
                      [icon]="f.icon.value"
                      [color]="f.color.value"
                      [fallback]="defaultIcon"
                      [iconLabel]="'events.changeIcon' | transloco"
                      (iconClick)="view.set('icons')"
                    />
                    <div
                      class="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card"
                    >
                      <app-date-row
                        [today]="transactionService.today()"
                        [locale]="languageService.locale()"
                        [control]="f.startOn"
                        [value]="values().startOn ?? ''"
                        [label]="'events.start' | transloco"
                        [min]="firstDay"
                        [max]="lastDay()"
                      />
                      @if (values().endOn) {
                        <app-date-row
                          [today]="transactionService.today()"
                          [locale]="languageService.locale()"
                          [control]="f.endOn"
                          [value]="values().endOn ?? ''"
                          [label]="'events.end' | transloco"
                          [min]="values().startOn ?? firstDay"
                        />
                      } @else {
                        <button
                          type="button"
                          class="flex min-h-14 w-full items-center gap-3 px-4 py-2 text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset"
                          (click)="setEnd(values().startOn ?? '')"
                        >
                          <span class="flex w-10 shrink-0 justify-center text-muted-foreground">
                            <ng-icon name="lucideCalendarCheck" size="22" aria-hidden="true" />
                          </span>
                          <span class="flex min-w-0 flex-1 flex-col">
                            <span class="text-base">{{ 'events.end' | transloco }}</span>
                            <span class="text-sm text-muted-foreground">{{
                              'events.noEnd' | transloco
                            }}</span>
                          </span>
                          <ng-icon
                            name="lucidePlus"
                            size="20"
                            class="text-muted-foreground"
                            aria-hidden="true"
                          />
                        </button>
                      }
                    </div>
                    @if (values().endOn) {
                      <button
                        hlmBtn
                        variant="ghost"
                        type="button"
                        class="-mt-2 h-11 self-start px-2 text-sm text-muted-foreground"
                        (click)="setEnd('')"
                      >
                        <ng-icon name="lucideX" size="16" aria-hidden="true" />
                        {{ 'events.clearEnd' | transloco }}
                      </button>
                    }
                    @if (f.endOn.invalid) {
                      <p role="alert" class="-mt-2 px-1 text-sm text-destructive">
                        {{ 'events.endBeforeStart' | transloco }}
                      </p>
                    }
                    <p class="-mt-2 px-1 text-sm text-muted-foreground">
                      {{ 'events.defaultHint' | transloco }}
                    </p>
                    @if (atLimit()) {
                      <p class="px-1 text-sm text-destructive">{{ 'events.limit' | transloco }}</p>
                    }
                  </div>
                  <div sheetFooter class="pt-3">
                    <button
                      hlmBtn
                      type="submit"
                      class="h-11 w-full text-base"
                      [disabled]="!eventService.canWrite() || atLimit()"
                    >
                      {{ 'events.save' | transloco }}
                    </button>
                  </div>
                </app-sheet-frame>
              </form>
            }
            @case ('icons') {
              <app-sheet-frame
                [title]="'events.iconHeading' | transloco"
                leadingIcon="back"
                [leadingLabel]="'sheet.back' | transloco"
                (leading)="view.set('form')"
              >
                <div class="flex flex-col gap-4">
                  <app-color-field
                    [control]="f.color"
                    [label]="'events.color' | transloco"
                    [colors]="colors"
                  />
                  <app-icon-field
                    [control]="f.icon"
                    [label]="'events.icon' | transloco"
                    [icons]="icons"
                    [color]="f.color.value"
                  />
                </div>
              </app-sheet-frame>
            }
            @case ('confirmDelete') {
              <app-sheet-frame
                [title]="'events.deleteHeading' | transloco"
                leadingIcon="back"
                [leadingLabel]="'sheet.back' | transloco"
                (leading)="view.set('form')"
              >
                <div class="flex flex-col gap-3 text-sm text-muted-foreground">
                  <p class="text-base font-semibold text-foreground">
                    {{ 'events.deleteQuestion' | transloco: { name: f.name.value } }}
                  </p>
                  <p>
                    {{
                      (rowCount() === 1 ? 'events.deleteTextOne' : 'events.deleteText')
                        | transloco: { count: rowCount() }
                    }}
                  </p>
                </div>
                <div sheetFooter class="pt-3">
                  <button
                    hlmBtn
                    variant="destructive"
                    type="button"
                    class="h-11 w-full text-base"
                    [disabled]="!eventService.canWrite()"
                    (click)="remove()"
                  >
                    {{ 'events.delete' | transloco }}
                  </button>
                </div>
              </app-sheet-frame>
            }
          }
        </div>
      </hlm-drawer-content>
    </hlm-drawer>
  `,
})
export class EventSheet {
  private nnfb = inject(NonNullableFormBuilder)
  private transloco = inject(TranslocoService)
  private router = inject(Router)
  private navHistory = inject(NavHistory)
  protected eventService = inject(EventService)
  protected languageService = inject(LanguageService)
  protected transactionService = inject(TransactionService)

  protected defaultIcon = EVENT_DEFAULT_ICON
  protected icons = EVENT_ICONS
  protected colors = USER_COLORS
  protected firstDay = EVENT_LIMITS.FIRST_DAY
  protected state = this.eventService.sheet
  protected view = signal<View>('form')
  /** How deep the view is: a deeper one slides in from the right, going back from the left. */
  protected depth = computed(() => (this.view() === 'form' ? 0 : 1))
  protected open = signal(false)

  form = this.nnfb.group({
    name: [
      '',
      [
        withMessage(Validators.required, 'events.nameRequired'),
        Validators.maxLength(EVENT_LIMITS.NAME_MAX),
      ],
    ],
    icon: [EVENT_DEFAULT_ICON as string],
    color: [USER_COLORS[0] as string],
    startOn: [this.transactionService.today()],
    endOn: ['', [endAfterStart]],
  })
  protected values = toSignal(this.form.valueChanges, { initialValue: this.form.getRawValue() })
  protected lastDay = computed(() => addDays(this.transactionService.today(), 365))

  protected editing = computed(() => {
    const state = this.state()
    return state?.mode === 'edit' ? state.id : null
  })
  protected heading = computed(() => {
    switch (this.state()?.mode) {
      case 'edit':
        return 'events.editHeading'
      case 'fix':
        return 'events.fixHeading'
      default:
        return 'events.createHeading'
    }
  })
  /** Event rule 1: a new open event over the limit (an edit already counts). */
  protected atLimit = computed(() => this.state()?.mode === 'create' && this.eventService.atLimit())
  protected rowCount = computed(() => {
    const id = this.editing()
    return id ? this.eventService.rowCount(id) : 0
  })

  constructor() {
    this.form.controls.startOn.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.form.controls.endOn.updateValueAndValidity({ emitEvent: false }))
    effect(() => {
      const state = this.state()
      untracked(() => {
        if (state) {
          this.start()
        }
        this.open.set(state !== null)
      })
    })
  }

  protected setEnd(day: string): void {
    this.form.controls.endOn.setValue(day)
    this.form.controls.endOn.markAsDirty()
  }

  protected save(): void {
    const state = this.state()
    if (!state || this.form.invalid || !this.eventService.canWrite() || this.atLimit()) {
      return
    }
    const value = this.form.getRawValue()
    const values: EventValues = {
      name: value.name,
      icon: value.icon,
      color: value.color,
      startOn: value.startOn,
      endOn: value.endOn || null,
    }
    if (state.mode === 'fix') {
      this.eventService.save(state.id, values, state.opId)
    } else {
      this.eventService.save(state.mode === 'edit' ? state.id : null, values)
    }
    toast.success(
      this.transloco.translate(state.mode === 'create' ? 'events.created' : 'events.saved')
    )
    this.finish()
  }

  /** Event rule 7: the event goes, its rows stay untagged. */
  protected remove(): void {
    const id = this.editing()
    if (!id) {
      return
    }
    this.eventService.remove(id)
    toast(this.transloco.translate('events.deleted'))
    this.finish()
    // Off the deleted event's page, back where it was opened from (NavHistory).
    if (this.router.url.startsWith(`${EVENTS_ROUTE}/`)) {
      this.navHistory.back()
    }
  }

  /** Saved, deleted, ✕, a swipe down, the backdrop or Escape: unsaved input goes (DESIGN.md §6). */
  protected finish(): void {
    this.form.markAsPristine()
    this.state.set(null)
  }

  private start(): void {
    const state = this.state()
    this.view.set('form')
    if (!state) {
      return
    }
    if (state.mode === 'create') {
      this.form.reset({
        name: '',
        icon: EVENT_DEFAULT_ICON,
        color: USER_COLORS[0],
        startOn: this.transactionService.today(),
        endOn: '',
      })
      return
    }
    const refused = state.mode === 'fix' ? this.eventService.refused(state.opId) : null
    const event: TripEvent | null =
      state.mode === 'edit' ? this.eventService.byId(state.id) : refused ? toEvent(refused) : null
    if (!event) {
      this.state.set(null)
      return
    }
    this.form.reset({
      name: event.name,
      icon: event.icon,
      color: event.color,
      startOn: event.startOn,
      endOn: event.endOn ?? '',
    })
    if (refused) {
      this.form.markAllAsTouched()
      this.form.markAsDirty()
    }
  }
}
