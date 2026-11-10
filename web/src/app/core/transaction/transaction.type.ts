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
  /** The recurring rule it is an occurrence of (docs/features/recurring.md); null otherwise. */
  recurringId: string | null
  /** The debt it belongs to (docs/features/debt.md rule 3); null otherwise. */
  debtId: string | null
  /** The event / trip it is tagged to (docs/features/event.md rule 3); null otherwise. */
  eventId: string | null
  /** The editor of a shared wallet who added it (sharing rule 12); null = the owner. */
  addedBy: string | null
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
  /** The live event it is tagged to, for the row's tag (event → Web screens); null otherwise. */
  eventName: string | null
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
  /** The recurring rule it is an occurrence of; null otherwise. */
  recurringId: string | null
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

/**
 * A debt entry with a wallet as a row of the list (debt → Web screens): money in or out of the
 * wallet that is not income or expense, signed by the wallet (debt rule 7).
 */
export interface DebtEntryItem {
  kind: 'debt'
  id: string
  debtId: string
  /** `principal` | `repayment`. */
  entryKind: 'principal' | 'repayment'
  direction: 'borrowed' | 'lent'
  person: string
  walletId: string
  walletName: string
  currencyCode: string
  /** Minor units, signed by the money in the wallet. */
  signed: number
  amount: number
  occurredOn: string
  note: string
  recurringId: string | null
  createdAt: number
}

/** A row of the Transactions tab. */
export type EntryItem = TransactionItem | TransferItem | DebtEntryItem

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
  | {
      mode: 'create'
      fromWalletId?: string
      values?: TransferValues
      repeat?: boolean
      occurrence?: { ruleId: string; on: string }
    }
  | { mode: 'edit'; id: string }
  | { mode: 'fix'; opId: string; id: string; profileId: string; values: TransferValues }
  /** A transfer recurring rule (docs/features/recurring.md → Web screens). */
  | { mode: 'rule'; id: string }
  | { mode: 'fixRule'; opId: string; id: string }

/** What the transaction form edits. */
export interface TransactionValues {
  walletId: string
  categoryId: string
  amount: number
  occurredOn: string
  note: string
  excludeFromReport: boolean
  /** The debt it belongs to (debt rule 3); absent keeps what the row has. */
  debtId?: string | null
  /** The event it is tagged to (event rule 3); absent keeps what the row has. */
  eventId?: string | null
}

/** Days from `from` to `to`, both included; null is open on that side. */
/** Narrows `TransactionService.list` (the report's drill-downs, report.md). */
export interface ListFilter {
  /** Only rows on these categories. */
  categoryIds?: readonly string[]
  /** Only rows counted in reports, or only the ones left out (`excludeFromReport`). */
  report?: 'counted' | 'excluded'
  /** Only rows of wallets in this currency. */
  currencyCode?: string
  /** Only rows tagged to this event (an event's page, event.md). */
  eventId?: string
}

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
  /** Debt entries in − out of the wallets in view (debt → Web screens: the "หนี้" line). */
  debt: number
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
      /** Start with "ทำซ้ำ" set to every month (the rules page's +, recurring.md). */
      repeat?: boolean
      /** A due occurrence of an ask-first rule, recorded by this save (recurring rule 10). */
      occurrence?: { ruleId: string; on: string }
      /** "เพิ่มรายการ" on an event's page: starts tagged to it, as if chosen (event rule 5). */
      eventId?: string
    }
  | { mode: 'edit'; id: string }
  | { mode: 'fix'; opId: string; id: string; profileId: string; values: TransactionValues }
  /** A transaction recurring rule (docs/features/recurring.md → Web screens). */
  | { mode: 'rule'; id: string }
  /** "Fix" of a rejected recurring rule op, with the refused values. */
  | { mode: 'fixRule'; opId: string; id: string }

export const TRANSACTION_TABLE = 'transactions'
/** The events table, read by name here (the form's picker and default); `core/event` owns it. */
export const EVENT_TABLE = 'events'

/** An event as the transaction form offers it (event.md → Web screens). */
export interface EventOption {
  id: string
  name: string
  icon: string
  color: string
  startOn: string
  endOn: string | null
  isClosed: boolean
}
export const TRANSFER_TABLE = 'transfers'

export const TRANSACTION_LIMITS = {
  /** 10¹⁵ minor units (rule 3). */
  AMOUNT_MAX: 1_000_000_000_000_000,
  NOTE_MAX: 500,
  FIRST_DAY: '2000-01-01',
} as const

/** Where the device keeps per-profile choices: the last wallet used (a wipe removes it). */
export const TRANSACTION_PREF_PREFIX = 'tpn-profile:tx:'
