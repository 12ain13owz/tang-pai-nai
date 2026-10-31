import type { Currency } from './currency.entity'

export interface CurrencyRepository {
  /** Active currencies by `sortOrder`, then `code` (rule 5). */
  listActive(): Promise<Currency[]>
}
