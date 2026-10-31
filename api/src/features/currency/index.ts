import { db } from '@/core/database'
import { syncRegistry } from '@/core/sync'
import { createCurrencyController } from './currency.controller'
import { createDrizzleCurrencyRepository, currencySyncHandler } from './currency.repository.drizzle'
import { createCurrencyRouter } from './currency.routes'
import { createCurrencyService } from './currency.service'

const currencyRepo = createDrizzleCurrencyRepository(db)
const currencyService = createCurrencyService({ currencyRepo })
const currencyController = createCurrencyController(currencyService)

syncRegistry.register(currencySyncHandler)

export const currencyRouter = createCurrencyRouter(currencyController)
export type { Currency } from './currency.entity'
