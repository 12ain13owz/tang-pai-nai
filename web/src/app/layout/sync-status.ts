import { Component, computed, inject, signal } from '@angular/core'
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
 * The header's sync status on every tab (offline-sync → Web screens; DESIGN.md §6 Status): a 44px
 * icon whose shape and colour say the state, with a count of waiting ops (owner's choice in #8 for
 * the Transactions tab, every tab since #9); the words stay in its label, announced politely, and
 * in the sync sheet it opens.
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
}
