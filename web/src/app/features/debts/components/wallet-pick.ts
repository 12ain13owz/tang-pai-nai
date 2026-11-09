import { Component, inject, input, output } from '@angular/core'
import { TranslocoPipe } from '@jsverse/transloco'
import { NgIcon, provideIcons } from '@ng-icons/core'
import { lucideCheck } from '@ng-icons/lucide'
import { LanguageService } from '@/core/i18n'
import { WalletService } from '@/core/wallet'
import type { Wallet } from '@/core/wallet'
import { IconBadge, WALLET_DEFAULT_ICON } from '@/shared/components/icon-badge'
import { formatMoney } from '@/shared/utils'

/** A sheet view listing wallets with their balances (the transfer form's picker). */
@Component({
  selector: 'app-debt-wallet-pick',
  imports: [TranslocoPipe, NgIcon, IconBadge],
  providers: [provideIcons({ lucideCheck })],
  template: `
    @if (wallets().length > 0) {
      <ul class="divide-y divide-border rounded-xl border border-border bg-card">
        @for (item of wallets(); track item.id) {
          <li>
            <button
              type="button"
              class="flex min-h-14 w-full items-center gap-3 px-4 py-2 text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset"
              [attr.aria-current]="item.id === chosen() ? 'true' : null"
              (click)="picked.emit(item.id)"
            >
              <app-icon-badge [icon]="item.icon" [color]="item.color" [fallback]="walletIcon" />
              <span class="flex min-w-0 flex-1 flex-col">
                <span class="truncate text-base">{{ item.name }}</span>
                @if (item.excludeFromTotal) {
                  <span class="text-sm text-muted-foreground">{{
                    'wallets.excluded' | transloco
                  }}</span>
                }
              </span>
              <span
                class="shrink-0 text-sm tabular-nums"
                [class.text-expense]="walletService.balance(item) < 0"
                >{{ balance(item) }}</span
              >
              @if (item.id === chosen()) {
                <ng-icon name="lucideCheck" size="20" class="text-brand" aria-hidden="true" />
              }
            </button>
          </li>
        }
      </ul>
    } @else {
      <p class="text-sm text-muted-foreground">{{ 'debts.noWallet' | transloco }}</p>
    }
  `,
})
export class DebtWalletPick {
  protected walletService = inject(WalletService)
  private languageService = inject(LanguageService)
  protected walletIcon = WALLET_DEFAULT_ICON

  wallets = input.required<Wallet[]>()
  chosen = input<string | null>(null)
  picked = output<string>()

  protected balance(wallet: Wallet): string {
    return formatMoney(
      this.walletService.balance(wallet),
      wallet.currencyCode,
      this.walletService.minorUnit(wallet.currencyCode),
      this.languageService.locale()
    )
  }
}
