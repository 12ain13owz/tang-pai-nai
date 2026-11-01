export const WALLET_LIMITS = {
  NAME_MAX: 50,
  ICON_MAX: 40,
  SORT_ORDER_MAX: 1_000_000,
  /** ±10¹⁵ minor units (wallet rule 5). */
  BALANCE_MAX: 1_000_000_000_000_000,
  /** Non-archived wallets per profile (wallet rule 3). */
  PER_PROFILE: 20,
  /** Ids in `hiddenCategoryIds` (category rule 13). */
  HIDDEN_CATEGORIES_MAX: 200,
} as const

export const WALLET_PATTERN = {
  /** A lucide export name or one of our own `tpn` icons (wallet rule 8). */
  ICON: /^(lucide|tpn)[A-Z][A-Za-z0-9]*$/,
  COLOR: /^#[0-9a-f]{6}$/,
  CURRENCY: /^[A-Z]{3}$/,
} as const

export const WALLET_MESSAGE = {
  PROFILE_GONE: 'The profile does not exist or was deleted',
  PROFILE_FIXED: 'A wallet cannot move to another profile',
  CURRENCY_INACTIVE: 'The currency is not available',
  NAME_TAKEN: 'A wallet with this name already exists in this profile',
  TOO_MANY: `A profile can have at most ${WALLET_LIMITS.PER_PROFILE} wallets`,
} as const
