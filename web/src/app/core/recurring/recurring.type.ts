/**
 * `transaction` (income / expense, by the category's type), `transfer`, or `debt` (a debt's
 * repayment, not income or expense: docs/features/debt.md rule 13).
 */
export type RecurringKind = 'transaction' | 'transfer' | 'debt'

/** The unit of a schedule (docs/features/recurring.md rule 3). */
export type RecurringFrequency = 'day' | 'week' | 'month' | 'year'

export const RECURRING_FREQUENCIES: readonly RecurringFrequency[] = ['day', 'week', 'month', 'year']

/** When a rule repeats (rule 3); counted from `startOn` every time. */
export interface RecurringSchedule {
  /** `YYYY-MM-DD`, the first occurrence. */
  startOn: string
  frequency: RecurringFrequency
  /** Every `interval` units, 1–99. */
  interval: number
  /** No occurrence after this day; null: none. */
  endOn: string | null
  /** No occurrence after this many; null: none. */
  endCount: number | null
}

/** What the "ทำซ้ำ" view edits (rule 3 + Q1's choice). */
export interface RepeatValues extends Omit<RecurringSchedule, 'startOn'> {
  /** Ask before recording a due occurrence (rule 10). */
  confirm: boolean
}

/** A rule as the device stores it (docs/features/recurring.md → Data model). */
export interface RecurringRule extends RecurringSchedule {
  id: string
  profileId: string
  kind: RecurringKind
  /** A transaction's wallet, or the wallet a transfer leaves. */
  walletId: string
  categoryId: string | null
  toWalletId: string | null
  /** A `debt` rule's debt, or a transaction rule's (its instalments); else null. */
  debtId: string | null
  /** Minor units, always > 0. */
  amount: number
  note: string
  excludeFromReport: boolean
  confirm: boolean
  /** The first occurrence not recorded or skipped yet; null once the rule has ended. */
  nextOn: string | null
  isPaused: boolean
  createdAt: number
  updatedAt: number
  deletedAt: number | null
  changeSeq: number | null
}

/** What a rule's form saves: the template of its occurrences and its schedule. */
export interface RuleValues extends RepeatValues {
  kind: RecurringKind
  walletId: string
  categoryId: string | null
  toWalletId: string | null
  /** Debt rule 13; absent keeps what the rule has. */
  debtId?: string | null
  amount: number
  note: string
  excludeFromReport: boolean
  startOn: string
}

/** Why a live rule records nothing now. */
export type RuleState = 'active' | 'paused' | 'stopped' | 'ended'

/** A rule as the rules page and the projections show it. */
export interface RuleItem {
  rule: RecurringRule
  state: RuleState
  /** For `stopped`: which archived thing (or closed debt, debt rule 14) stops it (rule 12). */
  stoppedBy: { kind: 'wallet' | 'category' | 'debt'; name: string } | null
  /** Income + (a lent debt's repayment too), expense and transfer −. */
  sign: 1 | -1
  /** A `debt` rule's direction (its title: "คืนเงิน · แม่"); null for any other kind. */
  debtDirection: 'borrowed' | 'lent' | null
  title: string
  icon: string
  color: string
  walletIcon: string
  walletColor: string
  walletName: string
  toWalletName: string
  currencyCode: string
  /** The first occurrence still due (ask-first rules), if any. */
  dueOn: string | null
}

/** An occurrence on the screen that isn't recorded: due (ask first) or still to come. */
export interface Occurrence {
  item: RuleItem
  /** `YYYY-MM-DD`. */
  on: string
  /** The id it will have once recorded (rule 9). */
  id: string
}

export const RECURRING_LIMITS = {
  INTERVAL_MAX: 99,
  COUNT_MAX: 999,
  /** Live rules per profile (rule 1). */
  PER_PROFILE: 100,
  /** Occurrences one rule records in one pass (rule 7). */
  PASS_MAX: 400,
  /** How far "อนาคต" shows occurrences to come (rule 17, Q8). */
  UPCOMING_MONTHS: 3,
} as const

/** The default "ทำซ้ำ" when one is first chosen: every month, no end, recorded by itself. */
export const MONTHLY: RepeatValues = {
  frequency: 'month',
  interval: 1,
  endOn: null,
  endCount: null,
  confirm: false,
}
