import { Component } from '@angular/core'
import { NgIcon, provideIcons } from '@ng-icons/core'
import { lucideWallet } from '@ng-icons/lucide'
import { EmptyState } from '@/shared/components/empty-state'

@Component({
  selector: 'app-wallets-page',
  imports: [NgIcon, EmptyState],
  providers: [provideIcons({ lucideWallet })],
  template: `
    <app-empty-state
      heading="ยังไม่มีกระเป๋าเงิน"
      description="เงินสด บัญชีธนาคาร และบัตรต่าง ๆ จะแสดงที่นี่"
    >
      <ng-icon name="lucideWallet" />
    </app-empty-state>
  `,
})
export class WalletsPage {}
