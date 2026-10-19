import type {
  ChallengePurpose,
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

  /** The Argon2id PHC string, or `null` when the user has no password. */
  findPasswordHash(userId: string): Promise<string | null>
  /** Creates or replaces the user's password. */
  savePasswordHash(userId: string, passwordHash: string, at: Date): Promise<void>
  /** `false` when there was no password. */
  deletePasswordHash(userId: string): Promise<boolean>

  createChallenge(data: NewOtpChallenge): Promise<OtpChallenge>
  /** Ends every open (unconsumed, unexpired) `purpose` challenge for `destination` at `at`. */
  expireOpenChallenges(destination: string, purpose: ChallengePurpose, at: Date): Promise<void>
  findLatestChallenge(destination: string, purpose: ChallengePurpose): Promise<OtpChallenge | null>
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
  /** The family's newest session that isn't revoked (it may have expired). */
  findActiveSession(familyId: string): Promise<Session | null>
  /** Sets `authTime` on the family's sessions that aren't revoked (step-up, rule 13). */
  setFamilyAuthTime(familyId: string, at: Date): Promise<void>
  /** Revokes every active session of the user outside `keepFamilyId`; returns how many. */
  revokeOtherFamilies(userId: string, keepFamilyId: string, at: Date): Promise<number>

  /** Counts one hit on `key` in a fixed window of `windowMs` (a new window starts after it). */
  hitRateLimit(key: string, windowMs: number, at: Date): Promise<RateLimitHit>
  /** The bucket of `key` if its window is still running, without counting a hit. */
  peekRateLimit(key: string, windowMs: number, at: Date): Promise<RateLimitHit | null>

  /** Deletes challenges, sessions and buckets that ended before `before`. */
  deleteExpired(before: Date): Promise<CleanupResult>
}
