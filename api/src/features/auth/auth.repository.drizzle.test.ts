import { migrate } from 'drizzle-orm/libsql/migrator'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { env } from '@/core/config'
import { createDatabase } from '@/core/database/client'
import { createDrizzleAuthRepository } from './auth.repository.drizzle'
import type { AuthRepository } from './auth.repository'

const AT = new Date('2026-10-19T00:00:00.000Z')
const later = (ms: number) => new Date(AT.getTime() + ms)

// A real SQLite file per test with the committed migrations (`:memory:` gives each
// transaction its own empty database), so the SQL itself is under test.
let dir: string
let close: () => void
let repo: AuthRepository

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'tpn-auth-'))
  const { client, db } = createDatabase({ ...env, DATABASE_URL: `file:${join(dir, 'test.db')}` })
  await migrate(db, { migrationsFolder: 'drizzle' })
  repo = createDrizzleAuthRepository(db)
  close = () => client.close()
})

afterEach(() => {
  close()
  rmSync(dir, { recursive: true, force: true })
})

const newChallenge = async (destination = 'a@example.com', expiresAt = later(600_000)) =>
  repo.createChallenge({
    purpose: 'sign_in',
    destination,
    userId: null,
    codeHash: 'c',
    linkTokenHash: `l-${Math.random()}`,
    expiresAt,
  })

const newSession = async (overrides: { id: string; familyId: string; tokenHash: string }) => {
  const user =
    (await repo.findUserByEmail('a@example.com')) ??
    (await repo.createUser({ email: 'a@example.com', displayName: 'a' }))
  return repo.createSession({
    ...overrides,
    userId: user.id,
    expiresAt: later(1000),
    absoluteExpiresAt: later(2000),
    authTime: AT,
    lastUsedAt: AT,
    userAgent: null,
  })
}

describe('hitRateLimit', () => {
  it('counts hits within the window and starts over after it', async () => {
    expect(await repo.hitRateLimit('k', 60_000, AT)).toEqual({ count: 1, windowStart: AT })
    expect(await repo.hitRateLimit('k', 60_000, later(30_000))).toEqual({
      count: 2,
      windowStart: AT,
    })
    expect(await repo.hitRateLimit('k', 60_000, later(60_000))).toEqual({
      count: 1,
      windowStart: later(60_000),
    })
  })

  it('keeps separate keys apart', async () => {
    await repo.hitRateLimit('a', 60_000, AT)

    expect((await repo.hitRateLimit('b', 60_000, AT)).count).toBe(1)
  })
})

describe('challenges', () => {
  it('finds the newest challenge and expires only open ones', async () => {
    const old = await newChallenge()
    const latest = await newChallenge()
    await repo.consumeChallenge(old.id, AT)

    await repo.expireOpenChallenges('a@example.com', 'sign_in', later(1))

    expect((await repo.findLatestChallenge('a@example.com', 'sign_in'))?.id).toBe(latest.id)
    expect((await repo.findLatestChallenge('a@example.com', 'sign_in'))?.expiresAt).toEqual(
      later(1)
    )
  })

  it('consumes a challenge once and counts failed attempts', async () => {
    const challenge = await newChallenge()

    expect(await repo.recordFailedAttempt(challenge.id)).toBe(1)
    expect(await repo.recordFailedAttempt(challenge.id)).toBe(2)
    expect(await repo.consumeChallenge(challenge.id, AT)).toBe(true)
    expect(await repo.consumeChallenge(challenge.id, AT)).toBe(false)
    expect(await repo.recordFailedAttempt('missing')).toBeNull()
  })
})

describe('sessions', () => {
  it('rotates a session once and revokes a whole family', async () => {
    await newSession({ id: 's1', familyId: 'f', tokenHash: 'h1' })
    await newSession({ id: 's2', familyId: 'f', tokenHash: 'h2' })

    expect(await repo.markSessionRotated('s1', 's2', AT)).toBe(true)
    expect(await repo.markSessionRotated('s1', 's3', AT)).toBe(false)
    expect(await repo.revokeFamily('f', AT)).toBe(1)
    expect((await repo.findSessionByTokenHash('h2'))?.revokedAt).toEqual(AT)
  })
})

describe('transaction', () => {
  it('rolls back every write when the work throws', async () => {
    await expect(
      repo.transaction(async (tx) => {
        await tx.createUser({ email: 'rollback@example.com', displayName: 'r' })
        throw new Error('boom')
      })
    ).rejects.toThrow()

    expect(await repo.findUserByEmail('rollback@example.com')).toBeNull()
  })
})

describe('deleteExpired', () => {
  it('removes rows that ended before the cutoff and keeps the rest', async () => {
    await newChallenge('old@example.com', later(-10))
    await newChallenge('new@example.com', later(10))
    await newSession({ id: 's1', familyId: 'f', tokenHash: 'h1' })
    await repo.hitRateLimit('k', 60_000, AT)

    const removed = await repo.deleteExpired(later(5000))

    expect(removed).toEqual({ challenges: 2, sessions: 1, rateLimitBuckets: 1 })
    expect(await repo.deleteExpired(AT)).toEqual({
      challenges: 0,
      sessions: 0,
      rateLimitBuckets: 0,
    })
  })
})
