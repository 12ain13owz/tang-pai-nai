import { DOCUMENT, inject, Service, signal } from '@angular/core'

/** The keypad's quick amounts in major units: Thai banknotes (owner's choice in 8.2). */
export const QUICK_AMOUNTS: readonly number[] = [20, 50, 100, 500, 1000]

/**
 * Whether the keypad shows its quick amounts (transaction.md → Web screens, 8.2). Money Lover has
 * none, so Account › การแสดงผล turns them off. A device setting like the theme: kept in
 * localStorage, not synced, and not wiped with the user's data. On by default.
 */
@Service()
export class QuickAmountsService {
  private window = inject(DOCUMENT).defaultView
  private readonly STORAGE_KEY = 'tpn-quick-amounts'

  enabled = signal(this.read())

  setEnabled(enabled: boolean): void {
    this.enabled.set(enabled)
    try {
      this.window?.localStorage.setItem(this.STORAGE_KEY, enabled ? 'on' : 'off')
    } catch {
      // A blocked storage only forgets the choice.
    }
  }

  private read(): boolean {
    try {
      return this.window?.localStorage.getItem(this.STORAGE_KEY) !== 'off'
    } catch {
      return true
    }
  }
}
