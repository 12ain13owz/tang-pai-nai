import { HttpStatus, SUCCESS } from '@/shared/constants'
import { createResponse } from '@/shared/utils'
import type { Currency } from './currency.entity'
import type { CurrencyService } from './currency.service'
import type { NextFunction, Request, Response } from 'express'

export const createCurrencyController = (currencyService: CurrencyService) => {
  const list = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const data: Currency[] = await currencyService.listActive()
      const response = createResponse(SUCCESS.list('currencies'), data)
      res.status(HttpStatus.OK).json(response)
    } catch (error) {
      next(error)
    }
  }

  return { list }
}

export type CurrencyController = ReturnType<typeof createCurrencyController>
