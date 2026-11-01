import { Component, inject } from '@angular/core'
import { TranslocoPipe } from '@jsverse/transloco'
import { NgIcon, provideIcons } from '@ng-icons/core'
import { lucideWallet } from '@ng-icons/lucide'
import { HlmButton } from '@spartan-ng/helm/button'
import { WalletService } from '@/core/wallet'
import { EmptyState } from '@/shared/components/empty-state'

/** Wallet rule 12: the current profile has no wallet yet, so the tabs ask for the first one. */
@Component({
  selector: 'app-wallet-first-step',
  imports: [TranslocoPipe, NgIcon, HlmButton, EmptyState],
  providers: [provideIcons({ lucideWallet })],
  template: `
    <div class="flex flex-col items-center gap-3 p-4">
      <app-empty-state
        [heading]="'wallets.firstHeading' | transloco"
        [description]="'wallets.firstText' | transloco"
      >
        <ng-icon name="lucideWallet" />
      </app-empty-state>
      @if (!walletService.canWrite()) {
        <p class="w-full rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {{ 'wallets.needsOnline' | transloco }}
        </p>
      }
      <button
        hlmBtn
        type="button"
        class="-mt-8 h-11 px-6 text-base"
        [disabled]="!walletService.canWrite()"
        (click)="walletService.open({ mode: 'create' })"
      >
        {{ 'wallets.add' | transloco }}
      </button>
    </div>
  `,
})
export class WalletFirstStep {
  protected walletService = inject(WalletService)
}
