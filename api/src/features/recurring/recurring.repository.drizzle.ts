import { and, asc, count, eq, gt, isNull, lt, max, ne } from 'drizzle-orm'
import type { Executor } from '@/core/database'
import { findMergeTarget } from '@/core/database/category-merge'
import { categories } from '@/core/database/schema/category'
import { profiles } from '@/core/database/schema/profile'
import { recurringRules } from '@/core/database/schema/recurring'
import { wallets } from '@/core/database/schema/wallet'
import { wrapUnexpected } from '@/core/error'
import type { SyncRowInput, SyncTableHandler } from '@/core/sync'
import { RECURRING_LIMITS, RECURRING_MESSAGE, RecurringKind } from './recurring.const'
import { validateRecurringRule } from './recurring.schema'
import type { RecurringRule } from './recurring.entity'

type RuleRow = typeof recurringRules.$inferSelect

const toRule = ({ userId: _userId, ...row }: RuleRow): RecurringRule => row

const run = async <T>(operation: string, work: () => Promise<T>, metadata?: object) =>
  wrapUnexpected(work, { operation: `recurringSync.${operation}`, metadata: { ...metadata } })

const findRow = async (executor: Executor, id: string) =>
  (await executor.select().from(recurringRules).where(eq(recurringRules.id, id))).at(0)

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

/** Rule 1: the owner's live row; archived ones are fine (they pause the rule, rule 12). */
const isOwnLive = (parent: Parent, userId: string): parent is NonNullable<Parent> =>
  parent !== undefined && parent.userId === userId && parent.deletedAt === null

const isLiveProfile = async (executor: Executor, userId: string, profileId: string) => {
  const rows = await executor
    .select({ id: profiles.id })
    .from(profiles)
    .where(and(eq(profiles.id, profileId), eq(profiles.userId, userId), isNull(profiles.deletedAt)))
  return rows.length > 0
}

/** Rule 1's wallets and category; the message or null. */
const checkParents = async (
  executor: Executor,
  userId: string,
  row: SyncRowInput,
  profileId: string
): Promise<string | null> => {
  const wallet = await findWallet(executor, String(row.walletId))
  if (!isOwnLive(wallet, userId)) {
    return RECURRING_MESSAGE.WALLET_GONE
  }
  if (wallet.profileId !== profileId) {
    return RECURRING_MESSAGE.OTHER_PROFILE
  }
  if (row.kind === RecurringKind.TRANSFER) {
    const to = await findWallet(executor, String(row.toWalletId))
    if (!isOwnLive(to, userId)) {
      return RECURRING_MESSAGE.TO_WALLET_GONE
    }
    if (to.profileId !== profileId) {
      return RECURRING_MESSAGE.OTHER_PROFILE
    }
    return to.currencyCode === wallet.currencyCode ? null : RECURRING_MESSAGE.OTHER_CURRENCY
  }
  const category = await findCategory(executor, String(row.categoryId))
  if (!isOwnLive(category, userId)) {
    return RECURRING_MESSAGE.CATEGORY_GONE
  }
  return category.profileId === profileId ? null : RECURRING_MESSAGE.OTHER_PROFILE
}

/** Rules a device can't check offline (recurring rule 1); the message or null. */
const checkRule = async (
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
    return RECURRING_MESSAGE.PROFILE_FIXED
  }
  if (!(await isLiveProfile(executor, userId, profileId))) {
    return RECURRING_MESSAGE.PROFILE_GONE
  }
  const broken = await checkParents(executor, userId, row, profileId)
  if (broken) {
    return broken
  }
  // Rule 1: at most 100 live rules per profile (a stored live one already counts).
  if (stored && stored.deletedAt === null) {
    return null
  }
  const [{ total }] = await executor
    .select({ total: count() })
    .from(recurringRules)
    .where(
      and(
        eq(recurringRules.profileId, profileId),
        isNull(recurringRules.deletedAt),
        ne(recurringRules.id, row.id)
      )
    )
  return total >= RECURRING_LIMITS.PER_PROFILE ? RECURRING_MESSAGE.LIMIT : null
}

const SCHEDULE = ['startOn', 'frequency', 'interval', 'endOn', 'endCount'] as const

/** `nextOn` only moves forward: null (ended) is the furthest. */
const laterNext = (a: string | null, b: string | null) => {
  if (a === null || b === null) {
    return null
  }
  return a > b ? a : b
}

/** A row's fields as a map, so a list of keys can be compared. */
const fieldsOf = (row: Record<string, unknown>) => new Map(Object.entries(row))

/** Whether `a` and `b` agree on every one of `keys` (a missing field counts as null). */
const agree = (a: Record<string, unknown>, b: Record<string, unknown>, keys: readonly string[]) => {
  const left = fieldsOf(a)
  const right = fieldsOf(b)
  return keys.every((key) => (left.get(key) ?? null) === (right.get(key) ?? null))
}

/**
 * Before the conflict rules: a rule on a merged category follows it (rule 13), and, with the
 * schedule unchanged, `nextOn` keeps the later of the stored and the pushed one (rule 9: two
 * devices that both recorded an occurrence never send the rule back to it).
 */
const resolveRule = async (
  executor: Executor,
  userId: string,
  row: SyncRowInput
): Promise<SyncRowInput> => {
  if (row.deletedAt !== null) {
    return row
  }
  let resolved = row
  if (typeof row.categoryId === 'string') {
    const target = await findMergeTarget(executor, userId, row.categoryId)
    if (target) {
      resolved = { ...resolved, categoryId: target.id }
    }
  }
  const stored = await findRow(executor, row.id)
  if (stored !== undefined && stored.deletedAt === null && agree(stored, row, SCHEDULE)) {
    const pushed = typeof row.nextOn === 'string' ? row.nextOn : null
    resolved = { ...resolved, nextOn: laterNext(stored.nextOn, pushed) }
  }
  return resolved
}

const CONTENT = [
  'profileId',
  'kind',
  'walletId',
  'categoryId',
  'toWalletId',
  'amount',
  'note',
  'excludeFromReport',
  ...SCHEDULE,
  'confirm',
  'isPaused',
  'deletedAt',
] as const

/** Rule 9: versions that differ only in `nextOn` (and the sync columns) are the same change. */
const sameChange = (a: Record<string, unknown>, b: Record<string, unknown>) => agree(a, b, CONTENT)

/** The recurring_rules table's sync handler (docs/features/recurring.md rule 1). */
export const recurringSyncHandler: SyncTableHandler = {
  table: 'recurring_rules',
  pull: async (executor, userId, since, limit) =>
    run('pull', async () => {
      const rows = await executor
        .select()
        .from(recurringRules)
        .where(and(eq(recurringRules.userId, userId), gt(recurringRules.changeSeq, since)))
        .orderBy(asc(recurringRules.changeSeq))
        .limit(limit)
      return rows.map(toRule)
    }),
  push: {
    validate: validateRecurringRule,
    sameChange,
    find: async (executor, id) =>
      run(
        'find',
        async () => {
          const row = await findRow(executor, id)
          return row ? { ownerId: row.userId, row: toRule(row) } : null
        },
        { id }
      ),
    resolve: async (executor, userId, row) =>
      run('resolve', async () => resolveRule(executor, userId, row), { id: row.id }),
    check: async (executor, userId, row) =>
      run('check', async () => checkRule(executor, userId, row), { id: row.id }),
    write: async (executor, userId, row) =>
      run(
        'write',
        async () => {
          const text = (value: unknown) => (typeof value === 'string' ? value : null)
          const values = {
            id: row.id,
            userId,
            profileId: String(row.profileId),
            kind: String(row.kind),
            walletId: String(row.walletId),
            categoryId: text(row.categoryId),
            toWalletId: text(row.toWalletId),
            amount: Number(row.amount),
            note: typeof row.note === 'string' ? row.note : '',
            excludeFromReport: row.excludeFromReport === true,
            startOn: String(row.startOn),
            frequency: String(row.frequency),
            interval: Number(row.interval),
            endOn: text(row.endOn),
            endCount: typeof row.endCount === 'number' ? row.endCount : null,
            confirm: row.confirm === true,
            nextOn: text(row.nextOn),
            isPaused: row.isPaused === true,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
            deletedAt: row.deletedAt,
            changeSeq: row.changeSeq,
            updatedBy: row.updatedBy,
          }
          const [written] = await executor
            .insert(recurringRules)
            .values(values)
            .onConflictDoUpdate({ target: recurringRules.id, set: values })
            .returning()
          return toRule(written)
        },
        { id: row.id }
      ),
    purge: async (executor, before) =>
      run('purge', async () => {
        const old = lt(recurringRules.deletedAt, before)
        const [{ maxSeq }] = await executor
          .select({ maxSeq: max(recurringRules.changeSeq) })
          .from(recurringRules)
          .where(old)
        const removed = await executor
          .delete(recurringRules)
          .where(old)
          .returning({ id: recurringRules.id })
        return { removed: removed.length, maxSeq: maxSeq ?? 0 }
      }),
  },
}
