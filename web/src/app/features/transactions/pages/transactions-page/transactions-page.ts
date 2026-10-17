import { Component } from '@angular/core'
import { NgIcon, provideIcons } from '@ng-icons/core'
import { lucideReceiptText } from '@ng-icons/lucide'
import { EmptyState } from '@/shared/components/empty-state'

@Component({
  selector: 'app-transactions-page',
  imports: [NgIcon, EmptyState],
  providers: [provideIcons({ lucideReceiptText })],
  template: `
    <app-empty-state heading="ยังไม่มีธุรกรรม" description="รายรับรายจ่ายที่บันทึกจะแสดงที่นี่">
      <ng-icon name="lucideReceiptText" />
    </app-empty-state>
  `,
})
export class TransactionsPage {}
