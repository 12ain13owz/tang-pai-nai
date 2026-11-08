// docs/features/recurring.md → Data model. A type alias (not an interface), so it fits the sync
// layer's `Record<string, unknown>` rows.
export type RecurringRule = {
  id: string
  profileId: string
  /** `transaction` | `transfer`. */
  kind: string
  /** The transaction's wallet, or the wallet a transfer leaves. */
  walletId: string
  categoryId: string | null
  toWalletId: string | null
  /** Minor units, always > 0. */
  amount: number
  note: string
  excludeFromReport: boolean
  /** `YYYY-MM-DD`. */
  startOn: string
  /** `day` | `week` | `month` | `year`. */
  frequency: string
  interval: number
  endOn: string | null
  endCount: number | null
  confirm: boolean
  /** The first occurrence not recorded or skipped yet; null once ended. */
  nextOn: string | null
  isPaused: boolean
  createdAt: number
  updatedAt: number
  deletedAt: number | null
  changeSeq: number
  updatedBy: string
}
