import { and, desc, eq, gt, isNull, lt, ne, or, sql } from 'drizzle-orm'
import type { Database } from '@/core/database'
import {
  otpChallenges,
  passwordCredentials,
  rateLimitBuckets,
  sessions,
  users,
} from '@/core/database/schema/auth'
import { wrapUnexpected } from '@/core/error'
import type { ChallengePurpose, OtpChallenge, Session, User } from './auth.entity'
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

// The table also has `sms` / `verify_phone` rows (4.4); this feature only reads email ones.
const toChallenge = (row: ChallengeRow): OtpChallenge => ({
  id: row.id,
  purpose: row.purpose === 'reauth' ? 'reauth' : 'sign_in',
  destination: row.destination,
  userId: row.userId,
  codeHash: row.codeHash,
  linkTokenHash: row.linkTokenHash,
  attempts: row.attempts,
  expiresAt: row.expiresAt,
  consumedAt: row.consumedAt,
  createdAt: row.createdAt,
})

const toSession = (row: typeof sessions.$inferSelect): Session => ({ ...row })

const emailChallenge = (destination: string, purpose: ChallengePurpose) =>
  and(
    eq(otpChallenges.channel, 'email'),
    eq(otpChallenges.purpose, purpose),
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

    findPasswordHash: async (userId) =>
      run('findPasswordHash', async () => {
        const row = await db.query.passwordCredentials.findFirst({
          where: eq(passwordCredentials.userId, userId),
        })
        return row?.passwordHash ?? null
      }),

    savePasswordHash: async (userId, passwordHash, at) =>
      run('savePasswordHash', async () => {
        await db
          .insert(passwordCredentials)
          .values({ userId, passwordHash, updatedAt: at })
          .onConflictDoUpdate({
            target: passwordCredentials.userId,
            set: { passwordHash, updatedAt: at },
          })
      }),

    deletePasswordHash: async (userId) =>
      run('deletePasswordHash', async () => {
        const rows = await db
          .delete(passwordCredentials)
          .where(eq(passwordCredentials.userId, userId))
          .returning({ userId: passwordCredentials.userId })
        return rows.length > 0
      }),

    createChallenge: async (data) =>
      run('createChallenge', async () => {
        const [row] = await db
          .insert(otpChallenges)
          .values({ ...data, channel: 'email' })
          .returning()
        return toChallenge(row)
      }),

    expireOpenChallenges: async (destination, purpose, at) =>
      run('expireOpenChallenges', async () => {
        await db
          .update(otpChallenges)
          .set({ expiresAt: at })
          .where(
            and(
              emailChallenge(destination, purpose),
              isNull(otpChallenges.consumedAt),
              gt(otpChallenges.expiresAt, at)
            )
          )
      }),

    findLatestChallenge: async (destination, purpose) =>
      run('findLatestChallenge', async () => {
        const row = await db.query.otpChallenges.findFirst({
          where: emailChallenge(destination, purpose),
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

    findActiveSession: async (familyId) =>
      run('findActiveSession', async () => {
        const row = await db.query.sessions.findFirst({
          where: and(eq(sessions.familyId, familyId), isNull(sessions.revokedAt)),
          orderBy: [desc(sessions.createdAt), desc(sessions.id)],
        })
        return row ? toSession(row) : null
      }),

    setFamilyAuthTime: async (familyId, at) =>
      run('setFamilyAuthTime', async () => {
        await db
          .update(sessions)
          .set({ authTime: at })
          .where(and(eq(sessions.familyId, familyId), isNull(sessions.revokedAt)))
      }),

    revokeOtherFamilies: async (userId, keepFamilyId, at) =>
      run('revokeOtherFamilies', async () => {
        const rows = await db
          .update(sessions)
          .set({ revokedAt: at })
          .where(
            and(
              eq(sessions.userId, userId),
              ne(sessions.familyId, keepFamilyId),
              isNull(sessions.revokedAt)
            )
          )
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

    peekRateLimit: async (key, windowMs, at) =>
      run('peekRateLimit', async () => {
        const row = await db.query.rateLimitBuckets.findFirst({
          where: eq(rateLimitBuckets.key, key),
        })
        const running = row && row.windowStart.getTime() > at.getTime() - windowMs
        return running ? { count: row.count, windowStart: row.windowStart } : null
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
