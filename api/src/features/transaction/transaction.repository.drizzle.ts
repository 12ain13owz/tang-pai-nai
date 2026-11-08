import { and, asc, eq, gt, isNull, lt, max } from 'drizzle-orm'
import type { Executor } from '@/core/database'
import { findMergeTarget } from '@/core/database/category-merge'
import { categories } from '@/core/database/schema/category'
import { profiles } from '@/core/database/schema/profile'
import { transactions } from '@/core/database/schema/transaction'
import { wallets } from '@/core/database/schema/wallet'
import { wrapUnexpected } from '@/core/error'
import type { SyncRowInput, SyncTableHandler } from '@/core/sync'
import { TRANSACTION_MESSAGE } from './transaction.const'
import { validateTransaction } from './transaction.schema'
import type { Transaction } from './transaction.entity'

type TransactionRow = typeof transactions.$inferSelect

const toTransaction = ({ userId: _userId, ...row }: TransactionRow): Transaction => row

const run = async <T>(operation: string, work: () => Promise<T>, metadata?: object) =>
  wrapUnexpected(work, { operation: `transactionSync.${operation}`, metadata: { ...metadata } })

const findRow = async (executor: Executor, id: string) =>
  (await executor.select().from(transactions).where(eq(transactions.id, id))).at(0)

const findWallet = async (executor: Executor, id: string) =>
  (
    await executor
      .select({
        userId: wallets.userId,
        profileId: wallets.profileId,
        currencyCode: wallets.currencyCode,
        deletedAt: wallets.deletedAt,
      })
      .from(wallets)
      .where(eq(wallets.id, id))
  ).at(0)

/** Rule 1: one of the owner's live profiles. */
const isLiveProfile = async (executor: Executor, userId: string, profileId: string) => {
  const rows = await executor
    .select({ id: profiles.id })
    .from(profiles)
    .where(and(eq(profiles.id, profileId), eq(profiles.userId, userId), isNull(profiles.deletedAt)))
  return rows.length > 0
}

const findCategory = async (executor: Executor, id: string) =>
  (
    await executor
      .select({
        userId: categories.userId,
        profileId: categories.profileId,
        deletedAt: categories.deletedAt,
      })
      .from(categories)
      .where(eq(categories.id, id))
  ).at(0)

type Parent = { userId: string; profileId: string; deletedAt: number | null } | undefined

/** Rule 1: the owner's live row; archived ones are fine (rule 2). */
const isOwnLive = (parent: Parent, userId: string) =>
  parent !== undefined && parent.userId === userId && parent.deletedAt === null

/** Rule 1's wallet and category, and rule 5; the message or null. */
const checkParents = async (
  executor: Executor,
  userId: string,
  row: SyncRowInput,
  stored: TransactionRow | undefined
): Promise<string | null> => {
  const profileId = String(row.profileId)
  const walletId = String(row.walletId)
  const wallet = await findWallet(executor, walletId)
  if (!wallet || !isOwnLive(wallet, userId)) {
    return TRANSACTION_MESSAGE.WALLET_GONE
  }
  const category = await findCategory(executor, String(row.categoryId))
  if (!category || !isOwnLive(category, userId)) {
    return TRANSACTION_MESSAGE.CATEGORY_GONE
  }
  if (wallet.profileId !== profileId || category.profileId !== profileId) {
    return TRANSACTION_MESSAGE.OTHER_PROFILE
  }
  // Rule 5: moving to another wallet keeps the currency.
  if (stored && stored.walletId !== walletId) {
    const before = await findWallet(executor, stored.walletId)
    if (before && before.currencyCode !== wallet.currencyCode) {
      return TRANSACTION_MESSAGE.CURRENCY_FIXED
    }
  }
  return null
}

/**
 * Category rule 15: a live row on a merged category (added or edited on a device that hadn't
 * pulled the merge) moves to the category it was merged into, instead of being refused.
 */
const followMergedCategory = async (
  executor: Executor,
  userId: string,
  row: SyncRowInput
): Promise<SyncRowInput> => {
  if (row.deletedAt !== null) {
    return row
  }
  const target = await findMergeTarget(executor, userId, String(row.categoryId))
  return target ? { ...row, categoryId: target.id } : row
}

/** Rules a device can't check offline (transaction rules 1, 5); the message or null. */
const checkTransaction = async (
  executor: Executor,
  userId: string,
  row: SyncRowInput
): Promise<string | null> => {
  // A tombstone breaks no rule (offline-sync rule 10: deletes run no check).
  if (row.deletedAt !== null) {
    return null
  }
  const profileId = String(row.profileId)
  const stored = await findRow(executor, row.id)
  if (stored && stored.profileId !== profileId) {
    return TRANSACTION_MESSAGE.PROFILE_FIXED
  }
  if (!(await isLiveProfile(executor, userId, profileId))) {
    return TRANSACTION_MESSAGE.PROFILE_GONE
  }
  return checkParents(executor, userId, row, stored)
}

/** An occurrence of a recurring rule (docs/features/recurring.md rule 9). */
const isOccurrence = (row: SyncRowInput) => typeof row.recurringId === 'string'

/** The transactions table's sync handler (docs/features/transaction.md rule 1). */
export const transactionSyncHandler: SyncTableHandler = {
  table: 'transactions',
  pull: async (executor, userId, since, limit) =>
    run('pull', async () => {
      const rows = await executor
        .select()
        .from(transactions)
        .where(and(eq(transactions.userId, userId), gt(transactions.changeSeq, since)))
        .orderBy(asc(transactions.changeSeq))
        .limit(limit)
      return rows.map(toTransaction)
    }),
  push: {
    // Recurring rule 9: two devices record one occurrence under the same id; the second create
    // keeps the server's row (maybe edited or skipped since).
    keepsStored: isOccurrence,
    validate: validateTransaction,
    find: async (executor, id) =>
      run(
        'find',
        async () => {
          const row = await findRow(executor, id)
          return row ? { ownerId: row.userId, row: toTransaction(row) } : null
        },
        { id }
      ),
    resolve: async (executor, userId, row) =>
      run('resolve', async () => followMergedCategory(executor, userId, row), { id: row.id }),
    check: async (executor, userId, row) =>
      run('check', async () => checkTransaction(executor, userId, row), { id: row.id }),
    write: async (executor, userId, row) =>
      run(
        'write',
        async () => {
          const values = {
            id: row.id,
            userId,
            profileId: String(row.profileId),
            walletId: String(row.walletId),
            categoryId: String(row.categoryId),
            amount: Number(row.amount),
            occurredOn: String(row.occurredOn),
            note: typeof row.note === 'string' ? row.note : '',
            excludeFromReport: row.excludeFromReport === true,
            recurringId: typeof row.recurringId === 'string' ? row.recurringId : null,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
            deletedAt: row.deletedAt,
            changeSeq: row.changeSeq,
            updatedBy: row.updatedBy,
          }
          const [written] = await executor
            .insert(transactions)
            .values(values)
            .onConflictDoUpdate({ target: transactions.id, set: values })
            .returning()
          return toTransaction(written)
        },
        { id: row.id }
      ),
    purge: async (executor, before) =>
      run('purge', async () => {
        const old = lt(transactions.deletedAt, before)
        const [{ maxSeq }] = await executor
          .select({ maxSeq: max(transactions.changeSeq) })
          .from(transactions)
          .where(old)
        const removed = await executor
          .delete(transactions)
          .where(old)
          .returning({ id: transactions.id })
        return { removed: removed.length, maxSeq: maxSeq ?? 0 }
      }),
  },
}
