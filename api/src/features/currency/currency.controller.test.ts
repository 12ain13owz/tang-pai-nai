import express from 'express'
import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { errorHandler } from '@/core/error'
import { accessTokens } from '@/core/security'
import { HttpStatus } from '@/shared/constants'
import type { AppResponse } from '@/shared/types'
import { createCurrencyController } from './currency.controller'
import { createCurrencyRouter } from './currency.routes'
import { createCurrencyService } from './currency.service'
import type { Currency } from './currency.entity'

const THB: Currency = {
  code: 'THB',
  minorUnit: 2,
  isActive: true,
  sortOrder: 0,
  createdAt: 1,
  updatedAt: 1,
  changeSeq: 1,
}

const buildApp = () => {
  const service = createCurrencyService({
    currencyRepo: { listActive: async () => Promise.resolve([THB]) },
  })
  const app = express()
  app.use('/currencies', createCurrencyRouter(createCurrencyController(service)))
  app.use(errorHandler)
  return app
}

describe('GET /currencies', () => {
  it('lists the active currencies', async () => {
    const token = await accessTokens.sign({ sub: 'alice', sid: 'family-1' })
    const res = await request(buildApp()).get('/currencies').set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(HttpStatus.OK)
    expect((res.body as AppResponse<Currency[]>).data).toEqual([THB])
  })

  it('needs a bearer token', async () => {
    const res = await request(buildApp()).get('/currencies')
    expect(res.status).toBe(HttpStatus.UNAUTHORIZED)
  })
})
