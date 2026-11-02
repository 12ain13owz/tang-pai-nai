import { NgTemplateOutlet } from '@angular/common'
import { Component, computed, inject, model, signal } from '@angular/core'
import { TranslocoPipe } from '@jsverse/transloco'
import { NgIcon, provideIcons } from '@ng-icons/core'
import { lucideCheck, lucideChevronDown, lucideWallet } from '@ng-icons/lucide'
import { HlmDrawerImports } from '@spartan-ng/helm/drawer'
import { LanguageService } from '@/core/i18n'
import { TransactionService } from '@/core/transaction'
import { WalletService } from '@/core/wallet'
import type { Wallet } from '@/core/wallet'
import { IconBadge, WALLET_DEFAULT_ICON } from '@/shared/components/icon-badge'
import { SheetFrame } from '@/shared/components/sheet'
import { formatMoney } from '@/shared/utils'

/**
 * The Transactions tab's wallet switcher (transaction.md → Web screens): "ทุกกระเป๋า" with the
 * total, the open wallets with their balances, then the archived ones folded.
 */
@Component({
  selector: 'app-view-wallet-sheet',
  imports: [NgTemplateOutlet, TranslocoPipe, NgIcon, HlmDrawerImports, IconBadge, SheetFrame],
  providers: [provideIcons({ lucideCheck, lucideChevronDown, lucideWallet })],
  template: `
    <hlm-drawer [state]="open() ? 'open' : 'closed'" (closed)="open.set(false)">
      <hlm-drawer-content
        *hlmDrawerPortal
        class="mx-auto h-[92dvh] w-full max-w-[480px] data-[vaul-drawer-direction=bottom]:max-h-[92dvh]"
      >
        <app-sheet-frame
          [title]="'transactions.walletSheet' | transloco"
          [leadingLabel]="'sheet.close' | transloco"
          (leading)="open.set(false)"
        >
          <div class="flex flex-col gap-6">
            <button
              type="button"
              class="flex min-h-16 w-full items-center gap-3 rounded-xl border border-border bg-card px-4 py-2 text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              [attr.aria-current]="current() === null ? 'true' : null"
              (click)="pick(null)"
            >
              <span
                class="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground"
              >
                <ng-icon name="lucideWallet" size="20" aria-hidden="true" />
              </span>
              <span class="flex min-w-0 flex-1 flex-col">
                <span class="truncate text-base font-semibold">{{
                  'transactions.allWallets' | transloco
                }}</span>
                <span class="text-sm text-muted-foreground tabular-nums">
                  {{ 'transactions.totalLine' | transloco: { total: totalText() } }}
                </span>
              </span>
              @if (current() === null) {
                <ng-icon name="lucideCheck" size="20" class="text-brand" aria-hidden="true" />
              }
            </button>
            <section class="flex flex-col gap-3">
              <h3 class="text-sm font-medium text-muted-foreground">
                {{
                  'wallets.listHeading' | transloco: { count: walletService.openWallets().length }
                }}
              </h3>
              <ul class="divide-y divide-border rounded-xl border border-border bg-card">
                @for (wallet of walletService.openWallets(); track wallet.id) {
                  <li>
                    <ng-container *ngTemplateOutlet="row; context: { $implicit: wallet }" />
                  </li>
                }
              </ul>
            </section>
            @if (walletService.archived().length > 0) {
              <section class="flex flex-col gap-3">
                <button
                  type="button"
                  class="flex min-h-11 items-center gap-1 self-start text-sm font-medium text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  [attr.aria-expanded]="showArchived()"
                  (click)="showArchived.set(!showArchived())"
                >
                  {{
                    'wallets.archivedHeading'
                      | transloco: { count: walletService.archived().length }
                  }}
                  <ng-icon
                    name="lucideChevronDown"
                    size="16"
                    [class.rotate-180]="showArchived()"
                    aria-hidden="true"
                  />
                </button>
                @if (showArchived()) {
                  <ul class="divide-y divide-border rounded-xl border border-border bg-card">
                    @for (wallet of walletService.archived(); track wallet.id) {
                      <li>
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
              class="flex min-h-14 w-full items-center gap-3 px-4 py-2 text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              [attr.aria-current]="current() === wallet.id ? 'true' : null"
              (click)="pick(wallet.id)"
            >
              <app-icon-badge
                [icon]="wallet.icon"
                [color]="wallet.color"
                [fallback]="defaultIcon"
              />
              <span class="flex min-w-0 flex-1 flex-col">
                <span class="truncate text-base">{{ wallet.name }}</span>
                @if (wallet.excludeFromTotal) {
                  <span class="text-sm text-muted-foreground">{{
                    'wallets.excluded' | transloco
                  }}</span>
                }
              </span>
              <span
                class="text-right text-base tabular-nums"
                [class.text-expense]="walletService.balance(wallet) < 0"
              >
                {{ balanceText(wallet) }}
              </span>
              @if (current() === wallet.id) {
                <ng-icon
                  name="lucideCheck"
                  size="20"
                  class="shrink-0 text-brand"
                  aria-hidden="true"
                />
              }
            </button>
          </ng-template>
        </app-sheet-frame>
      </hlm-drawer-content>
    </hlm-drawer>
  `,
})
export class ViewWalletSheet {
  protected walletService = inject(WalletService)
  private transactionService = inject(TransactionService)
  private languageService = inject(LanguageService)

  open = model(false)

  protected defaultIcon = WALLET_DEFAULT_ICON
  protected showArchived = signal(false)
  protected current = computed(() => this.transactionService.viewWallet()?.id ?? null)
  /** Wallet rule 7: the total per currency, joined on one line. */
  protected totalText = computed(() => {
    const locale = this.languageService.locale()
    const totals = this.walletService.totals()
    const code = this.walletService.defaultCurrency()
    const lines =
      totals.length > 0
        ? totals
        : [{ currencyCode: code, minorUnit: this.walletService.minorUnit(code), amount: 0 }]
    return lines
      .map((line) => formatMoney(line.amount, line.currencyCode, line.minorUnit, locale))
      .join(' · ')
  })

  protected balanceText(wallet: Wallet): string {
    return formatMoney(
      this.walletService.balance(wallet),
      wallet.currencyCode,
      this.walletService.minorUnit(wallet.currencyCode),
      this.languageService.locale()
    )
  }

  protected pick(id: string | null): void {
    this.transactionService.selectWallet(id)
    this.open.set(false)
  }
}
