import type { Currency } from './currency.entity'
import type { CurrencyRepository } from './currency.repository'

export interface CurrencyServiceDeps {
  currencyRepo: CurrencyRepository
}

export const createCurrencyService = ({ currencyRepo }: CurrencyServiceDeps) => {
  const listActive = async (): Promise<Currency[]> => currencyRepo.listActive()

  return { listActive }
}

export type CurrencyService = ReturnType<typeof createCurrencyService>
