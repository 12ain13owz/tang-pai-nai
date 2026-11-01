export const CATEGORY_LIMITS = {
  NAME_MAX: 40,
  ICON_MAX: 40,
  SORT_ORDER_MAX: 1_000_000,
  /** Non-archived categories per profile (category rule 11). */
  PER_PROFILE: 200,
} as const

export const CATEGORY_TYPES = ['income', 'expense'] as const

export const CATEGORY_PATTERN = {
  /** A lucide export name or one of our own `tpn` icons (category rule 9). */
  ICON: /^(lucide|tpn)[A-Z][A-Za-z0-9]*$/,
  COLOR: /^#[0-9a-f]{6}$/,
} as const

export const CATEGORY_MESSAGE = {
  PROFILE_GONE: 'The profile does not exist or was deleted',
  PROFILE_FIXED: 'A category cannot move to another profile',
  PARENT_GONE: 'The parent category does not exist or was deleted',
  PARENT_INVALID: 'The parent must be a top-level category of the same profile and type',
  PARENT_ARCHIVED: 'The parent category is archived',
  HAS_CHILDREN: 'A category with sub-categories cannot have a parent',
  TYPE_FIXED: 'A category with sub-categories cannot change its type',
  NAME_TAKEN: 'A category with this name already exists here',
  TOO_MANY: `A profile can have at most ${CATEGORY_LIMITS.PER_PROFILE} categories`,
} as const
