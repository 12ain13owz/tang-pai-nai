// docs/features/recurring.md → Data model. A type alias (not an interface), so it fits the sync
// layer's `Record<string, unknown>` rows.
export type RecurringRule = {
  id: string
  profileId: string
  /** `transaction` | `transfer` | `debt`. */
  kind: string
  /** The transaction's wallet, or the wallet a transfer leaves. */
  walletId: string
  categoryId: string | null
  toWalletId: string | null
  /** A `debt` rule's debt, or a transaction rule's (instalments); else null. */
  debtId: string | null
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
