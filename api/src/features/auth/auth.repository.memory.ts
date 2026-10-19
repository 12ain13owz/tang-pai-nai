import { v7 as uuidv7 } from 'uuid'
import type { OtpChallenge, RateLimitHit, Session, User } from './auth.entity'
import type { AuthRepository } from './auth.repository'

export interface MemoryAuthState {
  users: User[]
  challenges: OtpChallenge[]
  sessions: Session[]
  buckets: Map<string, RateLimitHit>
}

const emptyState = (): MemoryAuthState => ({
  users: [],
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

    createUser: async ({ email, displayName }) => {
      const now = new Date()
      const user: User = {
        id: uuidv7(),
        email,
        displayName,
        avatarUrl: null,
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

    expireOpenChallenges: async (destination, at) => {
      for (const challenge of state.challenges) {
        const open = !challenge.consumedAt && challenge.expiresAt.getTime() > at.getTime()
        if (challenge.destination === destination && open) {
          challenge.expiresAt = at
        }
      }
    },

    // Newest first; ties keep insertion order, like ordering by the time-sortable id.
    findLatestChallenge: async (destination) =>
      state.challenges.filter((challenge) => challenge.destination === destination).at(-1) ?? null,

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
