import { Component } from '@angular/core'
import { TranslocoPipe } from '@jsverse/transloco'
import { NgIcon, provideIcons } from '@ng-icons/core'
import { lucideWallet } from '@ng-icons/lucide'
import { EmptyState } from '@/shared/components/empty-state'

@Component({
  selector: 'app-transactions-page',
  imports: [TranslocoPipe, NgIcon, EmptyState],
  providers: [provideIcons({ lucideWallet })],
  template: `
    <!-- #6.1: a profile exists but no wallet can yet; 6.2 adds the "add wallet" button. -->
    <app-empty-state
      [heading]="'transactions.noWalletHeading' | transloco"
      [description]="'transactions.noWalletText' | transloco"
    >
      <ng-icon name="lucideWallet" />
    </app-empty-state>
  `,
})
export class TransactionsPage {}
