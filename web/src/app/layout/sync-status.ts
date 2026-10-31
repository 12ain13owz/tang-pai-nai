import { Component, computed, inject, signal } from '@angular/core'
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco'
import { NgIcon, provideIcons } from '@ng-icons/core'
import { lucideRefreshCw } from '@ng-icons/lucide'
import { LanguageService } from '@/core/i18n'
import { SyncService } from '@/core/offline'
import type { SyncStatus as Status } from '@/core/offline'
import { SyncSheet } from './sync-sheet'

/**
 * The header's sync pill (offline-sync → Web screens; DESIGN.md §6 Status): a dot plus words.
 * Tapping it opens the sync sheet.
 */
@Component({
  selector: 'app-sync-status',
  imports: [TranslocoPipe, NgIcon, SyncSheet],
  providers: [provideIcons({ lucideRefreshCw })],
  template: `
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
    @defer (when sheetOpen()) {
      <app-sync-sheet [(open)]="sheetOpen" />
    }
  `,
})
export class SyncStatus {
  private languageService = inject(LanguageService)
  private transloco = inject(TranslocoService)
  private syncService = inject(SyncService)

  protected sheetOpen = signal(false)
  protected status = this.syncService.status
  protected label = computed(() => {
    this.languageService.language() // re-translate on a language switch
    const pending = this.syncService.pendingCount()
    const keys: Record<Status, [string, object]> = {
      errors: ['sync.errors', { count: this.syncService.rejected().length }],
      offline: pending > 0 ? ['sync.offlinePending', { count: pending }] : ['sync.offline', {}],
      syncing: ['sync.syncing', {}],
      pending: ['sync.pending', { count: pending }],
      synced: ['sync.synced', {}],
    }
    const [key, params] = keys[this.status()]
    return this.transloco.translate(key, params)
  })
  protected pillClass = computed(() =>
    this.status() === 'errors' || this.status() === 'offline'
      ? 'bg-destructive/10 text-destructive'
      : 'text-muted-foreground'
  )
  protected dotClass = computed(() => {
    switch (this.status()) {
      case 'errors':
      case 'offline':
        return 'bg-destructive'
      case 'synced':
        return 'bg-income'
      default:
        return 'bg-muted-foreground'
    }
  })
}
