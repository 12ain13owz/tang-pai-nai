import { CdkDrag, CdkDragHandle, CdkDragPlaceholder, CdkDropList } from '@angular/cdk/drag-drop'
import type { CdkDragDrop } from '@angular/cdk/drag-drop'
import { NgTemplateOutlet } from '@angular/common'
import { Component, computed, inject, signal } from '@angular/core'
import { TranslocoPipe } from '@jsverse/transloco'
import { NgIcon, provideIcons } from '@ng-icons/core'
import {
  lucideChevronDown,
  lucideChevronRight,
  lucideGripVertical,
  lucidePlus,
} from '@ng-icons/lucide'
import { HlmButton } from '@spartan-ng/helm/button'
import { LanguageService } from '@/core/i18n'
import { WalletService } from '@/core/wallet'
import type { Wallet } from '@/core/wallet'
import { IconBadge, WALLET_DEFAULT_ICON } from '@/shared/components/icon-badge'
import { formatMoney } from '@/shared/utils'

/**
 * The Wallets tab (docs/features/wallet.md → Web screens): the current profile's total per
 * currency, its wallets in order (with an order mode), and the archived ones folded away. The
 * shell shows the first-wallet step instead while the profile has none (rule 12).
 */
@Component({
  selector: 'app-wallets-page',
  imports: [
    NgTemplateOutlet,
    TranslocoPipe,
    NgIcon,
    HlmButton,
    IconBadge,
    CdkDropList,
    CdkDrag,
    CdkDragHandle,
    CdkDragPlaceholder,
  ],
  providers: [
    provideIcons({ lucideChevronDown, lucideChevronRight, lucideGripVertical, lucidePlus }),
  ],
  template: `
    @let open = walletService.openWallets();
    @let archived = walletService.archived();
    <div class="flex flex-col gap-6 p-4">
      @if (!walletService.canWrite()) {
        <p class="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {{ 'wallets.needsOnline' | transloco }}
        </p>
      }
      <div class="flex flex-col gap-3">
        <section
          class="flex flex-col gap-1 rounded-xl border border-border bg-card px-4 py-3 text-card-foreground"
          aria-labelledby="wallets-total"
        >
          <h2 id="wallets-total" class="text-sm text-muted-foreground">
            {{ 'wallets.total' | transloco }}
          </h2>
          @for (line of totals(); track line.currencyCode) {
            <p class="text-2xl font-semibold tabular-nums" [class.text-expense]="line.amount < 0">
              {{ line.text }}
            </p>
          }
        </section>

        @if (open.length > 0) {
          <section class="flex flex-col gap-3" aria-labelledby="wallets-open">
            <div class="flex items-center justify-between gap-3">
              <h2 id="wallets-open" class="text-sm font-medium text-muted-foreground">
                {{ 'wallets.listHeading' | transloco: { count: open.length } }}
              </h2>
              @if (open.length > 1) {
                <button
                  hlmBtn
                  variant="ghost"
                  type="button"
                  class="-my-3 -mr-2 h-11"
                  [attr.aria-pressed]="ordering()"
                  [disabled]="!walletService.canWrite()"
                  (click)="ordering.set(!ordering())"
                >
                  {{ (ordering() ? 'wallets.orderDone' : 'wallets.order') | transloco }}
                </button>
              }
            </div>
            <ul
              class="divide-y divide-border rounded-xl border border-border bg-card text-card-foreground"
              cdkDropList
              cdkDropListLockAxis="y"
              [cdkDropListDisabled]="!ordering()"
              (cdkDropListDropped)="drop($event)"
            >
              @for (wallet of open; track wallet.id) {
                <li
                  class="flex min-h-14 items-center gap-3 bg-card py-2 pr-2 pl-4 first:rounded-t-xl last:rounded-b-xl"
                  cdkDrag
                  [cdkDragStartDelay]="dragDelay"
                  cdkDragPreviewClass="tpn-drag-preview"
                >
                  <div
                    *cdkDragPlaceholder
                    class="min-h-14 border-2 border-dashed border-border bg-muted"
                  ></div>
                  @if (ordering()) {
                    <app-icon-badge
                      [icon]="wallet.icon"
                      [color]="wallet.color"
                      [fallback]="defaultIcon"
                    />
                    <span class="min-w-0 flex-1 truncate text-base">{{ wallet.name }}</span>
                    <button
                      hlmBtn
                      variant="ghost"
                      size="icon"
                      type="button"
                      class="size-11 touch-none"
                      cdkDragHandle
                      [attr.aria-label]="'wallets.dragItem' | transloco: { name: wallet.name }"
                      (keydown.arrowup)="moveBy($event, wallet.id, -1)"
                      (keydown.arrowdown)="moveBy($event, wallet.id, 1)"
                    >
                      <ng-icon name="lucideGripVertical" size="20" aria-hidden="true" />
                    </button>
                  } @else {
                    <ng-container *ngTemplateOutlet="row; context: { $implicit: wallet }" />
                  }
                </li>
              }
            </ul>
            @if (ordering()) {
              <p class="text-sm text-muted-foreground">{{ 'wallets.orderHint' | transloco }}</p>
            }
          </section>
        }
      </div>

      @if (!walletService.atLimit()) {
        <button
          hlmBtn
          variant="outline"
          type="button"
          class="h-11 w-full"
          [disabled]="!walletService.canWrite()"
          (click)="walletService.open({ mode: 'create' })"
        >
          <ng-icon name="lucidePlus" size="20" aria-hidden="true" />
          {{ 'wallets.add' | transloco }}
        </button>
      } @else {
        <p class="text-sm text-muted-foreground">{{ 'wallets.limit' | transloco }}</p>
      }

      @if (archived.length > 0) {
        <section class="flex flex-col gap-3">
          <button
            type="button"
            class="-mx-2 flex h-11 items-center gap-2 rounded-md px-2 text-left text-sm font-medium text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            aria-controls="wallets-archived"
            [attr.aria-expanded]="showArchived()"
            (click)="showArchived.set(!showArchived())"
          >
            <ng-icon
              [name]="showArchived() ? 'lucideChevronDown' : 'lucideChevronRight'"
              size="20"
              aria-hidden="true"
            />
            {{ 'wallets.archivedHeading' | transloco: { count: archived.length } }}
          </button>
          @if (showArchived()) {
            <ul
              id="wallets-archived"
              class="divide-y divide-border rounded-xl border border-border bg-card text-card-foreground"
            >
              @for (wallet of archived; track wallet.id) {
                <li class="flex min-h-14 items-center py-2 pr-2 pl-4">
                  <ng-container *ngTemplateOutlet="row; context: { $implicit: wallet }" />
                </li>
              }
            </ul>
          }
        </section>
      }
    </div>

    <ng-template #row let-wallet>
      <button
        type="button"
        class="-my-2 -mr-2 -ml-4 flex min-h-14 min-w-0 flex-1 items-center gap-3 py-2 pr-4 pl-4 text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        [attr.aria-label]="
          'wallets.editItem' | transloco: { name: wallet.name, balance: balanceText(wallet) }
        "
        (click)="walletService.open({ mode: 'edit', id: wallet.id })"
      >
        <app-icon-badge [icon]="wallet.icon" [color]="wallet.color" [fallback]="defaultIcon" />
        <span class="flex min-w-0 flex-1 flex-col">
          <span class="truncate text-base">{{ wallet.name }}</span>
          @if (wallet.excludeFromTotal && !wallet.isArchived) {
            <span class="text-sm text-muted-foreground">
              {{ 'wallets.excluded' | transloco }}
            </span>
          }
          @if (walletService.pendingIds().has(wallet.id)) {
            <span class="text-sm text-muted-foreground">
              {{ 'wallets.pending' | transloco }}
            </span>
          }
        </span>
        <span
          class="shrink-0 text-right text-base tabular-nums"
          [class.text-expense]="walletService.balance(wallet) < 0"
          [class.text-muted-foreground]="wallet.isArchived"
        >
          {{ balanceText(wallet) }}
        </span>
      </button>
    </ng-template>
  `,
})
export class WalletsPage {
  private languageService = inject(LanguageService)
  protected walletService = inject(WalletService)

  protected defaultIcon = WALLET_DEFAULT_ICON
  protected ordering = signal(false)
  protected showArchived = signal(false)

  /** Rule 7: one line per currency; ฿0.00 while nothing counts. */
  protected totals = computed(() => {
    const locale = this.languageService.locale()
    const totals = this.walletService.totals()
    const lines =
      totals.length > 0
        ? totals
        : [
            {
              currencyCode: this.walletService.defaultCurrency(),
              minorUnit: this.walletService.minorUnit(this.walletService.defaultCurrency()),
              amount: 0,
            },
          ]
    return lines.map((line) => ({
      ...line,
      text: formatMoney(line.amount, line.currencyCode, line.minorUnit, locale),
    }))
  })

  /** Touch: press and hold the handle before dragging, so scrolling the list still works. */
  protected dragDelay = { touch: 300, mouse: 0 }

  protected balanceText(wallet: Wallet): string {
    return formatMoney(
      this.walletService.balance(wallet),
      wallet.currencyCode,
      this.walletService.minorUnit(wallet.currencyCode),
      this.languageService.locale()
    )
  }

  protected drop(event: CdkDragDrop<unknown>): void {
    const wallet = this.walletService.openWallets().at(event.previousIndex)
    if (wallet) {
      this.walletService.moveTo(wallet.id, event.currentIndex)
    }
  }

  /** The handle's keyboard way (DESIGN.md §8: a drag is never the only way). */
  protected moveBy(event: Event, id: string, step: -1 | 1): void {
    event.preventDefault()
    // The row's place now, not the rendered one: a second press may come before the re-render.
    const index = this.walletService.openWallets().findIndex((item) => item.id === id)
    this.walletService.moveTo(id, index + step)
    const target = event.target
    // The row re-renders in its new place; keep the focus on its handle.
    queueMicrotask(() => target instanceof HTMLElement && target.focus())
  }
}
