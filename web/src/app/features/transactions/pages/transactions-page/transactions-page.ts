import { Component } from '@angular/core'
import { TranslocoPipe } from '@jsverse/transloco'
import { NgIcon, provideIcons } from '@ng-icons/core'
import { lucideReceiptText } from '@ng-icons/lucide'
import { EmptyState } from '@/shared/components/empty-state'

/**
 * The Transactions tab. The shell shows the create step or the first-wallet step instead while
 * the profile or its first wallet is missing (wallet rule 12); the list itself comes with #8.
 */
@Component({
  selector: 'app-transactions-page',
  imports: [TranslocoPipe, NgIcon, EmptyState],
  providers: [provideIcons({ lucideReceiptText })],
  template: `
    <app-empty-state
      [heading]="'transactions.emptyHeading' | transloco"
      [description]="'transactions.emptyText' | transloco"
    >
      <ng-icon name="lucideReceiptText" />
    </app-empty-state>
  `,
})
export class TransactionsPage {}
