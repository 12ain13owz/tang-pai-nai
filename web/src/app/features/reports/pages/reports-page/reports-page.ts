import { Component } from '@angular/core'
import { NgIcon, provideIcons } from '@ng-icons/core'
import { lucideChartPie } from '@ng-icons/lucide'
import { EmptyState } from '@/shared/components/empty-state'

@Component({
  selector: 'app-reports-page',
  imports: [NgIcon, EmptyState],
  providers: [provideIcons({ lucideChartPie })],
  template: `
    <app-empty-state heading="ยังไม่มีรายงาน" description="สรุปรายรับรายจ่ายรายเดือนจะแสดงที่นี่">
      <ng-icon name="lucideChartPie" />
    </app-empty-state>
  `,
})
export class ReportsPage {}
