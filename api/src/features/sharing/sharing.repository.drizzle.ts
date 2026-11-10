import { and, asc, eq, gt, inArray, isNull, lte, sql } from 'drizzle-orm'
import type { Database, Executor } from '@/core/database'
import {
  categories,
  profiles,
  rateLimitBuckets,
  transactions,
  users,
  walletInvites,
  walletMembers,
  wallets,
} from '@/core/database/schema'
import { wrapUnexpected } from '@/core/error'
import type {
  Invite,
  MemberRow,
  RowData,
  ShareRole,
  ShareRow,
  UserRef,
  WalletRef,
} from './sharing.entity'
import type { SharingRepository } from './sharing.repository'

type InviteRow = typeof walletInvites.$inferSelect
type UserRow = typeof users.$inferSelect

const toUser = (row: UserRow): UserRef => ({
  id: row.id,
  email: row.email,
  displayName: row.displayName,
  emailVerified: row.emailVerifiedAt !== null,
})

const toInvite = (row: InviteRow): Invite => ({ ...row, walletIds: [...row.walletIds] })

// A wallet a member may see (rule 8): live, open, on a live profile.
const WALLET_COLUMNS = sql`w.id AS id, w.profile_id AS profileId, w.user_id AS ownerId,
  w.name AS name, w.icon AS icon, w.color AS color, w.currency_code AS currencyCode,
  w.initial_balance AS initialBalance, w.is_archived AS isArchived, w.sort_order AS sortOrder`
const VISIBLE = sql`w.deleted_at IS NULL AND w.is_archived = 0 AND p.deleted_at IS NULL`

const toWallet = (row: Record<string, unknown>): WalletRef => ({
  id: String(row['id']),
  profileId: String(row['profileId']),
  ownerId: String(row['ownerId']),
  name: String(row['name']),
  icon: String(row['icon']),
  color: String(row['color']),
  currencyCode: String(row['currencyCode']),
  initialBalance: Number(row['initialBalance']),
  isArchived: Boolean(row['isArchived']),
  sortOrder: Number(row['sortOrder']),
})

const idList = (ids: string[]) =>
  sql.join(
    ids.map((id) => sql`${id}`),
    sql`, `
  )

// Signed amounts per wallet, the same sums as the web's `WalletService` (wallet rule, transfer
// rule 6, debt rule 7): `excludeFromReport` rows count in a balance.
const MOVEMENTS = (ids: string[]) => sql`
  SELECT t.wallet_id AS wallet, CASE WHEN c.type = 'income' THEN t.amount ELSE -t.amount END AS amount
    FROM transactions t JOIN categories c ON c.id = t.category_id
   WHERE t.wallet_id IN (${idList(ids)}) AND t.deleted_at IS NULL
  UNION ALL
  SELECT from_wallet_id, -amount FROM transfers
   WHERE from_wallet_id IN (${idList(ids)}) AND deleted_at IS NULL
  UNION ALL
  SELECT to_wallet_id, amount FROM transfers
   WHERE to_wallet_id IN (${idList(ids)}) AND deleted_at IS NULL
  UNION ALL
  SELECT e.wallet_id, CASE WHEN (e.kind = 'principal') = (d.direction = 'borrowed')
                           THEN e.amount ELSE -e.amount END
    FROM debt_entries e JOIN debts d ON d.id = e.debt_id
   WHERE e.wallet_id IN (${idList(ids)}) AND e.deleted_at IS NULL`

// Transfer sides and debt entries per wallet: the money a member's view folds into the balance.
const OTHER_MONEY = (ids: string[]) => sql`
  SELECT x.wallet AS id, sum(x.amount) AS amount FROM (
    SELECT from_wallet_id AS wallet, -amount AS amount FROM transfers
     WHERE from_wallet_id IN (${idList(ids)}) AND deleted_at IS NULL
    UNION ALL
    SELECT to_wallet_id, amount FROM transfers
     WHERE to_wallet_id IN (${idList(ids)}) AND deleted_at IS NULL
    UNION ALL
    SELECT e.wallet_id, CASE WHEN (e.kind = 'principal') = (d.direction = 'borrowed')
                             THEN e.amount ELSE -e.amount END
      FROM debt_entries e JOIN debts d ON d.id = e.debt_id
     WHERE e.wallet_id IN (${idList(ids)}) AND e.deleted_at IS NULL
  ) x GROUP BY x.wallet`

/** A row as pull answers it: without `userId`. */
const withoutOwner = ({ userId: _userId, ...row }: { userId: string } & RowData): RowData => row

export const createDrizzleSharingRepository = (db: Database | Executor): SharingRepository => {
  const run = async <T>(operation: string, work: () => Promise<T>) =>
    wrapUnexpected(work, { operation: `sharingRepository.${operation}` })

  const all = async (query: ReturnType<typeof sql>): Promise<Record<string, unknown>[]> =>
    db.all<Record<string, unknown>>(query)

  return {
    transaction: async (work) =>
      run('transaction', async () =>
        (db as Database).transaction(async (tx) => work(createDrizzleSharingRepository(tx)))
      ),

    findUser: async (id) =>
      run('findUser', async () => {
        const row = await db.query.users.findFirst({ where: eq(users.id, id) })
        return row ? toUser(row) : null
      }),

    findUserByEmail: async (email) =>
      run('findUserByEmail', async () => {
        const row = await db.query.users.findFirst({ where: eq(users.email, email) })
        return row ? toUser(row) : null
      }),

    ownsProfile: async (userId, profileId) =>
      run('ownsProfile', async () => {
        const rows = await all(sql`SELECT 1 FROM profiles
          WHERE id = ${profileId} AND user_id = ${userId} AND deleted_at IS NULL`)
        return rows.length > 0
      }),

    profileWallets: async (profileId) =>
      run('profileWallets', async () =>
        (
          await all(sql`SELECT ${WALLET_COLUMNS} FROM wallets w
            WHERE w.profile_id = ${profileId} AND w.deleted_at IS NULL
            ORDER BY w.sort_order, w.created_at`)
        ).map(toWallet)
      ),

    openWallets: async (ids) =>
      run('openWallets', async () =>
        ids.length === 0
          ? []
          : (
              await all(sql`SELECT ${WALLET_COLUMNS} FROM wallets w
                JOIN profiles p ON p.id = w.profile_id
                WHERE w.id IN (${idList(ids)}) AND ${VISIBLE}
                ORDER BY w.sort_order, w.created_at`)
            ).map(toWallet)
      ),

    membersOf: async (profileId) =>
      run('membersOf', async () =>
        (
          await all(sql`SELECT m.user_id AS userId, u.display_name AS displayName,
              u.email AS email, m.role AS role, m.wallet_id AS walletId, m.added_at AS addedAt
            FROM wallet_members m
            JOIN wallets w ON w.id = m.wallet_id
            JOIN users u ON u.id = m.user_id
            WHERE w.profile_id = ${profileId} AND w.deleted_at IS NULL
            ORDER BY m.added_at, u.display_name`)
        ).map((row): MemberRow => ({
          userId: String(row['userId']),
          displayName: String(row['displayName']),
          email: String(row['email']),
          role: row['role'] as ShareRole,
          walletId: String(row['walletId']),
          addedAt: Number(row['addedAt']),
        }))
      ),

    setMembership: async (profileId, userId, role, walletIds, at) =>
      run('setMembership', async () => {
        const inProfile = sql`${walletMembers.walletId} IN (SELECT id FROM wallets WHERE profile_id = ${profileId})`
        const kept = await db
          .select({ walletId: walletMembers.walletId, addedAt: walletMembers.addedAt })
          .from(walletMembers)
          .where(and(eq(walletMembers.userId, userId), inProfile))
        const since = new Map(kept.map((row) => [row.walletId, row.addedAt]))
        await db.delete(walletMembers).where(and(eq(walletMembers.userId, userId), inProfile))
        if (walletIds.length > 0) {
          await db.insert(walletMembers).values(
            walletIds.map((walletId) => ({
              walletId,
              userId,
              role,
              addedAt: since.get(walletId) ?? at,
            }))
          )
        }
      }),

    sharesOf: async (userId) =>
      run('sharesOf', async () =>
        (
          await all(sql`SELECT m.role AS role, ${WALLET_COLUMNS}
            FROM wallet_members m
            JOIN wallets w ON w.id = m.wallet_id
            JOIN profiles p ON p.id = w.profile_id
            WHERE m.user_id = ${userId} AND ${VISIBLE}
            ORDER BY m.added_at, w.sort_order`)
        ).map((row): ShareRow => ({ role: row['role'] as ShareRole, wallet: toWallet(row) }))
      ),

    shareOf: async (userId, walletId) =>
      run('shareOf', async () => {
        const rows = await all(sql`SELECT m.role AS role, ${WALLET_COLUMNS}
          FROM wallet_members m
          JOIN wallets w ON w.id = m.wallet_id
          JOIN profiles p ON p.id = w.profile_id
          WHERE m.user_id = ${userId} AND m.wallet_id = ${walletId} AND ${VISIBLE}`)
        const row = rows.at(0)
        return row ? { role: row['role'] as ShareRole, wallet: toWallet(row) } : null
      }),

    invitesOf: async (profileId, now) =>
      run('invitesOf', async () =>
        (
          await db
            .select()
            .from(walletInvites)
            .where(
              and(eq(walletInvites.profileId, profileId), sql`${walletInvites.expiresAt} > ${now}`)
            )
            .orderBy(walletInvites.createdAt)
        ).map(toInvite)
      ),

    invitesTo: async (email, now) =>
      run('invitesTo', async () =>
        (
          await db
            .select()
            .from(walletInvites)
            .where(and(eq(walletInvites.email, email), sql`${walletInvites.expiresAt} > ${now}`))
            .orderBy(walletInvites.createdAt)
        ).map(toInvite)
      ),

    findInvite: async (id, now) =>
      run('findInvite', async () => {
        const row = await db.query.walletInvites.findFirst({ where: eq(walletInvites.id, id) })
        return row && row.expiresAt > now ? toInvite(row) : null
      }),

    findInviteTo: async (profileId, email, now) =>
      run('findInviteTo', async () => {
        const row = await db.query.walletInvites.findFirst({
          where: and(eq(walletInvites.profileId, profileId), eq(walletInvites.email, email)),
        })
        return row && row.expiresAt > now ? toInvite(row) : null
      }),

    createInvite: async (invite) =>
      run('createInvite', async () => {
        const [row] = await db.insert(walletInvites).values(invite).returning()
        return toInvite(row)
      }),

    markSent: async (id, at) =>
      run('markSent', async () => {
        await db.update(walletInvites).set({ lastSentAt: at }).where(eq(walletInvites.id, id))
      }),

    deleteInvite: async (id) =>
      run('deleteInvite', async () => {
        await db.delete(walletInvites).where(eq(walletInvites.id, id))
      }),

    deleteExpiredInvites: async (now) =>
      run('deleteExpiredInvites', async () => {
        await db.delete(walletInvites).where(lte(walletInvites.expiresAt, now))
      }),

    balances: async (walletIds) =>
      run('balances', async () => {
        const result = new Map<string, number>()
        if (walletIds.length === 0) {
          return result
        }
        const rows = await all(sql`SELECT w.id AS id,
            w.initial_balance + coalesce((SELECT sum(x.amount) FROM (${MOVEMENTS(walletIds)}) x
              WHERE x.wallet = w.id), 0) AS balance
          FROM wallets w WHERE w.id IN (${idList(walletIds)})`)
        for (const row of rows) {
          result.set(String(row['id']), Number(row['balance']))
        }
        return result
      }),

    otherMoney: async (walletIds) =>
      run('otherMoney', async () => {
        const result = new Map<string, number>()
        if (walletIds.length > 0) {
          for (const row of await all(OTHER_MONEY(walletIds))) {
            result.set(String(row['id']), Number(row['amount']))
          }
        }
        return result
      }),

    findProfile: async (profileId) =>
      run('findProfile', async () => {
        const row = (
          await db
            .select({
              id: profiles.id,
              name: profiles.name,
              icon: profiles.icon,
              color: profiles.color,
            })
            .from(profiles)
            .where(and(eq(profiles.id, profileId), isNull(profiles.deletedAt)))
        ).at(0)
        return row ?? null
      }),

    walletRows: async (walletIds) =>
      run('walletRows', async () =>
        walletIds.length === 0
          ? []
          : (
              await db
                .select()
                .from(wallets)
                .where(inArray(wallets.id, walletIds))
                .orderBy(asc(wallets.sortOrder), asc(wallets.createdAt))
            ).map(withoutOwner)
      ),

    categoryRows: async (profileId) =>
      run('categoryRows', async () =>
        (
          await db
            .select()
            .from(categories)
            .where(and(eq(categories.profileId, profileId), isNull(categories.deletedAt)))
            .orderBy(asc(categories.sortOrder), asc(categories.createdAt))
        ).map(withoutOwner)
      ),

    transactionRows: async (walletIds, since, limit) =>
      run('transactionRows', async () =>
        walletIds.length === 0
          ? []
          : (
              await db
                .select()
                .from(transactions)
                .where(
                  and(inArray(transactions.walletId, walletIds), gt(transactions.changeSeq, since))
                )
                .orderBy(asc(transactions.changeSeq))
                .limit(limit)
            ).map(withoutOwner)
      ),

    hitRateLimit: async (key, windowMs, at) =>
      run('hitRateLimit', async () => {
        const windowEnded = sql`${rateLimitBuckets.windowStart} <= ${at - windowMs}`
        const [row] = await db
          .insert(rateLimitBuckets)
          .values({ key, count: 1, windowStart: new Date(at) })
          .onConflictDoUpdate({
            target: rateLimitBuckets.key,
            set: {
              count: sql`CASE WHEN ${windowEnded} THEN 1 ELSE ${rateLimitBuckets.count} + 1 END`,
              windowStart: sql`CASE WHEN ${windowEnded} THEN ${at} ELSE ${rateLimitBuckets.windowStart} END`,
            },
          })
          .returning()
        return { count: row.count, windowStart: row.windowStart.getTime() }
      }),
  }
}
