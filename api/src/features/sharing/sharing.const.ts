const MINUTE_MS = 60_000
const DAY_MS = 24 * 60 * MINUTE_MS

// docs/features/sharing.md → Business rules.
export const SHARING_LIMITS = {
  /** Rule 3: members and pending invites of one profile together. */
  PEOPLE_PER_PROFILE: 10,
  /** Rule 5. */
  INVITE_TTL_MS: 14 * DAY_MS,
  /** Rule 4: invite + resend mails per owner. */
  SENDS_PER_DAY: 10,
  SENDS_WINDOW_MS: DAY_MS,
  /** Rule 4: per invite. */
  RESEND_COOLDOWN_MS: 10 * MINUTE_MS,
  /** The global mail cap's bucket, shared with auth's mails (EMAIL_DAILY_LIMIT). */
  EMAIL_DAILY_KEY: 'email:global:day',
  EMAIL_DAILY_WINDOW_MS: DAY_MS,
  /** Wallets in one invite or membership: a profile holds at most this many anyway. */
  WALLETS_MAX: 200,
  /** Transactions per read of a shared profile (rule 9), like a pull page. */
  ROWS_DEFAULT: 2000,
  ROWS_MAX: 5000,
} as const

/** `code` beside `message` in error responses, for the web app to pick its text. */
export enum ShareErrorCode {
  SELF = 'SHARE_SELF',
  ALREADY_MEMBER = 'SHARE_ALREADY_MEMBER',
  INVITE_PENDING = 'SHARE_INVITE_PENDING',
  MEMBER_LIMIT = 'SHARE_MEMBER_LIMIT',
  WALLETS_INVALID = 'SHARE_WALLETS_INVALID',
  INVITE_EMPTY = 'SHARE_INVITE_EMPTY',
  DAILY_LIMIT = 'SHARE_DAILY_LIMIT',
  RESEND_COOLDOWN = 'SHARE_RESEND_COOLDOWN',
  RATE_LIMITED = 'RATE_LIMITED',
}

export const SHARING_MESSAGE = {
  SELF: 'You can’t invite yourself',
  ALREADY_MEMBER: 'This person already shares wallets of this profile',
  INVITE_PENDING: 'An invitation to this email is already pending',
  MEMBER_LIMIT: 'A profile can be shared with at most 10 people',
  WALLETS_INVALID: 'Pick open wallets of this profile',
  INVITE_EMPTY: 'None of the invited wallets is shared any more',
  DAILY_LIMIT: 'Too many invitations today. Please try again tomorrow',
  RESEND_COOLDOWN: 'Wait a few minutes before sending this invitation again',
} as const
