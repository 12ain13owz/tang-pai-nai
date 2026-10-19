import { and, desc, eq, gt, isNull, lt, or, sql } from 'drizzle-orm'
import type { Database } from '@/core/database'
import { otpChallenges, rateLimitBuckets, sessions, users } from '@/core/database/schema/auth'
import { wrapUnexpected } from '@/core/error'
import type { OtpChallenge, Session, User } from './auth.entity'
import type { AuthRepository } from './auth.repository'

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0]
type Executor = Database | Transaction

type UserRow = typeof users.$inferSelect
type ChallengeRow = typeof otpChallenges.$inferSelect

const toUser = (row: UserRow): User => ({
  id: row.id,
  email: row.email,
  displayName: row.displayName,
  avatarUrl: row.avatarUrl,
  emailVerifiedAt: row.emailVerifiedAt,
  status: row.status,
  timezone: row.timezone,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
})

const toChallenge = (row: ChallengeRow): OtpChallenge => ({
  id: row.id,
  destination: row.destination,
  codeHash: row.codeHash,
  linkTokenHash: row.linkTokenHash,
  attempts: row.attempts,
  expiresAt: row.expiresAt,
  consumedAt: row.consumedAt,
  createdAt: row.createdAt,
})

const toSession = (row: typeof sessions.$inferSelect): Session => ({ ...row })

const emailSignIn = (destination: string) =>
  and(
    eq(otpChallenges.channel, 'email'),
    eq(otpChallenges.purpose, 'sign_in'),
    eq(otpChallenges.destination, destination)
  )

export const createDrizzleAuthRepository = (db: Executor): AuthRepository => {
  const run = async <T>(operation: string, work: () => Promise<T>) =>
    wrapUnexpected(work, { operation: `authRepository.${operation}` })

  return {
    transaction: async (work) =>
      run('transaction', async () =>
        db.transaction(async (tx) => work(createDrizzleAuthRepository(tx)))
      ),

    findUserById: async (id) =>
      run('findUserById', async () => {
        const row = await db.query.users.findFirst({ where: eq(users.id, id) })
        return row ? toUser(row) : null
      }),

    findUserByEmail: async (email) =>
      run('findUserByEmail', async () => {
        const row = await db.query.users.findFirst({ where: eq(users.email, email) })
        return row ? toUser(row) : null
      }),

    createUser: async (data) =>
      run('createUser', async () => {
        const [row] = await db.insert(users).values(data).returning()
        return toUser(row)
      }),

    markEmailVerified: async (userId, at) =>
      run('markEmailVerified', async () => {
        const rows = await db
          .update(users)
          .set({ emailVerifiedAt: at })
          .where(eq(users.id, userId))
          .returning()
        const row = rows.at(0)
        return row ? toUser(row) : null
      }),

    createChallenge: async (data) =>
      run('createChallenge', async () => {
        const [row] = await db
          .insert(otpChallenges)
          .values({ ...data, channel: 'email', purpose: 'sign_in' })
          .returning()
        return toChallenge(row)
      }),

    expireOpenChallenges: async (destination, at) =>
      run('expireOpenChallenges', async () => {
        await db
          .update(otpChallenges)
          .set({ expiresAt: at })
          .where(
            and(
              emailSignIn(destination),
              isNull(otpChallenges.consumedAt),
              gt(otpChallenges.expiresAt, at)
            )
          )
      }),

    findLatestChallenge: async (destination) =>
      run('findLatestChallenge', async () => {
        const row = await db.query.otpChallenges.findFirst({
          where: emailSignIn(destination),
          orderBy: [desc(otpChallenges.createdAt), desc(otpChallenges.id)],
        })
        return row ? toChallenge(row) : null
      }),

    findChallengeByLinkTokenHash: async (linkTokenHash) =>
      run('findChallengeByLinkTokenHash', async () => {
        const row = await db.query.otpChallenges.findFirst({
          where: eq(otpChallenges.linkTokenHash, linkTokenHash),
        })
        return row ? toChallenge(row) : null
      }),

    recordFailedAttempt: async (id) =>
      run('recordFailedAttempt', async () => {
        const rows = await db
          .update(otpChallenges)
          .set({ attempts: sql`${otpChallenges.attempts} + 1` })
          .where(eq(otpChallenges.id, id))
          .returning({ attempts: otpChallenges.attempts })
        return rows.at(0)?.attempts ?? null
      }),

    consumeChallenge: async (id, at) =>
      run('consumeChallenge', async () => {
        const rows = await db
          .update(otpChallenges)
          .set({ consumedAt: at })
          .where(and(eq(otpChallenges.id, id), isNull(otpChallenges.consumedAt)))
          .returning({ id: otpChallenges.id })
        return rows.length > 0
      }),

    createSession: async (data) =>
      run('createSession', async () => {
        const [row] = await db.insert(sessions).values(data).returning()
        return toSession(row)
      }),

    findSessionByTokenHash: async (tokenHash) =>
      run('findSessionByTokenHash', async () => {
        const row = await db.query.sessions.findFirst({ where: eq(sessions.tokenHash, tokenHash) })
        return row ? toSession(row) : null
      }),

    markSessionRotated: async (id, replacedById, at) =>
      run('markSessionRotated', async () => {
        const rows = await db
          .update(sessions)
          .set({ revokedAt: at, replacedById, lastUsedAt: at })
          .where(and(eq(sessions.id, id), isNull(sessions.revokedAt)))
          .returning({ id: sessions.id })
        return rows.length > 0
      }),

    revokeFamily: async (familyId, at) =>
      run('revokeFamily', async () => {
        const rows = await db
          .update(sessions)
          .set({ revokedAt: at })
          .where(and(eq(sessions.familyId, familyId), isNull(sessions.revokedAt)))
          .returning({ id: sessions.id })
        return rows.length
      }),

    // One upsert, so concurrent hits can't both read the same count.
    hitRateLimit: async (key, windowMs, at) =>
      run('hitRateLimit', async () => {
        const windowEnded = sql`${rateLimitBuckets.windowStart} <= ${at.getTime() - windowMs}`
        const [row] = await db
          .insert(rateLimitBuckets)
          .values({ key, count: 1, windowStart: at })
          .onConflictDoUpdate({
            target: rateLimitBuckets.key,
            set: {
              count: sql`CASE WHEN ${windowEnded} THEN 1 ELSE ${rateLimitBuckets.count} + 1 END`,
              windowStart: sql`CASE WHEN ${windowEnded} THEN ${at.getTime()} ELSE ${rateLimitBuckets.windowStart} END`,
            },
          })
          .returning()
        return { count: row.count, windowStart: row.windowStart }
      }),

    // Buckets carry no window length, so one older than the longest window (a day) is stale.
    deleteExpired: async (before) =>
      run('deleteExpired', async () => {
        const challenges = await db
          .delete(otpChallenges)
          .where(lt(otpChallenges.expiresAt, before))
          .returning({ id: otpChallenges.id })
        const ended = await db
          .delete(sessions)
          .where(
            or(
              lt(sessions.revokedAt, before),
              lt(sessions.expiresAt, before),
              lt(sessions.absoluteExpiresAt, before)
            )
          )
          .returning({ id: sessions.id })
        const buckets = await db
          .delete(rateLimitBuckets)
          .where(lt(rateLimitBuckets.windowStart, before))
          .returning({ key: rateLimitBuckets.key })
        return {
          challenges: challenges.length,
          sessions: ended.length,
          rateLimitBuckets: buckets.length,
        }
      }),
  }
}
