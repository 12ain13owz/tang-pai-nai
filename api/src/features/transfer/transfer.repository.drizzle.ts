import { and, asc, eq, gt, isNull, lt, max } from 'drizzle-orm'
import type { Executor } from '@/core/database'
import { profiles } from '@/core/database/schema/profile'
import { transfers } from '@/core/database/schema/transfer'
import { wallets } from '@/core/database/schema/wallet'
import { wrapUnexpected } from '@/core/error'
import type { SyncRowInput, SyncTableHandler } from '@/core/sync'
import { TRANSFER_MESSAGE } from './transfer.const'
import { validateTransfer } from './transfer.schema'
import type { Transfer } from './transfer.entity'

type TransferRow = typeof transfers.$inferSelect

const toTransfer = ({ userId: _userId, ...row }: TransferRow): Transfer => row

const run = async <T>(operation: string, work: () => Promise<T>, metadata?: object) =>
  wrapUnexpected(work, { operation: `transferSync.${operation}`, metadata: { ...metadata } })

const findRow = async (executor: Executor, id: string) =>
  (await executor.select().from(transfers).where(eq(transfers.id, id))).at(0)

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

type FoundWallet = Awaited<ReturnType<typeof findWallet>>

/** Rule 1: the owner's live wallet; archived ones are fine (rule 2). */
const isOwnLive = (wallet: FoundWallet, userId: string): wallet is NonNullable<FoundWallet> =>
  wallet !== undefined && wallet.userId === userId && wallet.deletedAt === null

const isLiveProfile = async (executor: Executor, userId: string, profileId: string) => {
  const rows = await executor
    .select({ id: profiles.id })
    .from(profiles)
    .where(and(eq(profiles.id, profileId), eq(profiles.userId, userId), isNull(profiles.deletedAt)))
  return rows.length > 0
}

/** Rules a device can't check offline (transfer rule 1); the message or null. */
const checkTransfer = async (
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
    return TRANSFER_MESSAGE.PROFILE_FIXED
  }
  if (!(await isLiveProfile(executor, userId, profileId))) {
    return TRANSFER_MESSAGE.PROFILE_GONE
  }
  const from = await findWallet(executor, String(row.fromWalletId))
  if (!isOwnLive(from, userId)) {
    return TRANSFER_MESSAGE.FROM_GONE
  }
  const to = await findWallet(executor, String(row.toWalletId))
  if (!isOwnLive(to, userId)) {
    return TRANSFER_MESSAGE.TO_GONE
  }
  if (from.profileId !== profileId || to.profileId !== profileId) {
    return TRANSFER_MESSAGE.OTHER_PROFILE
  }
  if (from.currencyCode !== to.currencyCode) {
    return TRANSFER_MESSAGE.OTHER_CURRENCY
  }
  return null
}

/** The transfers table's sync handler (docs/features/transfer.md rule 1). */
export const transferSyncHandler: SyncTableHandler = {
  table: 'transfers',
  pull: async (executor, userId, since, limit) =>
    run('pull', async () => {
      const rows = await executor
        .select()
        .from(transfers)
        .where(and(eq(transfers.userId, userId), gt(transfers.changeSeq, since)))
        .orderBy(asc(transfers.changeSeq))
        .limit(limit)
      return rows.map(toTransfer)
    }),
  push: {
    validate: validateTransfer,
    find: async (executor, id) =>
      run(
        'find',
        async () => {
          const row = await findRow(executor, id)
          return row ? { ownerId: row.userId, row: toTransfer(row) } : null
        },
        { id }
      ),
    check: async (executor, userId, row) =>
      run('check', async () => checkTransfer(executor, userId, row), { id: row.id }),
    write: async (executor, userId, row) =>
      run(
        'write',
        async () => {
          const values = {
            id: row.id,
            userId,
            profileId: String(row.profileId),
            fromWalletId: String(row.fromWalletId),
            toWalletId: String(row.toWalletId),
            amount: Number(row.amount),
            occurredOn: String(row.occurredOn),
            note: typeof row.note === 'string' ? row.note : '',
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
            deletedAt: row.deletedAt,
            changeSeq: row.changeSeq,
            updatedBy: row.updatedBy,
          }
          const [written] = await executor
            .insert(transfers)
            .values(values)
            .onConflictDoUpdate({ target: transfers.id, set: values })
            .returning()
          return toTransfer(written)
        },
        { id: row.id }
      ),
    purge: async (executor, before) =>
      run('purge', async () => {
        const old = lt(transfers.deletedAt, before)
        const [{ maxSeq }] = await executor
          .select({ maxSeq: max(transfers.changeSeq) })
          .from(transfers)
          .where(old)
        const removed = await executor.delete(transfers).where(old).returning({ id: transfers.id })
        return { removed: removed.length, maxSeq: maxSeq ?? 0 }
      }),
  },
}
