import { Component } from '@angular/core'
import { TranslocoPipe } from '@jsverse/transloco'
import { NgIcon, provideIcons } from '@ng-icons/core'
import { lucideWallet } from '@ng-icons/lucide'
import { EmptyState } from '@/shared/components/empty-state'

@Component({
  selector: 'app-wallets-page',
  imports: [TranslocoPipe, NgIcon, EmptyState],
  providers: [provideIcons({ lucideWallet })],
  template: `
    <app-empty-state
      [heading]="'wallets.emptyHeading' | transloco"
      [description]="'wallets.emptyText' | transloco"
    >
      <ng-icon name="lucideWallet" />
    </app-empty-state>
  `,
})
export class WalletsPage {}
