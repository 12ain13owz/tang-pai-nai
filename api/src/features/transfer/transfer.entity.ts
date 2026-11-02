// docs/features/transfer.md → Data model. A type alias (not an interface), so it fits the sync
// layer's `Record<string, unknown>` rows.
export type Transfer = {
  id: string
  profileId: string
  fromWalletId: string
  toWalletId: string
  /** Minor units, always > 0. */
  amount: number
  /** `YYYY-MM-DD`. */
  occurredOn: string
  /** `''` when empty. */
  note: string
  createdAt: number
  updatedAt: number
  deletedAt: number | null
  changeSeq: number
  updatedBy: string
}
