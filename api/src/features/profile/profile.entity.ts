// docs/features/profile.md → Data model. A type alias (not an interface), so it fits the sync
// layer's `Record<string, unknown>` rows.
export type Profile = {
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
  changeSeq: number
  updatedBy: string
}
