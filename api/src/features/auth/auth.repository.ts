import type {
  CleanupResult,
  NewOtpChallenge,
  NewSession,
  NewUser,
  OtpChallenge,
  RateLimitHit,
  Session,
  User,
} from './auth.entity'

export interface AuthRepository {
  /** Runs `work` atomically; it receives a repository bound to the transaction. */
  transaction<T>(work: (repo: AuthRepository) => Promise<T>): Promise<T>

  findUserById(id: string): Promise<User | null>
  findUserByEmail(email: string): Promise<User | null>
  createUser(data: NewUser): Promise<User>
  markEmailVerified(userId: string, at: Date): Promise<User | null>

  createChallenge(data: NewOtpChallenge): Promise<OtpChallenge>
  /** Ends every open (unconsumed, unexpired) challenge for `destination` at `at`. */
  expireOpenChallenges(destination: string, at: Date): Promise<void>
  findLatestChallenge(destination: string): Promise<OtpChallenge | null>
  findChallengeByLinkTokenHash(linkTokenHash: string): Promise<OtpChallenge | null>
  /** Adds one wrong attempt and returns the new total (`null` if the challenge is gone). */
  recordFailedAttempt(id: string): Promise<number | null>
  /** Sets `consumedAt` only if it's still unset; `false` means someone else used it first. */
  consumeChallenge(id: string, at: Date): Promise<boolean>

  createSession(data: NewSession): Promise<Session>
  findSessionByTokenHash(tokenHash: string): Promise<Session | null>
  /** Revokes `id` as replaced by `replacedById`, only if it isn't revoked yet. */
  markSessionRotated(id: string, replacedById: string, at: Date): Promise<boolean>
  /** Revokes every still-active session of the family; returns how many. */
  revokeFamily(familyId: string, at: Date): Promise<number>

  /** Counts one hit on `key` in a fixed window of `windowMs` (a new window starts after it). */
  hitRateLimit(key: string, windowMs: number, at: Date): Promise<RateLimitHit>

  /** Deletes challenges, sessions and buckets that ended before `before`. */
  deleteExpired(before: Date): Promise<CleanupResult>
}
