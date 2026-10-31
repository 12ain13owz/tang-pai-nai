// Temporary, dev only (docs/features/offline-sync.md → tables synced in 4a.2). Removed at #6.
// A type alias (not an interface), so it fits the sync layer's `Record<string, unknown>` rows.
export type SyncProbe = {
  id: string
  title: string
  /** Satang, integer ≥ 0. */
  amount: number
  createdAt: number
  updatedAt: number
  deletedAt: number | null
  changeSeq: number
  updatedBy: string
}
