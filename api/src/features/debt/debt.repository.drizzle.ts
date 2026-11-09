import { and, asc, eq, gt, isNull, lt, max, sql } from 'drizzle-orm'
import type { Executor } from '@/core/database'
import { findMergeTarget } from '@/core/database/category-merge'
import { checkDebtLink } from '@/core/database/debt-link'
import { categories } from '@/core/database/schema/category'
import { currencies } from '@/core/database/schema/currency'
import { debtEntries, debts } from '@/core/database/schema/debt'
import { profiles } from '@/core/database/schema/profile'
import { wallets } from '@/core/database/schema/wallet'
import { wrapUnexpected } from '@/core/error'
import type { SyncRowInput, SyncTableHandler } from '@/core/sync'
import { DEBT_ENTRY_MESSAGE, DEBT_LIMITS, DEBT_MESSAGE, DebtCountAs } from './debt.const'
import { validateDebt, validateDebtEntry } from './debt.schema'
import type { Debt, DebtEntry } from './debt.entity'

type DebtRow = typeof debts.$inferSelect
type EntryRow = typeof debtEntries.$inferSelect

const toDebt = ({ userId: _userId, ...row }: DebtRow): Debt => row
const toEntry = ({ userId: _userId, ...row }: EntryRow): DebtEntry => row

const run = async <T>(operation: string, work: () => Promise<T>, metadata?: object) =>
  wrapUnexpected(work, { operation: `debtSync.${operation}`, metadata: { ...metadata } })

const text = (value: unknown) => (typeof value === 'string' ? value : null)

const findDebtRow = async (executor: Executor, id: string) =>
  (await executor.select().from(debts).where(eq(debts.id, id))).at(0)

const findEntryRow = async (executor: Executor, id: string) =>
  (await executor.select().from(debtEntries).where(eq(debtEntries.id, id))).at(0)

const isLiveProfile = async (executor: Executor, userId: string, profileId: string) => {
  const rows = await executor
    .select({ id: profiles.id })
    .from(profiles)
    .where(and(eq(profiles.id, profileId), eq(profiles.userId, userId), isNull(profiles.deletedAt)))
  return rows.length > 0
}

/**
 * What is left of each open debt (debt.md → Data model): Σ principal − Σ repayment − the linked
 * transactions that settle it: the instalments (expenses) of a `repaid` debt. Interest and a
 * forgiven rest's transaction don't (its repayment entry does, debt rule 4).
 */
const OPEN_DEBTS = (profileId: string, exceptId: string) => sql`
  SELECT count(*) AS total FROM debts d
   WHERE d.profile_id = ${profileId} AND d.deleted_at IS NULL AND d.id <> ${exceptId}
     AND coalesce((SELECT sum(CASE e.kind WHEN 'principal' THEN e.amount ELSE -e.amount END)
                     FROM debt_entries e WHERE e.debt_id = d.id AND e.deleted_at IS NULL), 0)
       - coalesce((SELECT sum(t.amount) FROM transactions t
                     JOIN categories c ON c.id = t.category_id
                    WHERE t.debt_id = d.id AND t.deleted_at IS NULL
                      AND d.count_as = 'repaid' AND c.type = 'expense'), 0) <> 0`

/** Rule 1's category of a `repaid` debt; the message or null. */
const checkCategory = async (
  executor: Executor,
  userId: string,
  categoryId: string,
  profileId: string
): Promise<string | null> => {
  const category = (
    await executor
      .select({
        userId: categories.userId,
        profileId: categories.profileId,
        type: categories.type,
        deletedAt: categories.deletedAt,
      })
      .from(categories)
      .where(eq(categories.id, categoryId))
  ).at(0)
  if (!category || category.userId !== userId || category.deletedAt !== null) {
    return DEBT_MESSAGE.CATEGORY_GONE
  }
  return category.profileId === profileId && category.type === 'expense'
    ? null
    : DEBT_MESSAGE.CATEGORY_NOT_EXPENSE
}

/** Rule 2: direction, way of counting and currency never change. */
const changesFixed = (stored: DebtRow, row: SyncRowInput) =>
  stored.direction !== row.direction ||
  stored.countAs !== row.countAs ||
  stored.currencyCode !== row.currencyCode

const isActiveCurrency = async (executor: Executor, code: string) => {
  const rows = await executor
    .select({ code: currencies.code })
    .from(currencies)
    .where(and(eq(currencies.code, code), eq(currencies.isActive, true)))
  return rows.length > 0
}

/** Rules a device can't check offline (debt rules 1–2); the message or null. */
const checkDebt = async (
  executor: Executor,
  userId: string,
  row: SyncRowInput
): Promise<string | null> => {
  // A tombstone breaks no rule (offline-sync rule 10: deletes run no check).
  if (row.deletedAt !== null) {
    return null
  }
  const profileId = String(row.profileId)
  const stored = await findDebtRow(executor, row.id)
  if (stored && stored.profileId !== profileId) {
    return DEBT_MESSAGE.PROFILE_FIXED
  }
  if (stored && changesFixed(stored, row)) {
    return DEBT_MESSAGE.FIXED
  }
  if (!(await isLiveProfile(executor, userId, profileId))) {
    return DEBT_MESSAGE.PROFILE_GONE
  }
  if (!stored && !(await isActiveCurrency(executor, String(row.currencyCode)))) {
    return DEBT_MESSAGE.CURRENCY_INACTIVE
  }
  if (typeof row.categoryId === 'string') {
    const broken = await checkCategory(executor, userId, row.categoryId, profileId)
    if (broken) {
      return broken
    }
  }
  // Rule 1: at most 100 open debts per profile; a stored live one already counts.
  if (stored && stored.deletedAt === null) {
    return null
  }
  const [{ total }] = (await executor.all(OPEN_DEBTS(profileId, row.id))) as [{ total: number }]
  return total >= DEBT_LIMITS.OPEN_PER_PROFILE ? DEBT_MESSAGE.LIMIT : null
}

/** Category rule 15: a `repaid` debt on a merged category follows it to its target. */
const resolveDebt = async (
  executor: Executor,
  userId: string,
  row: SyncRowInput
): Promise<SyncRowInput> => {
  if (row.deletedAt !== null || typeof row.categoryId !== 'string') {
    return row
  }
  const target = await findMergeTarget(executor, userId, row.categoryId)
  return target ? { ...row, categoryId: target.id } : row
}

const LINK_MESSAGE = new Map<string, string>([
  ['gone', DEBT_ENTRY_MESSAGE.DEBT_GONE],
  ['otherProfile', DEBT_ENTRY_MESSAGE.OTHER_PROFILE],
  ['otherCurrency', DEBT_ENTRY_MESSAGE.OTHER_CURRENCY],
])

/** Rule 6: the owner's live wallet of the entry's profile; the message or null. */
const checkEntryWallet = async (
  executor: Executor,
  userId: string,
  walletId: string,
  profileId: string
): Promise<string | null> => {
  const wallet = (
    await executor
      .select({
        userId: wallets.userId,
        profileId: wallets.profileId,
        deletedAt: wallets.deletedAt,
      })
      .from(wallets)
      .where(eq(wallets.id, walletId))
  ).at(0)
  if (!wallet || wallet.userId !== userId || wallet.deletedAt !== null) {
    return DEBT_ENTRY_MESSAGE.WALLET_GONE
  }
  return wallet.profileId === profileId ? null : DEBT_ENTRY_MESSAGE.OTHER_PROFILE
}

/** Rule 6: the entry's debt and wallet; the message or null. */
const checkEntry = async (
  executor: Executor,
  userId: string,
  row: SyncRowInput
): Promise<string | null> => {
  if (row.deletedAt !== null) {
    return null
  }
  const profileId = String(row.profileId)
  const stored = await findEntryRow(executor, row.id)
  if (stored && stored.profileId !== profileId) {
    return DEBT_ENTRY_MESSAGE.PROFILE_FIXED
  }
  if (stored && stored.debtId !== row.debtId) {
    return DEBT_ENTRY_MESSAGE.DEBT_FIXED
  }
  if (!(await isLiveProfile(executor, userId, profileId))) {
    return DEBT_ENTRY_MESSAGE.PROFILE_GONE
  }
  const walletId = text(row.walletId)
  const walletError =
    walletId === null ? null : await checkEntryWallet(executor, userId, walletId, profileId)
  if (walletError) {
    return walletError
  }
  const link = await checkDebtLink(executor, userId, String(row.debtId), profileId, walletId)
  const linkError = LINK_MESSAGE.get(link.status)
  if (linkError) {
    return linkError
  }
  if (walletId === null) {
    const debt = await findDebtRow(executor, String(row.debtId))
    if (debt?.countAs !== DebtCountAs.REPAID) {
      return DEBT_ENTRY_MESSAGE.NO_WALLET
    }
  }
  return null
}

/**
 * Debt rule 5: an entry pushed after its debt was deleted (a device that added it offline) goes
 * with the debt, quietly, instead of being refused: the device deletes it on the pull anyway.
 */
const resolveEntry = async (
  executor: Executor,
  userId: string,
  row: SyncRowInput
): Promise<SyncRowInput> => {
  if (row.deletedAt !== null) {
    return row
  }
  const debt = await findDebtRow(executor, String(row.debtId))
  return debt && debt.userId === userId && debt.deletedAt !== null
    ? { ...row, deletedAt: Math.max(row.updatedAt, debt.deletedAt) }
    : row
}

const purgeOld = async (
  executor: Executor,
  table: typeof debts | typeof debtEntries,
  before: number
) => {
  const old = lt(table.deletedAt, before)
  const [{ maxSeq }] = await executor
    .select({ maxSeq: max(table.changeSeq) })
    .from(table)
    .where(old)
  const removed = await executor.delete(table).where(old).returning({ id: table.id })
  return { removed: removed.length, maxSeq: maxSeq ?? 0 }
}

/** The debts table's sync handler (docs/features/debt.md rule 1). */
export const debtSyncHandler: SyncTableHandler = {
  table: 'debts',
  pull: async (executor, userId, since, limit) =>
    run('pull', async () => {
      const rows = await executor
        .select()
        .from(debts)
        .where(and(eq(debts.userId, userId), gt(debts.changeSeq, since)))
        .orderBy(asc(debts.changeSeq))
        .limit(limit)
      return rows.map(toDebt)
    }),
  push: {
    validate: validateDebt,
    find: async (executor, id) =>
      run(
        'find',
        async () => {
          const row = await findDebtRow(executor, id)
          return row ? { ownerId: row.userId, row: toDebt(row) } : null
        },
        { id }
      ),
    resolve: async (executor, userId, row) =>
      run('resolve', async () => resolveDebt(executor, userId, row), { id: row.id }),
    check: async (executor, userId, row) =>
      run('check', async () => checkDebt(executor, userId, row), { id: row.id }),
    write: async (executor, userId, row) =>
      run(
        'write',
        async () => {
          const values = {
            id: row.id,
            userId,
            profileId: String(row.profileId),
            direction: String(row.direction),
            person: String(row.person),
            note: typeof row.note === 'string' ? row.note : '',
            currencyCode: String(row.currencyCode),
            countAs: String(row.countAs),
            categoryId: text(row.categoryId),
            dueOn: text(row.dueOn),
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
            deletedAt: row.deletedAt,
            changeSeq: row.changeSeq,
            updatedBy: row.updatedBy,
          }
          const [written] = await executor
            .insert(debts)
            .values(values)
            .onConflictDoUpdate({ target: debts.id, set: values })
            .returning()
          return toDebt(written)
        },
        { id: row.id }
      ),
    purge: async (executor, before) => run('purge', async () => purgeOld(executor, debts, before)),
  },
}

/** The debt_entries table's sync handler (debt rule 6). */
export const debtEntrySyncHandler: SyncTableHandler = {
  table: 'debt_entries',
  pull: async (executor, userId, since, limit) =>
    run('pullEntries', async () => {
      const rows = await executor
        .select()
        .from(debtEntries)
        .where(and(eq(debtEntries.userId, userId), gt(debtEntries.changeSeq, since)))
        .orderBy(asc(debtEntries.changeSeq))
        .limit(limit)
      return rows.map(toEntry)
    }),
  push: {
    // Debt rule 13 (recurring rule 9): two devices record one repayment of a rule under the
    // same id; the second create keeps the server's row.
    keepsStored: (row) => typeof row.recurringId === 'string',
    validate: validateDebtEntry,
    find: async (executor, id) =>
      run(
        'findEntry',
        async () => {
          const row = await findEntryRow(executor, id)
          return row ? { ownerId: row.userId, row: toEntry(row) } : null
        },
        { id }
      ),
    resolve: async (executor, userId, row) =>
      run('resolveEntry', async () => resolveEntry(executor, userId, row), { id: row.id }),
    check: async (executor, userId, row) =>
      run('checkEntry', async () => checkEntry(executor, userId, row), { id: row.id }),
    write: async (executor, userId, row) =>
      run(
        'writeEntry',
        async () => {
          const values = {
            id: row.id,
            userId,
            profileId: String(row.profileId),
            debtId: String(row.debtId),
            kind: String(row.kind),
            walletId: text(row.walletId),
            amount: Number(row.amount),
            occurredOn: String(row.occurredOn),
            note: typeof row.note === 'string' ? row.note : '',
            recurringId: text(row.recurringId),
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
            deletedAt: row.deletedAt,
            changeSeq: row.changeSeq,
            updatedBy: row.updatedBy,
          }
          const [written] = await executor
            .insert(debtEntries)
            .values(values)
            .onConflictDoUpdate({ target: debtEntries.id, set: values })
            .returning()
          return toEntry(written)
        },
        { id: row.id }
      ),
    purge: async (executor, before) =>
      run('purgeEntries', async () => purgeOld(executor, debtEntries, before)),
  },
}
