import { Component } from '@angular/core'
import { TranslocoPipe } from '@jsverse/transloco'
import { NgIcon, provideIcons } from '@ng-icons/core'
import { lucidePlus } from '@ng-icons/lucide'
import { EmptyState } from '@/shared/components/empty-state'

@Component({
  selector: 'app-transaction-new-page',
  imports: [TranslocoPipe, NgIcon, EmptyState],
  providers: [provideIcons({ lucidePlus })],
  template: `
    <app-empty-state
      [heading]="'transactions.newHeading' | transloco"
      [description]="'transactions.newText' | transloco"
    >
      <ng-icon name="lucidePlus" />
    </app-empty-state>
  `,
})
export class TransactionNewPage {}
