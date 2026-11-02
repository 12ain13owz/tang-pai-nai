export const TRANSACTION_LIMITS = {
  /** 10¹⁵ minor units (transaction rule 3). */
  AMOUNT_MAX: 1_000_000_000_000_000,
  NOTE_MAX: 500,
} as const

export const TRANSACTION_MESSAGE = {
  PROFILE_GONE: 'The profile does not exist or was deleted',
  PROFILE_FIXED: 'A transaction cannot move to another profile',
  WALLET_GONE: 'The wallet does not exist or was deleted',
  CATEGORY_GONE: 'The category does not exist or was deleted',
  OTHER_PROFILE: 'The wallet and the category must belong to the transaction’s profile',
  CURRENCY_FIXED: 'A transaction cannot move to a wallet with another currency',
} as const
