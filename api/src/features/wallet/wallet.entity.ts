// docs/features/wallet.md → Data model. A type alias (not an interface), so it fits the sync
// layer's `Record<string, unknown>` rows.
export type Wallet = {
  id: string
  profileId: string
  name: string
  /** ISO 4217, e.g. `THB`. */
  currencyCode: string
  /** Minor units of `currencyCode`, may be negative. */
  initialBalance: number
  /** A lucide or `tpn` icon name, e.g. `lucideWallet`. */
  icon: string
  /** `#rrggbb`. */
  color: string
  excludeFromTotal: boolean
  isArchived: boolean
  sortOrder: number
  createdAt: number
  updatedAt: number
  deletedAt: number | null
  changeSeq: number
  updatedBy: string
}
