import { Component, inject, model } from '@angular/core'
import { Router } from '@angular/router'
import { TranslocoPipe } from '@jsverse/transloco'
import { NgIcon, provideIcons } from '@ng-icons/core'
import { lucideRefreshCw } from '@ng-icons/lucide'
import { HlmButton } from '@spartan-ng/helm/button'
import { HlmDrawerImports } from '@spartan-ng/helm/drawer'
import { HlmSpinner } from '@spartan-ng/helm/spinner'
import { AuthStore } from '@/core/auth'
import { LanguageService } from '@/core/i18n'
import { NetworkStatusService } from '@/core/network'
import { SyncService } from '@/core/offline'
import type { SyncRow } from '@/core/offline'

/** Where "fix" opens a rejected op's values, per table. */
const FIX_ROUTES: Readonly<Record<string, string>> = {
  sync_probes: '/account/sync-test',
}

/**
 * The sync sheet the header pill opens (offline-sync → Web screens): the last sync, "sync now",
 * rejected ops (fix or discard) and conflict notices. Loaded on first open, so the drawer code
 * stays out of the initial bundle.
 */
@Component({
  selector: 'app-sync-sheet',
  imports: [TranslocoPipe, NgIcon, HlmButton, HlmSpinner, HlmDrawerImports],
  providers: [provideIcons({ lucideRefreshCw })],
  template: `
    <hlm-drawer [state]="open() ? 'open' : 'closed'" (closed)="open.set(false)">
      <hlm-drawer-content *hlmDrawerPortal class="mx-auto max-w-[480px]">
        <div class="flex max-h-[70vh] flex-col gap-6 overflow-y-auto px-2 pt-2 pb-4">
          <div class="flex flex-col gap-1">
            <h2 hlmDrawerTitle class="text-lg font-semibold">{{ 'sync.heading' | transloco }}</h2>
            <p class="text-sm text-muted-foreground">
              @if (syncService.lastSyncedAt(); as at) {
                {{ 'sync.lastSynced' | transloco: { time: time(at) } }}
              } @else {
                {{ 'sync.neverSynced' | transloco }}
              }
            </p>
            <p class="text-sm text-muted-foreground">
              @if (syncService.pendingCount() > 0) {
                {{ 'sync.pendingText' | transloco: { count: syncService.pendingCount() } }}
              } @else if (syncService.rejected().length === 0) {
                {{ 'sync.allSynced' | transloco }}
              }
            </p>
          </div>

          @if (!networkStatusService.isOnline()) {
            <p class="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {{ 'sync.needsOnline' | transloco }}
            </p>
          } @else if (authStore.status() !== 'signedIn') {
            <p class="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {{ 'sync.needsSignIn' | transloco }}
            </p>
          }

          @if (syncService.rejected(); as rejected) {
            @if (rejected.length > 0) {
              <section class="flex flex-col gap-3" aria-labelledby="sync-rejected-heading">
                <div class="flex flex-col gap-1">
                  <h3 id="sync-rejected-heading" class="text-sm font-medium text-destructive">
                    {{ 'sync.rejectedHeading' | transloco }}
                  </h3>
                  <p class="text-sm text-muted-foreground">
                    {{ 'sync.rejectedHint' | transloco }}
                  </p>
                </div>
                <ul
                  class="divide-y divide-border rounded-xl border border-border bg-card text-card-foreground"
                >
                  @for (op of rejected; track op.opId) {
                    <li class="flex flex-col gap-2 px-4 py-3">
                      <p class="text-sm text-muted-foreground">
                        {{ 'sync.table' + op.table | transloco }}
                      </p>
                      <p class="text-base break-words">
                        {{ summary(op.row) }}
                        @if (op.op === 'delete') {
                          {{ 'sync.deleted' | transloco }}
                        }
                      </p>
                      <p class="text-sm text-destructive">
                        {{ 'sync.code' + op.code | transloco }}
                      </p>
                      <div class="flex gap-3">
                        @if (fixRoute(op.table) && op.op === 'upsert') {
                          <button
                            hlmBtn
                            variant="outline"
                            type="button"
                            class="h-11 flex-1"
                            (click)="fix(op.table, op.opId); open.set(false)"
                          >
                            {{ 'sync.fix' | transloco }}
                          </button>
                        }
                        <button
                          hlmBtn
                          variant="outline"
                          type="button"
                          class="h-11 flex-1"
                          (click)="syncService.discard(op.opId)"
                        >
                          {{ 'sync.discard' | transloco }}
                        </button>
                      </div>
                    </li>
                  }
                </ul>
              </section>
            }
          }

          @if (syncService.notices(); as notices) {
            @if (notices.length > 0) {
              <section class="flex flex-col gap-3" aria-labelledby="sync-notices-heading">
                <h3 id="sync-notices-heading" class="text-sm font-medium text-muted-foreground">
                  {{ 'sync.noticesHeading' | transloco }}
                </h3>
                <ul
                  class="divide-y divide-border rounded-xl border border-border bg-card text-card-foreground"
                >
                  @for (notice of notices; track notice.id) {
                    <li class="flex flex-col gap-2 px-4 py-3">
                      <p class="text-sm text-muted-foreground">
                        {{ 'sync.table' + notice.table | transloco }} ·
                        {{ 'sync.noticeText' | transloco }}
                      </p>
                      <p class="text-base break-words">
                        {{ summary(notice.previous) }}
                        @if (notice.previous['deletedAt']) {
                          {{ 'sync.deleted' | transloco }}
                        }
                      </p>
                      <button
                        hlmBtn
                        variant="outline"
                        type="button"
                        class="h-11"
                        (click)="syncService.dismissNotice(notice.id)"
                      >
                        {{ 'sync.dismiss' | transloco }}
                      </button>
                    </li>
                  }
                </ul>
              </section>
            }
          }

          <div class="flex flex-col gap-3">
            <button
              hlmBtn
              type="button"
              class="h-11 w-full text-base"
              [disabled]="!syncService.canSync() || syncService.isSyncing()"
              (click)="syncNow()"
            >
              @if (syncService.isSyncing()) {
                <hlm-spinner [aria-label]="'sync.syncingNow' | transloco" />
              } @else {
                <ng-icon name="lucideRefreshCw" aria-hidden="true" />
              }
              {{ 'sync.syncNow' | transloco }}
            </button>
            <button
              hlmBtn
              variant="outline"
              type="button"
              class="h-11 w-full"
              (click)="open.set(false)"
            >
              {{ 'sync.close' | transloco }}
            </button>
          </div>
        </div>
      </hlm-drawer-content>
    </hlm-drawer>
  `,
})
export class SyncSheet {
  private router = inject(Router)
  private languageService = inject(LanguageService)
  protected syncService = inject(SyncService)
  protected networkStatusService = inject(NetworkStatusService)
  protected authStore = inject(AuthStore)

  open = model(false)

  protected time(at: number): string {
    return new Intl.DateTimeFormat(this.languageService.locale(), {
      dateStyle: 'short',
      timeStyle: 'short',
    }).format(at)
  }

  protected summary(row: SyncRow): string {
    const title = row['title']
    return typeof title === 'string' ? title : String(row['id'])
  }

  protected fixRoute(table: string): string | undefined {
    return FIX_ROUTES[table]
  }

  protected fix(table: string, opId: string): void {
    void this.router.navigate([FIX_ROUTES[table]], { queryParams: { fix: opId } })
  }

  protected syncNow(): void {
    void this.syncService.sync()
  }
}
