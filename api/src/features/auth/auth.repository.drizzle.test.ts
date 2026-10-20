import { eq } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/libsql/migrator'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { env } from '@/core/config'
import { createDatabase } from '@/core/database/client'
import { users } from '@/core/database/schema/auth'
import { createDrizzleAuthRepository } from './auth.repository.drizzle'
import type { AuthRepository } from './auth.repository'

const AT = new Date('2026-10-19T00:00:00.000Z')
const later = (ms: number) => new Date(AT.getTime() + ms)

// A real SQLite file per test with the committed migrations (`:memory:` gives each
// transaction its own empty database), so the SQL itself is under test.
let dir: string
let close: () => void
let repo: AuthRepository
let database: ReturnType<typeof createDatabase>['db']

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'tpn-auth-'))
  const { client, db } = createDatabase({ ...env, DATABASE_URL: `file:${join(dir, 'test.db')}` })
  await migrate(db, { migrationsFolder: 'drizzle' })
  repo = createDrizzleAuthRepository(db)
  database = db
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

describe('password hashes', () => {
  it('creates, replaces, reads and deletes the one row of a user', async () => {
    const user = await repo.createUser({ email: 'a@example.com', displayName: 'a' })

    expect(await repo.findPasswordHash(user.id)).toBeNull()
    await repo.savePasswordHash(user.id, '$argon2id$one', AT)
    await repo.savePasswordHash(user.id, '$argon2id$two', later(1))
    expect(await repo.findPasswordHash(user.id)).toBe('$argon2id$two')
    expect(await repo.deletePasswordHash(user.id)).toBe(true)
    expect(await repo.deletePasswordHash(user.id)).toBe(false)
    expect(await repo.findPasswordHash(user.id)).toBeNull()
  })
})

describe('challenge purposes', () => {
  it('keeps sign-in and step-up challenges of one email apart', async () => {
    const user = await repo.createUser({ email: 'a@example.com', displayName: 'a' })
    const signIn = await newChallenge()
    const reauth = await repo.createChallenge({
      purpose: 'reauth',
      destination: 'a@example.com',
      userId: user.id,
      codeHash: 'r',
      linkTokenHash: null,
      expiresAt: later(600_000),
    })

    await repo.expireOpenChallenges('a@example.com', 'reauth', later(1))

    expect((await repo.findLatestChallenge('a@example.com', 'sign_in'))?.expiresAt).toEqual(
      signIn.expiresAt
    )
    expect(await repo.findLatestChallenge('a@example.com', 'reauth')).toMatchObject({
      id: reauth.id,
      purpose: 'reauth',
      userId: user.id,
      expiresAt: later(1),
    })
  })
})

describe('session families', () => {
  it('finds the newest session of a family that is not revoked', async () => {
    await newSession({ id: 's1', familyId: 'f1', tokenHash: 't1' })
    await repo.markSessionRotated('s1', 's2', AT)
    await newSession({ id: 's2', familyId: 'f1', tokenHash: 't2' })

    expect((await repo.findActiveSession('f1'))?.id).toBe('s2')
    await repo.revokeFamily('f1', AT)
    expect(await repo.findActiveSession('f1')).toBeNull()
  })

  it('moves authTime only on the family’s sessions that are not revoked', async () => {
    await newSession({ id: 's1', familyId: 'f1', tokenHash: 't1' })
    await repo.markSessionRotated('s1', 's2', AT)
    await newSession({ id: 's2', familyId: 'f1', tokenHash: 't2' })

    await repo.setFamilyAuthTime('f1', later(5000))

    expect((await repo.findSessionByTokenHash('t1'))?.authTime).toEqual(AT)
    expect((await repo.findSessionByTokenHash('t2'))?.authTime).toEqual(later(5000))
  })

  it('revokes every other family of the user and nobody else’s', async () => {
    await newSession({ id: 's1', familyId: 'keep', tokenHash: 't1' })
    await newSession({ id: 's2', familyId: 'other', tokenHash: 't2' })
    const stranger = await repo.createUser({ email: 'b@example.com', displayName: 'b' })
    await repo.createSession({
      id: 's3',
      familyId: 'theirs',
      tokenHash: 't3',
      userId: stranger.id,
      expiresAt: later(1000),
      absoluteExpiresAt: later(2000),
      authTime: AT,
      lastUsedAt: AT,
      userAgent: null,
    })
    const user = await repo.findUserByEmail('a@example.com')

    expect(await repo.revokeOtherFamilies(user?.id ?? '', 'keep', later(1))).toBe(1)
    expect((await repo.findSessionByTokenHash('t1'))?.revokedAt).toBeNull()
    expect((await repo.findSessionByTokenHash('t2'))?.revokedAt).toEqual(later(1))
    expect((await repo.findSessionByTokenHash('t3'))?.revokedAt).toBeNull()
  })
})

describe('peekRateLimit', () => {
  it('reads the running window without counting, and nothing once it ended', async () => {
    expect(await repo.peekRateLimit('k', 60_000, AT)).toBeNull()
    await repo.hitRateLimit('k', 60_000, AT)
    await repo.hitRateLimit('k', 60_000, AT)

    expect(await repo.peekRateLimit('k', 60_000, later(1))).toEqual({ count: 2, windowStart: AT })
    expect(await repo.peekRateLimit('k', 60_000, later(1))).toEqual({ count: 2, windowStart: AT })
    expect(await repo.peekRateLimit('k', 60_000, later(60_000))).toBeNull()
  })
})

describe('identities', () => {
  it('creates, finds by provider + sub, lists and touches an identity', async () => {
    const user = await repo.createUser({ email: 'a@example.com', displayName: 'a' })

    const created = await repo.createIdentity({
      userId: user.id,
      provider: 'google',
      providerSubject: 'sub-1',
      emailAtLink: 'a@gmail.com',
      lastUsedAt: AT,
    })
    await repo.touchIdentity(created.id, later(5000))

    expect(await repo.findIdentity('google', 'sub-2')).toBeNull()
    expect(await repo.findIdentity('google', 'sub-1')).toMatchObject({
      id: created.id,
      userId: user.id,
      emailAtLink: 'a@gmail.com',
      lastUsedAt: later(5000),
    })
    expect(await repo.listIdentities(user.id)).toHaveLength(1)
    expect(await repo.listIdentities('someone-else')).toEqual([])
  })

  it('refuses a second link of the same provider account', async () => {
    const one = await repo.createUser({ email: 'a@example.com', displayName: 'a' })
    const two = await repo.createUser({ email: 'b@example.com', displayName: 'b' })
    const link = {
      provider: 'google' as const,
      providerSubject: 'sub-1',
      emailAtLink: 'a@gmail.com',
      lastUsedAt: AT,
    }
    await repo.createIdentity({ ...link, userId: one.id })

    await expect(repo.createIdentity({ ...link, userId: two.id })).rejects.toMatchObject({
      status: 500,
    })
  })

  it('goes away with its user', async () => {
    const user = await repo.createUser({ email: 'a@example.com', displayName: 'a' })
    await repo.createIdentity({
      userId: user.id,
      provider: 'google',
      providerSubject: 'sub-1',
      emailAtLink: 'a@gmail.com',
      lastUsedAt: AT,
    })

    await database.delete(users).where(eq(users.id, user.id))

    expect(await repo.findIdentity('google', 'sub-1')).toBeNull()
  })
})

describe('fillAvatarIfEmpty', () => {
  it('sets a missing avatar and leaves one that is there', async () => {
    const user = await repo.createUser({ email: 'a@example.com', displayName: 'a' })

    expect(await repo.fillAvatarIfEmpty(user.id, 'https://x.test/1.png')).toMatchObject({
      avatarUrl: 'https://x.test/1.png',
    })
    expect(await repo.fillAvatarIfEmpty(user.id, 'https://x.test/2.png')).toMatchObject({
      avatarUrl: 'https://x.test/1.png',
    })
    expect(await repo.fillAvatarIfEmpty('missing', 'https://x.test/3.png')).toBeNull()
  })

  it('creates a user with an avatar when one is given', async () => {
    const user = await repo.createUser({
      email: 'a@example.com',
      displayName: 'a',
      avatarUrl: 'https://x.test/a.png',
    })

    expect(user.avatarUrl).toBe('https://x.test/a.png')
  })
})
