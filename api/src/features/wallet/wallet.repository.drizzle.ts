import { and, asc, count, eq, gt, isNull, lt, max, ne, or, sql } from 'drizzle-orm'
import type { Executor } from '@/core/database'
import { currencies } from '@/core/database/schema/currency'
import { profiles } from '@/core/database/schema/profile'
import { recurringRules } from '@/core/database/schema/recurring'
import { transactions } from '@/core/database/schema/transaction'
import { transfers } from '@/core/database/schema/transfer'
import { wallets } from '@/core/database/schema/wallet'
import { wrapUnexpected } from '@/core/error'
import type { SyncRowInput, SyncTableHandler } from '@/core/sync'
import { WALLET_LIMITS, WALLET_MESSAGE } from './wallet.const'
import { validateWallet } from './wallet.schema'
import type { Wallet } from './wallet.entity'

type WalletRow = typeof wallets.$inferSelect

const toWallet = ({ userId: _userId, ...row }: WalletRow): Wallet => row

const run = async <T>(operation: string, work: () => Promise<T>, metadata?: object) =>
  wrapUnexpected(work, { operation: `walletSync.${operation}`, metadata: { ...metadata } })

/** The profile's other live, non-archived wallets matching `extra`. */
const countOpenOthers = async (
  executor: Executor,
  profileId: string,
  id: string,
  extra?: ReturnType<typeof sql>
) => {
  const [{ total }] = await executor
    .select({ total: count() })
    .from(wallets)
    .where(
      and(
        eq(wallets.profileId, profileId),
        isNull(wallets.deletedAt),
        eq(wallets.isArchived, false),
        ne(wallets.id, id),
        extra
      )
    )
  return total
}

/** Rules a device can't check offline (wallet rules 2–4); the broken rule's message or null. */
/** Rule 4: live transactions, transfers on either side or recurring rules use the wallet. */
const isUsed = async (executor: Executor, id: string) => {
  const used = await executor
    .select({ id: transactions.id })
    .from(transactions)
    .where(and(eq(transactions.walletId, id), isNull(transactions.deletedAt)))
    .limit(1)
  const moved = await executor
    .select({ id: transfers.id })
    .from(transfers)
    .where(
      and(
        or(eq(transfers.fromWalletId, id), eq(transfers.toWalletId, id)),
        isNull(transfers.deletedAt)
      )
    )
    .limit(1)
  // Recurring rule 15: a live rule on either side fixes it too.
  const repeats = await executor
    .select({ id: recurringRules.id })
    .from(recurringRules)
    .where(
      and(
        or(eq(recurringRules.walletId, id), eq(recurringRules.toWalletId, id)),
        isNull(recurringRules.deletedAt)
      )
    )
    .limit(1)
  return used.length > 0 || moved.length > 0 || repeats.length > 0
}

const checkWallet = async (
  executor: Executor,
  userId: string,
  row: SyncRowInput
): Promise<string | null> => {
  // A tombstone breaks no rule (offline-sync rule 10: deletes run no check).
  if (row.deletedAt !== null) {
    return null
  }
  const profileId = String(row.profileId)
  const currencyCode = String(row.currencyCode)
  const stored = (
    await executor
      .select({ profileId: wallets.profileId, currencyCode: wallets.currencyCode })
      .from(wallets)
      .where(eq(wallets.id, row.id))
  ).at(0)
  // Rule 2: one of the owner's live profiles, and a wallet never moves.
  if (stored && stored.profileId !== profileId) {
    return WALLET_MESSAGE.PROFILE_FIXED
  }
  const profile = (
    await executor
      .select({ id: profiles.id })
      .from(profiles)
      .where(
        and(eq(profiles.id, profileId), eq(profiles.userId, userId), isNull(profiles.deletedAt))
      )
  ).at(0)
  if (!profile) {
    return WALLET_MESSAGE.PROFILE_GONE
  }
  // Rule 4: a new wallet, or a changed currency, needs an active currency. A wallet keeps a
  // currency that was switched off later (currency rule 3).
  if (!stored || stored.currencyCode !== currencyCode) {
    const currency = (
      await executor
        .select({ code: currencies.code })
        .from(currencies)
        .where(and(eq(currencies.code, currencyCode), eq(currencies.isActive, true)))
    ).at(0)
    if (!currency) {
      return WALLET_MESSAGE.CURRENCY_INACTIVE
    }
  }
  // Rule 4: the currency is fixed once the wallet has live transactions or transfers
  // (transfer rule 8), or recurring rules (#12).
  if (stored && stored.currencyCode !== currencyCode && (await isUsed(executor, row.id))) {
    return WALLET_MESSAGE.CURRENCY_FIXED
  }
  // Rule 3: archived wallets neither hold a name nor count toward the 20.
  if (row.isArchived === true) {
    return null
  }
  const sameName = sql`lower(${wallets.name}) = lower(${String(row.name)})`
  if ((await countOpenOthers(executor, profileId, row.id, sameName)) > 0) {
    return WALLET_MESSAGE.NAME_TAKEN
  }
  if ((await countOpenOthers(executor, profileId, row.id)) >= WALLET_LIMITS.PER_PROFILE) {
    return WALLET_MESSAGE.TOO_MANY
  }
  return null
}

/** The wallets table's sync handler (docs/features/wallet.md rule 1). */
export const walletSyncHandler: SyncTableHandler = {
  table: 'wallets',
  pull: async (executor, userId, since, limit) =>
    run('pull', async () => {
      const rows = await executor
        .select()
        .from(wallets)
        .where(and(eq(wallets.userId, userId), gt(wallets.changeSeq, since)))
        .orderBy(asc(wallets.changeSeq))
        .limit(limit)
      return rows.map(toWallet)
    }),
  push: {
    validate: validateWallet,
    find: async (executor, id) =>
      run(
        'find',
        async () => {
          const rows = await executor.select().from(wallets).where(eq(wallets.id, id))
          const row = rows.at(0)
          return row ? { ownerId: row.userId, row: toWallet(row) } : null
        },
        { id }
      ),
    check: async (executor, userId, row) =>
      run('check', async () => checkWallet(executor, userId, row), { id: row.id }),
    write: async (executor, userId, row) =>
      run(
        'write',
        async () => {
          const values = {
            id: row.id,
            userId,
            profileId: String(row.profileId),
            name: String(row.name),
            currencyCode: String(row.currencyCode),
            initialBalance: Number(row.initialBalance),
            icon: String(row.icon),
            color: String(row.color),
            excludeFromTotal: row.excludeFromTotal === true,
            isArchived: row.isArchived === true,
            sortOrder: Number(row.sortOrder),
            // `validate` made it an array of UUIDs.
            hiddenCategoryIds: Array.isArray(row.hiddenCategoryIds)
              ? row.hiddenCategoryIds.map(String)
              : [],
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
            deletedAt: row.deletedAt,
            changeSeq: row.changeSeq,
            updatedBy: row.updatedBy,
          }
          const [written] = await executor
            .insert(wallets)
            .values(values)
            .onConflictDoUpdate({ target: wallets.id, set: values })
            .returning()
          return toWallet(written)
        },
        { id: row.id }
      ),
    purge: async (executor, before) =>
      run('purge', async () => {
        const old = lt(wallets.deletedAt, before)
        const [{ maxSeq }] = await executor
          .select({ maxSeq: max(wallets.changeSeq) })
          .from(wallets)
          .where(old)
        const removed = await executor.delete(wallets).where(old).returning({ id: wallets.id })
        return { removed: removed.length, maxSeq: maxSeq ?? 0 }
      }),
  },
}
