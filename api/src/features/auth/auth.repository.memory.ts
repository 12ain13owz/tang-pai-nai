import { v7 as uuidv7 } from 'uuid'
import type { OtpChallenge, RateLimitHit, Session, User, UserIdentity } from './auth.entity'
import type { AuthRepository } from './auth.repository'

export interface MemoryAuthState {
  users: User[]
  /** userId → Argon2id PHC string. */
  passwords: Map<string, string>
  identities: UserIdentity[]
  challenges: OtpChallenge[]
  sessions: Session[]
  buckets: Map<string, RateLimitHit>
}

const emptyState = (): MemoryAuthState => ({
  users: [],
  passwords: new Map(),
  identities: [],
  challenges: [],
  sessions: [],
  buckets: new Map(),
})

const cloneState = (state: MemoryAuthState): MemoryAuthState => structuredClone(state)

/**
 * In-memory adapter for tests, with the same semantics as the Drizzle one: conditional updates,
 * fixed-window rate limits, and transactions that roll back when `work` throws.
 */
export const createMemoryAuthRepository = (
  seed: Partial<MemoryAuthState> = {}
): AuthRepository & { state: () => MemoryAuthState } => {
  let state: MemoryAuthState = { ...emptyState(), ...cloneState({ ...emptyState(), ...seed }) }

  const repo: AuthRepository & { state: () => MemoryAuthState } = {
    state: () => state,

    transaction: async (work) => {
      const snapshot = cloneState(state)
      try {
        return await work(repo)
      } catch (error) {
        state = snapshot
        throw error
      }
    },

    findUserById: async (id) => state.users.find((user) => user.id === id) ?? null,
    findUserByEmail: async (email) => state.users.find((user) => user.email === email) ?? null,

    createUser: async ({ email, displayName, avatarUrl = null }) => {
      const now = new Date()
      const user: User = {
        id: uuidv7(),
        email,
        displayName,
        avatarUrl,
        emailVerifiedAt: null,
        status: 'active',
        timezone: 'Asia/Bangkok',
        createdAt: now,
        updatedAt: now,
      }
      state.users.push(user)
      return user
    },

    markEmailVerified: async (userId, at) => {
      const user = state.users.find((candidate) => candidate.id === userId)
      if (!user) {
        return null
      }
      user.emailVerifiedAt = at
      return user
    },

    fillAvatarIfEmpty: async (userId, avatarUrl) => {
      const user = state.users.find((candidate) => candidate.id === userId)
      if (!user) {
        return null
      }
      user.avatarUrl ??= avatarUrl
      return user
    },

    findIdentity: async (provider, providerSubject) =>
      state.identities.find(
        (identity) =>
          `${identity.provider}:${identity.providerSubject}` === `${provider}:${providerSubject}`
      ) ?? null,
    findUserIdentity: async (userId, provider) =>
      state.identities.find(
        (identity) => `${identity.userId}:${identity.provider}` === `${userId}:${provider}`
      ) ?? null,
    listIdentities: async (userId) =>
      state.identities.filter((identity) => identity.userId === userId),
    createIdentity: async (data) => {
      const key = `${data.provider}:${data.providerSubject}`
      const taken = state.identities.some(
        (identity) => `${identity.provider}:${identity.providerSubject}` === key
      )
      if (taken) {
        throw new Error('UNIQUE constraint failed: user_identities.provider_subject')
      }
      const identity: UserIdentity = { ...data, id: uuidv7(), createdAt: new Date() }
      state.identities.push(identity)
      return identity
    },
    deleteIdentity: async (userId, provider) => {
      const before = state.identities.length
      state.identities = state.identities.filter(
        (identity) => `${identity.userId}:${identity.provider}` !== `${userId}:${provider}`
      )
      return state.identities.length < before
    },
    touchIdentity: async (id, at) => {
      const identity = state.identities.find((candidate) => candidate.id === id)
      if (identity) {
        identity.lastUsedAt = at
      }
    },

    findPasswordHash: async (userId) => state.passwords.get(userId) ?? null,
    savePasswordHash: async (userId, passwordHash) => {
      state.passwords.set(userId, passwordHash)
    },
    deletePasswordHash: async (userId) => state.passwords.delete(userId),

    createChallenge: async (data) => {
      const challenge: OtpChallenge = {
        ...data,
        id: uuidv7(),
        attempts: 0,
        consumedAt: null,
        createdAt: new Date(),
      }
      state.challenges.push(challenge)
      return challenge
    },

    expireOpenChallenges: async (destination, purpose, at) => {
      for (const challenge of state.challenges) {
        const open = !challenge.consumedAt && challenge.expiresAt.getTime() > at.getTime()
        const same = challenge.destination === destination && challenge.purpose === purpose
        if (same && open) {
          challenge.expiresAt = at
        }
      }
    },

    // Newest first; ties keep insertion order, like ordering by the time-sortable id.
    findLatestChallenge: async (destination, purpose) =>
      state.challenges
        .filter((challenge) => challenge.destination === destination)
        .filter((challenge) => challenge.purpose === purpose)
        .at(-1) ?? null,

    findChallengeByLinkTokenHash: async (linkTokenHash) =>
      state.challenges.find((challenge) => challenge.linkTokenHash === linkTokenHash) ?? null,

    recordFailedAttempt: async (id) => {
      const challenge = state.challenges.find((candidate) => candidate.id === id)
      if (!challenge) {
        return null
      }
      challenge.attempts += 1
      return challenge.attempts
    },

    consumeChallenge: async (id, at) => {
      const challenge = state.challenges.find((candidate) => candidate.id === id)
      if (!challenge || challenge.consumedAt) {
        return false
      }
      challenge.consumedAt = at
      return true
    },

    createSession: async (data) => {
      const session: Session = {
        ...data,
        revokedAt: null,
        replacedById: null,
        createdAt: new Date(),
      }
      state.sessions.push(session)
      return session
    },

    findSessionByTokenHash: async (tokenHash) =>
      state.sessions.find((session) => session.tokenHash === tokenHash) ?? null,

    markSessionRotated: async (id, replacedById, at) => {
      const session = state.sessions.find((candidate) => candidate.id === id)
      if (!session || session.revokedAt) {
        return false
      }
      session.revokedAt = at
      session.replacedById = replacedById
      session.lastUsedAt = at
      return true
    },

    revokeFamily: async (familyId, at) => {
      const active = state.sessions.filter(
        (session) => session.familyId === familyId && !session.revokedAt
      )
      for (const session of active) {
        session.revokedAt = at
      }
      return active.length
    },

    findActiveSession: async (familyId) =>
      state.sessions
        .filter((session) => session.familyId === familyId && !session.revokedAt)
        .at(-1) ?? null,

    setFamilyAuthTime: async (familyId, at) => {
      for (const session of state.sessions) {
        if (session.familyId === familyId && !session.revokedAt) {
          session.authTime = at
        }
      }
    },

    // Most recently used first; ties keep insertion order reversed, like ordering by id desc.
    listActiveSessions: async (userId, at) =>
      state.sessions
        .filter(
          (session) =>
            session.userId === userId &&
            !session.revokedAt &&
            session.expiresAt.getTime() > at.getTime() &&
            session.absoluteExpiresAt.getTime() > at.getTime()
        )
        .reverse()
        .sort((a, b) => b.lastUsedAt.getTime() - a.lastUsedAt.getTime()),

    revokeOtherFamilies: async (userId, keepFamilyId, at) => {
      const others = state.sessions.filter(
        (session) =>
          session.userId === userId && session.familyId !== keepFamilyId && !session.revokedAt
      )
      for (const session of others) {
        session.revokedAt = at
      }
      return others.length
    },

    peekRateLimit: async (key, windowMs, at) => {
      const bucket = state.buckets.get(key)
      const running = bucket && bucket.windowStart.getTime() > at.getTime() - windowMs
      return running ? { ...bucket } : null
    },

    hitRateLimit: async (key, windowMs, at) => {
      const bucket = state.buckets.get(key)
      const windowEnded = !bucket || bucket.windowStart.getTime() <= at.getTime() - windowMs
      const next: RateLimitHit = windowEnded
        ? { count: 1, windowStart: at }
        : { count: bucket.count + 1, windowStart: bucket.windowStart }
      state.buckets.set(key, next)
      return { ...next }
    },

    deleteExpired: async (before) => {
      const ended = (date: Date | null) => date !== null && date.getTime() < before.getTime()
      const challenges = state.challenges.length
      const sessions = state.sessions.length
      const buckets = state.buckets.size
      state.challenges = state.challenges.filter((challenge) => !ended(challenge.expiresAt))
      state.sessions = state.sessions.filter(
        (session) =>
          !ended(session.revokedAt) &&
          !ended(session.expiresAt) &&
          !ended(session.absoluteExpiresAt)
      )
      for (const [key, bucket] of state.buckets) {
        if (ended(bucket.windowStart)) {
          state.buckets.delete(key)
        }
      }
      return {
        challenges: challenges - state.challenges.length,
        sessions: sessions - state.sessions.length,
        rateLimitBuckets: buckets - state.buckets.size,
      }
    },
  }

  return repo
}
