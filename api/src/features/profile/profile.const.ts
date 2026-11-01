export const PROFILE_LIMITS = {
  NAME_MAX: 30,
  ICON_MAX: 40,
  SORT_ORDER_MAX: 1_000_000,
  /** Live profiles per user (profile rule 4). */
  PER_USER: 20,
} as const

export const PROFILE_PATTERN = {
  /** A lucide export name, e.g. `lucideHouse` (profile rule 3). */
  ICON: /^lucide[A-Z][A-Za-z0-9]*$/,
  COLOR: /^#[0-9a-f]{6}$/,
} as const

export const PROFILE_MESSAGE = {
  NAME_TAKEN: 'A profile with this name already exists',
  TOO_MANY: `A user can have at most ${PROFILE_LIMITS.PER_USER} profiles`,
}
