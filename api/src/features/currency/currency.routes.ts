import { Router } from 'express'
import { authenticate } from '@/core/middleware'
import type { CurrencyController } from './currency.controller'

export const createCurrencyRouter = (currencyController: CurrencyController): Router => {
  const router = Router()

  router.get('/', authenticate, currencyController.list)

  return router
}
