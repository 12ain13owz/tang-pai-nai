/**
 * The device tables of debts (docs/features/debt.md), read by name by the services `core/debt`
 * builds on (wallets, categories, transactions, recurring rules, reports), which can't import it.
 */
export const DEBT_TABLE = 'debts'
export const DEBT_ENTRY_TABLE = 'debt_entries'

/**
 * The signed amount of a debt entry in its wallet (debt rule 7), as SQL over an entry `e` joined
 * to its debt `d`: borrowing in and being paid back add, lending out and repaying take away.
 */
export const DEBT_ENTRY_SIGN_SQL = `CASE WHEN (e.kind = 'principal') = (d.direction = 'borrowed')
  THEN e.amount ELSE -e.amount END`

/**
 * Whether a linked transaction `t` (its category `c`) settles its debt `d` (debt.md → Data
 * model): only an instalment of a `repaid` debt (an expense). Interest doesn't, and neither does
 * a forgiven rest's transaction: its repayment entry settles the debt (debt rule 4).
 */
export const DEBT_SETTLES_SQL = `(d.count_as = 'repaid' AND c.type = 'expense')`

/**
 * A linked transaction that counts a forgiven rest (debt rule 4): an expense of a lent debt
 * (written off), an income of a borrowed one (the lender forgave it). Interest is the other way.
 */
export const DEBT_FORGIVES_SQL = `((d.direction = 'lent' AND c.type = 'expense')
  OR (d.direction = 'borrowed' AND d.count_as = 'spent' AND c.type = 'income'))`

/**
 * What is left of debt `d` (minor units): Σ principal − Σ repayment − the linked transactions
 * that settle it. 0 = closed (debt rule 4).
 */
export const DEBT_LEFT_SQL = `(
  coalesce((SELECT sum(CASE e.kind WHEN 'principal' THEN e.amount ELSE -e.amount END)
            FROM ${DEBT_ENTRY_TABLE} e WHERE e.debt_id = d.id AND e.deleted_at IS NULL), 0)
  - coalesce((SELECT sum(t.amount) FROM transactions t JOIN categories c ON c.id = t.category_id
              WHERE t.debt_id = d.id AND t.deleted_at IS NULL AND ${DEBT_SETTLES_SQL}), 0))`
