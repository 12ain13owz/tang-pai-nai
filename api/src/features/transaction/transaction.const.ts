export const TRANSACTION_LIMITS = {
  /** 10¹⁵ minor units (transaction rule 3). */
  AMOUNT_MAX: 1_000_000_000_000_000,
  NOTE_MAX: 500,
  /** The earliest `occurredOn` (rule 4). */
  FIRST_DAY: '2000-01-01',
  /** Days after the server's today a date may be: one year plus a day for time zones. */
  FUTURE_DAYS: 367,
} as const

export const TRANSACTION_PATTERN = {
  DATE: /^\d{4}-\d{2}-\d{2}$/,
} as const

export const TRANSACTION_MESSAGE = {
  PROFILE_GONE: 'The profile does not exist or was deleted',
  PROFILE_FIXED: 'A transaction cannot move to another profile',
  WALLET_GONE: 'The wallet does not exist or was deleted',
  CATEGORY_GONE: 'The category does not exist or was deleted',
  OTHER_PROFILE: 'The wallet and the category must belong to the transaction’s profile',
  CURRENCY_FIXED: 'A transaction cannot move to a wallet with another currency',
} as const
