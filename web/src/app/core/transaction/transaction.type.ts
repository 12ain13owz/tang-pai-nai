import type { CategoryType } from '@/core/category'

/** A transaction as the device stores it (docs/features/transaction.md → Data model). */
export interface Transaction {
  id: string
  profileId: string
  walletId: string
  categoryId: string
  /** Minor units, always > 0; the sign comes from the category's type. */
  amount: number
  /** `YYYY-MM-DD`, the device's local date. */
  occurredOn: string
  /** `''` when empty. */
  note: string
  excludeFromReport: boolean
  createdAt: number
  updatedAt: number
  deletedAt: number | null
  /** Null until the server has seen the row. */
  changeSeq: number | null
}

/** A row of the list: the transaction with what it shows of its category and wallet. */
export interface TransactionItem extends Transaction {
  kind: 'transaction'
  type: CategoryType
  categoryName: string
  categoryIcon: string
  categoryColor: string
  walletName: string
  currencyCode: string
}

/** A transfer as the device stores it (docs/features/transfer.md → Data model). */
export interface Transfer {
  id: string
  profileId: string
  fromWalletId: string
  toWalletId: string
  /** Minor units, always > 0. */
  amount: number
  occurredOn: string
  note: string
  createdAt: number
  updatedAt: number
  deletedAt: number | null
  changeSeq: number | null
}

/**
 * One side of a transfer as a row of the list (transfer → Web screens, owner's choice Q5): the
 * outgoing side (− in the expense colour) or the incoming one (+ in the income colour).
 */
export interface TransferItem extends Transfer {
  kind: 'transfer'
  side: 'out' | 'in'
  /** The wallet this row is a side of, and the other one. */
  walletId: string
  walletName: string
  otherWalletId: string
  otherWalletName: string
  currencyCode: string
}

/** A row of the Transactions tab. */
export type EntryItem = TransactionItem | TransferItem

/** What the transfer form edits. */
export interface TransferValues {
  fromWalletId: string
  toWalletId: string
  amount: number
  occurredOn: string
  note: string
}

/** Which transfer sheet is open. */
export type TransferSheetState =
  | { mode: 'create'; fromWalletId?: string; values?: TransferValues }
  | { mode: 'edit'; id: string }
  | { mode: 'fix'; opId: string; id: string; profileId: string; values: TransferValues }

/** What the transaction form edits. */
export interface TransactionValues {
  walletId: string
  categoryId: string
  amount: number
  occurredOn: string
  note: string
  excludeFromReport: boolean
}

/** Days from `from` to `to`, both included; null is open on that side. */
export interface DayRange {
  from: string | null
  to: string | null
}

/** One currency's income, expense and net (rule 11). */
export interface MoneySummary {
  currencyCode: string
  minorUnit: number
  income: number
  expense: number
  net: number
  /** Transfers in − out of the wallets in view (transfer → Web screens: the "โอน" line). */
  transfer: number
}

/** Which transaction sheet is open: create, edit, or "fix" of a rejected op. */
export type TransactionSheetState =
  | {
      mode: 'create'
      walletId?: string
      occurredOn?: string
      /** "Copy" (8.2): the values to start from; the date still starts on today. */
      values?: TransactionValues
      type?: CategoryType
    }
  | { mode: 'edit'; id: string }
  | { mode: 'fix'; opId: string; id: string; profileId: string; values: TransactionValues }

export const TRANSACTION_TABLE = 'transactions'
export const TRANSFER_TABLE = 'transfers'

export const TRANSACTION_LIMITS = {
  /** 10¹⁵ minor units (rule 3). */
  AMOUNT_MAX: 1_000_000_000_000_000,
  NOTE_MAX: 500,
  FIRST_DAY: '2000-01-01',
} as const

/** Where the device keeps per-profile choices: the last wallet used (a wipe removes it). */
export const TRANSACTION_PREF_PREFIX = 'tpn-profile:tx:'
