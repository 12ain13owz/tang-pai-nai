import { Component, computed, inject, input, signal } from '@angular/core'
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco'
import { NgIcon, provideIcons } from '@ng-icons/core'
import {
  lucideCloud,
  lucideCloudAlert,
  lucideCloudCheck,
  lucideCloudOff,
  lucideRefreshCw,
} from '@ng-icons/lucide'
import { LanguageService } from '@/core/i18n'
import { SyncService } from '@/core/offline'
import type { SyncStatus as Status } from '@/core/offline'
import { ProfileService } from '@/core/profile'
import { SyncSheet } from './sync-sheet'

/**
 * The header's sync pill (offline-sync → Web screens; DESIGN.md §6 Status): a dot plus words.
 * Tapping it opens the sync sheet. `compact` (the Transactions tab, owner's choice in #8, so the
 * wallet switcher can sit in the centre) is a 44px icon whose shape says the state, with a count
 * of waiting ops; the words stay in its label and the sheet.
 */
@Component({
  selector: 'app-sync-status',
  imports: [TranslocoPipe, NgIcon, SyncSheet],
  providers: [
    provideIcons({
      lucideCloud,
      lucideCloudAlert,
      lucideCloudCheck,
      lucideCloudOff,
      lucideRefreshCw,
    }),
  ],
  template: `
    @if (compact()) {
      <button
        type="button"
        class="relative flex size-11 items-center justify-center rounded-full focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        [class]="iconClass()"
        aria-haspopup="dialog"
        [attr.aria-label]="'sync.open' | transloco: { status: label() }"
        (click)="sheetOpen.set(true)"
      >
        <span role="status" class="sr-only">{{ label() }}</span>
        <ng-icon
          [name]="icon()"
          size="22"
          [class.animate-spin]="status() === 'syncing'"
          aria-hidden="true"
        />
        @if (count() > 0) {
          <span
            class="absolute top-1 right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] leading-none font-bold"
            [class]="countClass()"
            aria-hidden="true"
          >
            {{ count() }}
          </span>
        }
      </button>
    } @else {
      <button
        type="button"
        class="-mr-2 flex min-h-11 items-center rounded-full px-2 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        aria-haspopup="dialog"
        [attr.aria-label]="'sync.open' | transloco: { status: label() }"
        (click)="sheetOpen.set(true)"
      >
        <span
          role="status"
          class="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium"
          [class]="pillClass()"
        >
          @if (status() === 'syncing') {
            <ng-icon name="lucideRefreshCw" size="12" class="animate-spin" aria-hidden="true" />
          } @else {
            <span class="size-2 rounded-full" [class]="dotClass()" aria-hidden="true"></span>
          }
          {{ label() }}
        </span>
      </button>
    }
    @defer (when sheetOpen()) {
      <app-sync-sheet [(open)]="sheetOpen" />
    }
  `,
})
export class SyncStatus {
  private languageService = inject(LanguageService)
  private transloco = inject(TranslocoService)
  private syncService = inject(SyncService)
  private profileService = inject(ProfileService)

  /** The icon-only form for the Transactions tab's header. */
  compact = input(false)

  protected sheetOpen = signal(false)
  private isAlert = computed(() => ['errors', 'offline', 'unreachable'].includes(this.status()))
  protected icon = computed(() => {
    switch (this.status()) {
      case 'syncing':
        return 'lucideRefreshCw'
      case 'synced':
        return 'lucideCloudCheck'
      case 'errors':
        return 'lucideCloudAlert'
      case 'pending':
        return 'lucideCloud'
      default:
        return 'lucideCloudOff'
    }
  })
  protected iconClass = computed(() => {
    if (this.isAlert()) {
      return 'text-destructive'
    }
    return this.status() === 'synced' ? 'text-income' : 'text-muted-foreground'
  })
  /** Ops waiting, or refused items while there are errors. */
  protected count = computed(() =>
    this.status() === 'errors'
      ? this.profileService.rejectedItems().length
      : this.status() === 'synced'
        ? 0
        : this.syncService.pendingCount()
  )
  protected countClass = computed(() =>
    this.isAlert() ? 'bg-destructive text-background' : 'bg-muted-foreground text-background'
  )
  protected status = this.syncService.status
  protected label = computed(() => {
    this.languageService.language() // re-translate on a language switch
    const pending = this.syncService.pendingCount()
    const keys: Record<Status, [string, object]> = {
      errors: ['sync.errors', { count: this.profileService.rejectedItems().length }],
      offline: pending > 0 ? ['sync.offlinePending', { count: pending }] : ['sync.offline', {}],
      unreachable:
        pending > 0 ? ['sync.unreachablePending', { count: pending }] : ['sync.unreachable', {}],
      syncing: ['sync.syncing', {}],
      pending: ['sync.pending', { count: pending }],
      synced: ['sync.synced', {}],
    }
    const [key, params] = keys[this.status()]
    return this.transloco.translate(key, params)
  })
  protected pillClass = computed(() =>
    this.status() === 'errors' || this.status() === 'offline' || this.status() === 'unreachable'
      ? 'bg-destructive/10 text-destructive'
      : 'text-muted-foreground'
  )
  protected dotClass = computed(() => {
    switch (this.status()) {
      case 'errors':
      case 'offline':
      case 'unreachable':
        return 'bg-destructive'
      case 'synced':
        return 'bg-income'
      default:
        return 'bg-muted-foreground'
    }
  })
}
