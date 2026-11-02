export const TRANSFER_LIMITS = {
  /** 10¹⁵ minor units (transfer rule 3). */
  AMOUNT_MAX: 1_000_000_000_000_000,
  NOTE_MAX: 500,
} as const

export const TRANSFER_MESSAGE = {
  PROFILE_GONE: 'The profile does not exist or was deleted',
  PROFILE_FIXED: 'A transfer cannot move to another profile',
  FROM_GONE: 'The wallet to transfer from does not exist or was deleted',
  TO_GONE: 'The wallet to transfer to does not exist or was deleted',
  SAME_WALLET: 'A transfer needs two different wallets',
  OTHER_PROFILE: 'Both wallets must belong to the transfer’s profile',
  OTHER_CURRENCY: 'Both wallets must have the same currency',
} as const
