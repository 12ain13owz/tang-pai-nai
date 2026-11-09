import type { RepeatValues } from '@/core/recurring'

/** `borrowed` (ยืมมา) or `lent` (ให้ยืม). */
export type DebtDirection = 'borrowed' | 'lent'

/** When the money counts as an expense (debt rule 3, Q1): when spent, or when repaid. */
export type DebtCountAs = 'spent' | 'repaid'

/** A debt as the device stores it (docs/features/debt.md → Data model). */
export interface Debt {
  id: string
  profileId: string
  direction: DebtDirection
  person: string
  note: string
  currencyCode: string
  countAs: DebtCountAs
  /** A `repaid` debt's instalments category; null otherwise. */
  categoryId: string | null
  /** `YYYY-MM-DD` or null. */
  dueOn: string | null
  createdAt: number
  updatedAt: number
  deletedAt: number | null
  changeSeq: number | null
}

/** Money of a debt that is not income or expense (debt rule 3). */
export interface DebtEntry {
  id: string
  profileId: string
  debtId: string
  kind: 'principal' | 'repayment'
  /** Null only on a `repaid` debt (its principal, a forgiven rest). */
  walletId: string | null
  /** Minor units, always > 0. */
  amount: number
  occurredOn: string
  note: string
  recurringId: string | null
  createdAt: number
  updatedAt: number
  deletedAt: number | null
  changeSeq: number | null
}

/** A debt with what is computed from its rows (never stored, debt rule 4). */
export interface DebtItem {
  debt: Debt
  minorUnit: number
  /** Σ principal. */
  total: number
  /** Repaid or settled so far. */
  paid: number
  /** What is left; ≤ 0 is closed (< 0: overpaid). */
  left: number
  /** Linked transactions that don't settle it (interest). */
  interest: number
  /** Settling transactions of a `repaid` debt (its instalments). */
  instalments: number
  /** The latest day of its rows (when it was closed). */
  lastOn: string | null
  closed: boolean
  /** Closed by forgiving the rest, not by paying it. */
  forgiven: boolean
  overdue: boolean
}

/** A row of a debt's history: an entry or a linked transaction. */
export type DebtHistoryItem =
  | {
      kind: 'entry'
      id: string
      entry: DebtEntry
      walletName: string
      walletIcon: string
      walletColor: string
      /** In the wallet's terms: borrowing in and being paid back are +. */
      signed: number
    }
  | {
      kind: 'transaction'
      id: string
      occurredOn: string
      createdAt: number
      amount: number
      note: string
      type: 'income' | 'expense'
      categoryName: string
      categoryIcon: string
      categoryColor: string
      walletName: string
      walletIcon: string
      walletColor: string
      settles: boolean
    }

/** What the debt form creates (debt → Web screens). */
export interface DebtValues {
  direction: DebtDirection
  person: string
  note: string
  countAs: DebtCountAs
  categoryId: string | null
  dueOn: string | null
  /** The principal, minor units. */
  amount: number
  /** Where the money came in or went out; null for a `repaid` debt. */
  walletId: string | null
  occurredOn: string
  currencyCode: string
}

/** What an edit of a debt changes (its money lives in its rows). */
export type DebtEdit = Pick<DebtValues, 'person' | 'note' | 'dueOn' | 'categoryId'>

/** Instalments set in the debt form (debt rule 13): one recurring rule. */
export interface PlanValues {
  repeat: RepeatValues
  startOn: string
  amount: number
  walletId: string
}

/** What the entry sheet saves. */
export interface EntryValues {
  kind: 'principal' | 'repayment'
  amount: number
  walletId: string | null
  occurredOn: string
  note: string
}

/** Interest or a fee paid (received) with a repayment: a counted transaction (debt rule 5, Q5). */
export interface InterestValues {
  amount: number
  categoryId: string
}

/** Which debt sheet is open. */
export type DebtSheetState =
  | { mode: 'create'; direction: DebtDirection }
  | { mode: 'edit'; id: string }
  | { mode: 'fix'; opId: string }

/** Which entry sheet is open. */
export type EntrySheetState =
  | { mode: 'create'; debtId: string; kind: 'principal' | 'repayment' }
  | { mode: 'edit'; id: string }
  | { mode: 'fix'; opId: string }
  /** A repayment rule (kind `debt`, debt rule 13). */
  | { mode: 'rule'; id: string }

export const DEBT_LIMITS = {
  PERSON_MAX: 50,
  NOTE_MAX: 500,
  /** Open debts per profile (debt rule 1). */
  OPEN_PER_PROFILE: 100,
} as const

/** Where the debts live (debt → Web screens, Q9). */
export const DEBTS_ROUTE = '/wallets/debts'

/** Per profile on the device (the interest category per debt), wiped with it. */
export const DEBT_PREF_PREFIX = 'tpn-profile:debt:'
