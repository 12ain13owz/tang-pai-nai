/** A profile as the device stores it (docs/features/profile.md → Data model). */
export interface Profile {
  id: string
  name: string
  /** A lucide export name, e.g. `lucideHouse`. */
  icon: string
  /** `#rrggbb`. */
  color: string
  sortOrder: number
  createdAt: number
  updatedAt: number
  deletedAt: number | null
  /** Null until the server has seen the row. */
  changeSeq: number | null
}

/** What the profile form edits. */
export interface ProfileValues {
  name: string
  icon: string
  color: string
}

/** Which profile sheet is open: create, edit one, or "fix" a rejected op's refused values. */
export type ProfileSheetState =
  | { mode: 'create' }
  | { mode: 'edit'; id: string }
  | { mode: 'fix'; opId: string; id: string; values: ProfileValues }

export const PROFILE_TABLE = 'profiles'

export const PROFILE_LIMITS = {
  NAME_MAX: 30,
  /** Live profiles per user (profile rule 4). */
  PER_USER: 20,
} as const

/** Where the device keeps its current profile (profile rule 6). */
export const PROFILE_KEY_PREFIX = 'tpn-profile:'

/**
 * Device tables whose rows carry `profile_id` and go with their profile (profile rule 8). Their
 * tombstones are written in the same local write as the profile's.
 */
export const PROFILE_CHILD_TABLES = ['wallets', 'categories'] as const

/** The device table of categories, which a new profile is written with (category rule 8). */
export const DEFAULT_CATEGORY_TABLE = 'categories'
