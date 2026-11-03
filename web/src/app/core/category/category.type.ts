/** Income or expense (docs/features/category.md → Data model). */
export type CategoryType = 'income' | 'expense'

/** A category as the device stores it. */
export interface Category {
  id: string
  profileId: string
  type: CategoryType
  /** Null for a top-level category (one level only, rule 3). */
  parentId: string | null
  name: string
  /** A lucide or `tpn` icon name, e.g. `lucideCoffee`. */
  icon: string
  /** `#rrggbb`. */
  color: string
  isArchived: boolean
  sortOrder: number
  /** The category a merged tombstone went into (rule 15); null otherwise. */
  mergedIntoId?: string | null
  createdAt: number
  updatedAt: number
  deletedAt: number | null
  /** Null until the server has seen the row. */
  changeSeq: number | null
}

/** A top-level category with its children, both in order (rule 10). */
export interface CategoryNode {
  category: Category
  children: Category[]
}

/** What the category form edits. */
export interface CategoryValues {
  name: string
  icon: string
  color: string
  type: CategoryType
  parentId: string | null
}

/** Which category sheet is open: create (in a type, maybe under a parent), edit, or "fix". */
export type CategorySheetState =
  | { mode: 'create'; type: CategoryType; parentId: string | null }
  | { mode: 'edit'; id: string }
  | { mode: 'fix'; opId: string; id: string; profileId: string; values: CategoryValues }

/** What a top-level category's children do in a merge (rule 15). */
export type CategoryMergeMode = 'move' | 'all'

/** What a merge would do, for the confirm view (rule 15). */
export interface CategoryMergePlan {
  /** Transactions that land on the target (the source's, and merged children's). */
  transactions: number
  /** Children moved under `parentId` (the target, or the target's parent). */
  moved: number
  /** Of the moved ones, merged into a same-named child there instead. */
  clashes: number
  /** Children merged into the target ("all"). */
  merged: number
  /** Where moved children go. */
  parentId: string
}

/** Why a category can't come back from the archive (rules 2, 7, 11). */
export type CategoryUnarchiveRefusal = 'nameTaken' | 'limit' | 'parentArchived'

export const CATEGORY_TABLE = 'categories'

export const CATEGORY_LIMITS = {
  NAME_MAX: 40,
  /** Non-archived categories per profile (rule 11). */
  PER_PROFILE: 200,
} as const

/** A new category's icon (rule 9), also shown for an icon this build doesn't know. */
export const CATEGORY_DEFAULT_ICON = 'lucideShapes'
