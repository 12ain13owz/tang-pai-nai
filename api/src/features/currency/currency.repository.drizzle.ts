import { asc, eq, gt } from 'drizzle-orm'
import type { Executor } from '@/core/database'
import { currencies } from '@/core/database/schema/currency'
import { wrapUnexpected } from '@/core/error'
import type { SyncTableHandler } from '@/core/sync'
import type { Currency } from './currency.entity'
import type { CurrencyRepository } from './currency.repository'

const toCurrency = (row: typeof currencies.$inferSelect): Currency => ({ ...row })

export const createDrizzleCurrencyRepository = (db: Executor): CurrencyRepository => ({
  listActive: async () =>
    wrapUnexpected(
      async () => {
        const rows = await db
          .select()
          .from(currencies)
          .where(eq(currencies.isActive, true))
          .orderBy(asc(currencies.sortOrder), asc(currencies.code))
        return rows.map(toCurrency)
      },
      { operation: 'currencyRepository.listActive' }
    ),
})

/**
 * Master data for `/sync/pull` (offline-sync → tables synced in 4a.2): every currency, inactive
 * ones too, for every user. Pull-only, so there's no push half. A row's sync id is its `code`.
 */
export const currencySyncHandler: SyncTableHandler = {
  table: 'currencies',
  pull: async (executor, _userId, since, limit) =>
    wrapUnexpected(
      async () => {
        const rows = await executor
          .select()
          .from(currencies)
          .where(gt(currencies.changeSeq, since))
          .orderBy(asc(currencies.changeSeq))
          .limit(limit)
        return rows.map((row) => ({ id: row.code, ...toCurrency(row) }))
      },
      { operation: 'currencySync.pull', metadata: { since } }
    ),
}
