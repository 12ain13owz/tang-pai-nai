export type UserStatus = 'active' | 'disabled'

/** UI language of the sign-in email (the app's current language). */
export type MailLanguage = 'th' | 'en'

export interface User {
  id: string
  email: string
  displayName: string
  avatarUrl: string | null
  emailVerifiedAt: Date | null
  status: UserStatus
  timezone: string
  createdAt: Date
  updatedAt: Date
}

export type NewUser = Pick<User, 'email' | 'displayName'> & Partial<Pick<User, 'avatarUrl'>>

/** Outside sign-in providers (rule 14). Only Google is built. */
export type IdentityProvider = 'google'

/** A link between a user and a provider account, matched on the provider's `sub`. */
export interface UserIdentity {
  id: string
  userId: string
  provider: IdentityProvider
  providerSubject: string
  /** The provider's email when the link was made. */
  emailAtLink: string
  createdAt: Date
  lastUsedAt: Date
}

export type NewUserIdentity = Pick<
  UserIdentity,
  'userId' | 'provider' | 'providerSubject' | 'emailAtLink' | 'lastUsedAt'
>

/** A linked provider as responses show it. */
export interface LinkedIdentity {
  provider: IdentityProvider
  email: string
  linkedAt: Date
}

/**
 * A user as responses show them: whether a password is set and which providers are linked come
 * from their own tables.
 */
export type UserProfile = User & { hasPassword: boolean; identities: LinkedIdentity[] }

/** `sign_in`: code + link to sign in. `reauth`: code only, for a signed-in user (rule 13). */
export type ChallengePurpose = 'sign_in' | 'reauth'

/** One "send me a code" request, on the email channel. */
export interface OtpChallenge {
  id: string
  purpose: ChallengePurpose
  destination: string
  /** Set for `reauth`: the only user who may use the code. */
  userId: string | null
  codeHash: string
  linkTokenHash: string | null
  attempts: number
  expiresAt: Date
  consumedAt: Date | null
  createdAt: Date
}

export type NewOtpChallenge = Pick<
  OtpChallenge,
  'purpose' | 'destination' | 'userId' | 'codeHash' | 'linkTokenHash' | 'expiresAt'
>

/** One refresh token. Every rotation of one sign-in shares `familyId`. */
export interface Session {
  id: string
  userId: string
  familyId: string
  tokenHash: string
  expiresAt: Date
  absoluteExpiresAt: Date
  authTime: Date
  revokedAt: Date | null
  replacedById: string | null
  lastUsedAt: Date
  userAgent: string | null
  createdAt: Date
}

export type NewSession = Pick<
  Session,
  | 'id'
  | 'userId'
  | 'familyId'
  | 'tokenHash'
  | 'expiresAt'
  | 'absoluteExpiresAt'
  | 'authTime'
  | 'lastUsedAt'
  | 'userAgent'
>

export interface RateLimitHit {
  /** Hits in the current window, this one included. */
  count: number
  windowStart: Date
}

export interface CleanupResult {
  challenges: number
  sessions: number
  rateLimitBuckets: number
}

/** `{ email, code }` from the enter-code screen, or `{ token }` from the magic link. */
export type EmailVerification = { email: string; code: string } | { token: string }

/** Where a request came from, for rate limits and the session list. */
export interface ClientContext {
  ip?: string
  userAgent?: string
}

/** A new or rotated session. `refreshToken` is raw: it only ever goes into the cookie. */
export interface SignInResult {
  user: UserProfile
  accessToken: string
  expiresIn: number
  refreshToken: string
  refreshExpiresAt: Date
}

/** The caller of an authenticated route (`req.auth`). */
export interface Caller {
  userId: string
  sessionFamilyId: string
}

/** What Google sent back to `/auth/google/callback` (query string). */
export interface GoogleCallback {
  code?: string
  state?: string
  /** Set when the user refused or Google failed (`access_denied`, …). */
  error?: string
}

/** A finished Google sign-in: the session, where to go, and whether an identity was just linked. */
export interface GoogleSignInResult extends SignInResult {
  returnUrl: string
  linked: boolean
}

/** `PUT /auth/password`. `currentPassword` is one way to prove recent auth (rule 13). */
export interface PasswordChange {
  newPassword: string
  currentPassword?: string
}
