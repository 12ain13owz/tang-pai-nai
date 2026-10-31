import { migrate } from 'drizzle-orm/libsql/migrator'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { env } from '@/core/config'
import type { Database } from '@/core/database'
import { createDatabase } from '@/core/database/client'
import { currencies } from '@/core/database/schema/currency'
import { createDrizzleCurrencyRepository, currencySyncHandler } from './currency.repository.drizzle'

let dir: string
let close: () => void
let db: Database

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'tpn-currency-'))
  const created = createDatabase({ ...env, DATABASE_URL: `file:${join(dir, 'test.db')}` })
  await migrate(created.db, { migrationsFolder: 'drizzle' })
  db = created.db
  close = () => created.client.close()
})

afterEach(() => {
  close()
  rmSync(dir, { recursive: true, force: true })
})

describe('createDrizzleCurrencyRepository', () => {
  it('lists only THB at launch (the seed migration)', async () => {
    const list = await createDrizzleCurrencyRepository(db).listActive()
    expect(list).toMatchObject([{ code: 'THB', minorUnit: 2, isActive: true, changeSeq: 1 }])
  })

  it('orders active currencies by sortOrder, then code', async () => {
    await db.update(currencies).set({ isActive: true, sortOrder: 0 }) // every row ties
    const list = await createDrizzleCurrencyRepository(db).listActive()
    expect(list.map((currency) => currency.code).slice(0, 4)).toEqual(['AUD', 'CNY', 'EUR', 'GBP'])
  })
})

describe('currencySyncHandler', () => {
  it('pulls every currency, inactive ones too, keyed by code, after the cursor', async () => {
    const rows = await currencySyncHandler.pull(db, 'anyone', 12, 10)
    expect(rows).toMatchObject([
      { id: 'LAK', code: 'LAK', changeSeq: 13, isActive: false },
      { id: 'MYR', changeSeq: 14 },
    ])
    expect(await currencySyncHandler.pull(db, 'anyone', 0, 3)).toHaveLength(3)
    expect(currencySyncHandler.push).toBeUndefined()
  })
})
