// docs/features/transaction.md → Data model. A type alias (not an interface), so it fits the
// sync layer's `Record<string, unknown>` rows.
export type Transaction = {
  id: string
  profileId: string
  walletId: string
  categoryId: string
  /** Minor units, always > 0. The sign comes from the category's type. */
  amount: number
  /** `YYYY-MM-DD`. */
  occurredOn: string
  /** `''` when empty. */
  note: string
  excludeFromReport: boolean
  /** The recurring rule it is an occurrence of; null otherwise. */
  recurringId: string | null
  /** The debt it belongs to (debt rule 3); null otherwise. */
  debtId: string | null
  createdAt: number
  updatedAt: number
  deletedAt: number | null
  changeSeq: number
  updatedBy: string
}
