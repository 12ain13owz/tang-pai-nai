import { Component, computed, inject, signal } from '@angular/core'
import { takeUntilDestroyed } from '@angular/core/rxjs-interop'
import { ActivatedRoute, Router, RouterLink } from '@angular/router'
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco'
import { NgIcon, provideIcons } from '@ng-icons/core'
import { lucideChevronDown, lucideChevronRight, lucidePlane } from '@ng-icons/lucide'
import { HlmButton } from '@spartan-ng/helm/button'
import { EVENT_DEFAULT_ICON, EVENTS_ROUTE, EventService } from '@/core/event'
import { LanguageService } from '@/core/i18n'
import { EventSheet } from '@/features/events/components/event-sheet'
import { eventRow } from '@/features/events/event-view'
import { EmptyState } from '@/shared/components/empty-state'
import { IconBadge } from '@/shared/components/icon-badge'

/**
 * อีเวนต์ / ทริป (docs/features/event.md → Web screens 1, mock-up frame 1): open events by start
 * date ("กำลังใช้" while today is in their dates), "จบแล้ว (n)" folded, and "เพิ่มอีเวนต์".
 */
@Component({
  selector: 'app-events-page',
  imports: [TranslocoPipe, NgIcon, HlmButton, RouterLink, EmptyState, IconBadge, EventSheet],
  providers: [provideIcons({ lucideChevronDown, lucideChevronRight, lucidePlane })],
  template: `
    <div class="flex flex-col gap-4 p-4">
      @if (open().length === 0 && closed().length === 0) {
        <app-empty-state
          [heading]="'events.emptyHeading' | transloco"
          [description]="'events.emptyText' | transloco"
        >
          <ng-icon name="lucidePlane" />
        </app-empty-state>
      }
      @if (open().length > 0) {
        <h2 class="px-1 text-sm font-medium text-muted-foreground">
          {{ 'events.openGroup' | transloco: { count: open().length } }}
        </h2>
        <ul class="-mt-2 divide-y divide-border rounded-2xl border border-border bg-card">
          @for (row of open(); track row.item.event.id) {
            <li>
              <a
                class="flex min-h-16 items-center gap-3 px-4 py-2.5 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset"
                [routerLink]="[route, row.item.event.id]"
              >
                <app-icon-badge
                  [icon]="row.item.event.icon"
                  [color]="row.item.event.color"
                  [fallback]="eventIcon"
                />
                <span class="flex min-w-0 flex-1 flex-col">
                  <span class="flex min-w-0 items-center gap-1.5">
                    <span class="truncate text-base font-semibold">{{ row.item.event.name }}</span>
                    @if (row.item.current) {
                      <span
                        class="shrink-0 rounded-md bg-brand/10 px-1.5 text-xs font-semibold text-brand"
                        >{{ 'events.current' | transloco }}</span
                      >
                    }
                  </span>
                  <span class="truncate text-sm text-muted-foreground">{{ row.dates }}</span>
                </span>
                <span class="flex shrink-0 flex-col items-end">
                  <span class="text-base font-semibold text-expense tabular-nums">{{
                    row.expense
                  }}</span>
                  <span class="text-xs text-muted-foreground">{{ row.count }}</span>
                </span>
                <ng-icon
                  name="lucideChevronRight"
                  size="16"
                  class="shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
              </a>
            </li>
          }
        </ul>
      }
      @if (closed().length > 0) {
        <button
          type="button"
          class="flex min-h-11 items-center justify-between px-1 text-sm font-medium text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          [attr.aria-expanded]="showClosed()"
          (click)="showClosed.set(!showClosed())"
        >
          {{ 'events.closedGroup' | transloco: { count: closed().length } }}
          <ng-icon
            name="lucideChevronDown"
            size="16"
            [class.rotate-180]="showClosed()"
            aria-hidden="true"
          />
        </button>
        @if (showClosed()) {
          <ul class="-mt-2 divide-y divide-border rounded-2xl border border-border bg-card">
            @for (row of closed(); track row.item.event.id) {
              <li>
                <a
                  class="flex min-h-16 items-center gap-3 px-4 py-2.5 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset"
                  [routerLink]="[route, row.item.event.id]"
                >
                  <app-icon-badge
                    class="opacity-65"
                    [icon]="row.item.event.icon"
                    [color]="row.item.event.color"
                    [fallback]="eventIcon"
                  />
                  <span class="flex min-w-0 flex-1 flex-col">
                    <span class="truncate text-base">{{ row.item.event.name }}</span>
                    <span class="truncate text-sm text-muted-foreground">{{ row.dates }}</span>
                  </span>
                  <span class="flex shrink-0 flex-col items-end">
                    <span class="text-base tabular-nums">{{ row.expense }}</span>
                    <span class="text-xs text-muted-foreground">{{ row.count }}</span>
                  </span>
                  <ng-icon
                    name="lucideChevronRight"
                    size="16"
                    class="shrink-0 text-muted-foreground"
                    aria-hidden="true"
                  />
                </a>
              </li>
            }
          </ul>
        }
      }
      @if (eventService.atLimit()) {
        <p class="text-sm text-muted-foreground">{{ 'events.limit' | transloco }}</p>
      } @else {
        <button
          hlmBtn
          variant="outline"
          type="button"
          class="h-11"
          [disabled]="!eventService.canWrite()"
          (click)="eventService.open({ mode: 'create' })"
        >
          {{ 'events.add' | transloco }}
        </button>
      }
    </div>
    @defer (when eventService.sheet()) {
      <app-event-sheet />
    }
  `,
})
export class EventsPage {
  protected eventService = inject(EventService)
  private languageService = inject(LanguageService)
  private transloco = inject(TranslocoService)
  private activatedRoute = inject(ActivatedRoute)
  private router = inject(Router)

  protected readonly route = EVENTS_ROUTE
  protected eventIcon = EVENT_DEFAULT_ICON
  protected showClosed = signal(false)

  private rows = computed(() => {
    this.languageService.language()
    const locale = this.languageService.locale()
    const t = (key: string, params?: Record<string, unknown>) =>
      this.transloco.translate(key, params)
    return this.eventService.items().map((item) => eventRow(item, t, locale))
  })
  protected open = computed(() => this.rows().filter((row) => !row.item.event.isClosed))
  protected closed = computed(() => this.rows().filter((row) => row.item.event.isClosed))

  constructor() {
    this.activatedRoute.queryParamMap.pipe(takeUntilDestroyed()).subscribe((params) => {
      const fix = params.get('fix')
      if (fix) {
        this.eventService.openFix(fix)
        void this.router.navigate([], { queryParams: {}, replaceUrl: true })
      }
    })
  }
}
