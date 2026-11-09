import { Component, inject } from '@angular/core'
import { DebtService } from '@/core/debt'
import { DebtCloseSheet } from './close-sheet'
import { DebtSheet } from './debt-sheet'
import { DebtEntrySheet } from './entry-sheet'

/** The debts pages' sheets, each loaded the first time it opens. */
@Component({
  selector: 'app-debt-sheets',
  imports: [DebtSheet, DebtEntrySheet, DebtCloseSheet],
  template: `
    @defer (when debtService.sheet()) {
      <app-debt-sheet />
    }
    @defer (when debtService.entrySheet()) {
      <app-debt-entry-sheet />
    }
    @defer (when debtService.closeSheet()) {
      <app-debt-close-sheet />
    }
  `,
})
export class DebtSheets {
  protected debtService = inject(DebtService)
}
