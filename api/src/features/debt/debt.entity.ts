// docs/features/debt.md → Data model. Type aliases (not interfaces), so they fit the sync layer's
// `Record<string, unknown>` rows.
export type Debt = {
  id: string
  profileId: string
  /** `borrowed` | `lent`. */
  direction: string
  person: string
  note: string
  currencyCode: string
  /** `spent` | `repaid`. */
  countAs: string
  categoryId: string | null
  /** `YYYY-MM-DD` or null. */
  dueOn: string | null
  createdAt: number
  updatedAt: number
  deletedAt: number | null
  changeSeq: number
  updatedBy: string
}

export type DebtEntry = {
  id: string
  profileId: string
  debtId: string
  /** `principal` | `repayment`. */
  kind: string
  walletId: string | null
  /** Minor units, always > 0. */
  amount: number
  /** `YYYY-MM-DD`. */
  occurredOn: string
  note: string
  recurringId: string | null
  createdAt: number
  updatedAt: number
  deletedAt: number | null
  changeSeq: number
  updatedBy: string
}
