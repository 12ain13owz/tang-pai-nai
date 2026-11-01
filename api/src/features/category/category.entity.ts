import type { CATEGORY_TYPES } from './category.const'

export type CategoryType = (typeof CATEGORY_TYPES)[number]

// docs/features/category.md → Data model. A type alias (not an interface), so it fits the sync
// layer's `Record<string, unknown>` rows.
export type Category = {
  id: string
  profileId: string
  type: CategoryType
  /** Null for a top-level category. */
  parentId: string | null
  name: string
  /** A lucide or `tpn` icon name, e.g. `lucideCoffee`. */
  icon: string
  /** `#rrggbb`. */
  color: string
  isArchived: boolean
  sortOrder: number
  createdAt: number
  updatedAt: number
  deletedAt: number | null
  changeSeq: number
  updatedBy: string
}
