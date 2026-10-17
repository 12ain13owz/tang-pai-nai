import { Component } from '@angular/core'
import { NgIcon, provideIcons } from '@ng-icons/core'
import { lucidePlus } from '@ng-icons/lucide'
import { EmptyState } from '@/shared/components/empty-state'

@Component({
  selector: 'app-transaction-new-page',
  imports: [NgIcon, EmptyState],
  providers: [provideIcons({ lucidePlus })],
  template: `
    <app-empty-state heading="เพิ่มธุรกรรม" description="ฟอร์มบันทึกรายรับรายจ่ายจะมาในเร็ว ๆ นี้">
      <ng-icon name="lucidePlus" />
    </app-empty-state>
  `,
})
export class TransactionNewPage {}
