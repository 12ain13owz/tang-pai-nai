import { Component } from '@angular/core'
import { TranslocoPipe } from '@jsverse/transloco'
import { NgIcon, provideIcons } from '@ng-icons/core'
import { lucideChartPie } from '@ng-icons/lucide'
import { EmptyState } from '@/shared/components/empty-state'

@Component({
  selector: 'app-reports-page',
  imports: [TranslocoPipe, NgIcon, EmptyState],
  providers: [provideIcons({ lucideChartPie })],
  template: `
    <app-empty-state
      [heading]="'reports.emptyHeading' | transloco"
      [description]="'reports.emptyText' | transloco"
    >
      <ng-icon name="lucideChartPie" />
    </app-empty-state>
  `,
})
export class ReportsPage {}
