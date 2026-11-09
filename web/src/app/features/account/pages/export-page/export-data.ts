import { CATEGORY_TABLE } from '@/core/category'
import type { CategoryType } from '@/core/category'
import type { LocalDatabase, SqlValue } from '@/core/offline'
import { EVENT_TABLE } from '@/core/transaction'
import {
  DEBT_ENTRY_SIGN_SQL,
  DEBT_ENTRY_TABLE,
  DEBT_TABLE,
  TRANSACTION_TABLE,
  TRANSFER_TABLE,
  WALLET_TABLE,
} from '@/core/wallet'
import { toDecimalString } from '@/shared/utils'
import { csvText, toCsv } from './csv'

/** What the export page has chosen (docs/features/export.md rule 2); null = all. */
export interface ExportQuery {
  profileId: string
  from: string | null
  to: string | null
  walletIds: readonly string[] | null
  categoryIds: readonly string[] | null
  /** Transfers and debt entries; ignored when some categories are chosen. */
  others: boolean
}

/** One line of the file (rule 4). */
export interface ExportRow {
  occurredOn: string
  createdAt: number
  id: string
  kind: 'income' | 'expense' | 'out' | 'in' | 'debt'
  /** A debt entry's label key (`debts.entry.<direction>.<kind>`) and person. */
  debtKey: string
  person: string
  parentName: string
  categoryName: string
  walletName: string
  /** Signed minor units: + money in, − money out. */
  amount: number
  currencyCode: string
  note: string
  eventName: string
  excluded: boolean
}

/** A wallet or category to tick in a picker, with how many of its rows the file can hold. */
export interface PickRow {
  id: string
  name: string
  icon: string
  color: string
  archived: boolean
  count: number
  children: PickRow[]
}

const inList = (column: string, ids: readonly string[]) =>
  `${column} IN (${ids.map(() => '?').join(', ')})`

/** The WHERE of one table's rows, with its date and wallet parts. */
const whereOf = (
  alias: string,
  query: ExportQuery,
  walletColumn: string
): { sql: string; params: SqlValue[] } => {
  const parts = [`${alias}.profile_id = ?`, `${alias}.deleted_at IS NULL`]
  const params: SqlValue[] = [query.profileId]
  if (query.from) {
    parts.push(`${alias}.occurred_on >= ?`)
    params.push(query.from)
  }
  if (query.to) {
    parts.push(`${alias}.occurred_on <= ?`)
    params.push(query.to)
  }
  if (query.walletIds) {
    parts.push(inList(`${alias}.${walletColumn}`, query.walletIds))
    params.push(...query.walletIds)
  }
  return { sql: parts.join(' AND '), params }
}

const transactionWhere = (query: ExportQuery) => {
  const where = whereOf('t', query, 'wallet_id')
  if (query.categoryIds) {
    where.sql += ` AND ${inList('t.category_id', query.categoryIds)}`
    where.params.push(...query.categoryIds)
  }
  return where
}

const withOthers = (query: ExportQuery): boolean => query.others && query.categoryIds === null

const nothing = (query: ExportQuery): boolean =>
  query.walletIds?.length === 0 || query.categoryIds?.length === 0

/** How many lines the file would hold (rule 3): a few counts through the local indexes. */
export const exportCount = (db: LocalDatabase, query: ExportQuery): number => {
  if (nothing(query)) {
    return 0
  }
  const tx = transactionWhere(query)
  let count = Number(
    db.selectValue(`SELECT count(*) FROM ${TRANSACTION_TABLE} t WHERE ${tx.sql}`, tx.params)
  )
  if (withOthers(query)) {
    for (const side of ['from_wallet_id', 'to_wallet_id']) {
      const where = whereOf('r', query, side)
      count += Number(
        db.selectValue(`SELECT count(*) FROM ${TRANSFER_TABLE} r WHERE ${where.sql}`, where.params)
      )
    }
    const debt = whereOf('e', query, 'wallet_id')
    count += Number(
      db.selectValue(
        `SELECT count(*) FROM ${DEBT_ENTRY_TABLE} e WHERE ${debt.sql} AND e.wallet_id IS NOT NULL`,
        debt.params
      )
    )
  }
  return count
}

const text = (value: unknown): string => (typeof value === 'string' ? value : '')

const transactionRows = (db: LocalDatabase, query: ExportQuery): ExportRow[] => {
  const where = transactionWhere(query)
  return db
    .selectObjects(
      `SELECT t.id, t.occurred_on, t.created_at, t.amount, t.note, t.exclude_from_report,
         c.type AS c_type, c.name AS c_name, p.name AS p_name,
         w.name AS w_name, w.currency_code AS w_currency, ev.name AS ev_name
       FROM ${TRANSACTION_TABLE} t
       LEFT JOIN ${CATEGORY_TABLE} c ON c.id = t.category_id
       LEFT JOIN ${CATEGORY_TABLE} p ON p.id = c.parent_id
       LEFT JOIN ${WALLET_TABLE} w ON w.id = t.wallet_id
       LEFT JOIN ${EVENT_TABLE} ev ON ev.id = t.event_id AND ev.deleted_at IS NULL
       WHERE ${where.sql}`,
      where.params
    )
    .map((row) => {
      const income = row['c_type'] === 'income'
      const amount = Number(row['amount'])
      return {
        occurredOn: String(row['occurred_on']),
        createdAt: Number(row['created_at']),
        id: String(row['id']),
        kind: income ? ('income' as const) : ('expense' as const),
        debtKey: '',
        person: '',
        parentName: text(row['p_name']),
        categoryName: text(row['c_name']),
        walletName: text(row['w_name']),
        amount: income ? amount : -amount,
        currencyCode: text(row['w_currency']),
        note: text(row['note']),
        eventName: text(row['ev_name']),
        excluded: Number(row['exclude_from_report']) === 1,
      }
    })
}

const transferRows = (db: LocalDatabase, query: ExportQuery): ExportRow[] =>
  (['out', 'in'] as const).flatMap((side) => {
    const column = side === 'out' ? 'from_wallet_id' : 'to_wallet_id'
    const where = whereOf('r', query, column)
    return db
      .selectObjects(
        `SELECT r.id, r.occurred_on, r.created_at, r.amount, r.note,
           w.name AS w_name, w.currency_code AS w_currency
         FROM ${TRANSFER_TABLE} r LEFT JOIN ${WALLET_TABLE} w ON w.id = r.${column}
         WHERE ${where.sql}`,
        where.params
      )
      .map((row) => ({
        occurredOn: String(row['occurred_on']),
        createdAt: Number(row['created_at']),
        id: String(row['id']),
        kind: side,
        debtKey: '',
        person: '',
        parentName: '',
        categoryName: '',
        walletName: text(row['w_name']),
        amount: side === 'out' ? -Number(row['amount']) : Number(row['amount']),
        currencyCode: text(row['w_currency']),
        note: text(row['note']),
        eventName: '',
        excluded: false,
      }))
  })

const debtRows = (db: LocalDatabase, query: ExportQuery): ExportRow[] => {
  const where = whereOf('e', query, 'wallet_id')
  return db
    .selectObjects(
      `SELECT e.id, e.occurred_on, e.created_at, e.kind, e.note, ${DEBT_ENTRY_SIGN_SQL} AS signed,
         d.direction AS d_direction, d.person AS d_person,
         w.name AS w_name, w.currency_code AS w_currency
       FROM ${DEBT_ENTRY_TABLE} e
       JOIN ${DEBT_TABLE} d ON d.id = e.debt_id
       LEFT JOIN ${WALLET_TABLE} w ON w.id = e.wallet_id
       WHERE ${where.sql} AND e.wallet_id IS NOT NULL`,
      where.params
    )
    .map((row) => ({
      occurredOn: String(row['occurred_on']),
      createdAt: Number(row['created_at']),
      id: String(row['id']),
      kind: 'debt' as const,
      debtKey: `debts.entry.${row['d_direction'] === 'lent' ? 'lent' : 'borrowed'}.${
        row['kind'] === 'principal' ? 'principal' : 'repayment'
      }`,
      person: text(row['d_person']),
      parentName: '',
      categoryName: '',
      walletName: text(row['w_name']),
      amount: Number(row['signed']),
      currencyCode: text(row['w_currency']),
      note: text(row['note']),
      eventName: '',
      excluded: false,
    }))
}

/** A transfer's outgoing side before its incoming one on the same row (rule 4). */
const SIDE_ORDER: Record<ExportRow['kind'], number> = {
  income: 0,
  expense: 0,
  debt: 0,
  out: 0,
  in: 1,
}

/** The file's lines in order: oldest day first, then as recorded (rule 4). */
export const exportRows = (db: LocalDatabase, query: ExportQuery): ExportRow[] => {
  if (nothing(query)) {
    return []
  }
  const rows = transactionRows(db, query)
  if (withOthers(query)) {
    rows.push(...transferRows(db, query), ...debtRows(db, query))
  }
  return rows.sort(
    (a, b) =>
      a.occurredOn.localeCompare(b.occurredOn) ||
      a.createdAt - b.createdAt ||
      a.id.localeCompare(b.id) ||
      SIDE_ORDER[a.kind] - SIDE_ORDER[b.kind]
  )
}

/** The CSV text (rules 5–6); `t` translates in the UI language, `minorUnit` per currency. */
export const exportCsv = (
  rows: readonly ExportRow[],
  t: (key: string) => string,
  minorUnit: (code: string) => number
): string => {
  const kindText = (row: ExportRow) => {
    if (row.kind === 'debt') {
      return row.person ? `${t(row.debtKey)} · ${row.person}` : t(row.debtKey)
    }
    return t(`export.kind.${row.kind}`)
  }
  const head = [
    'date',
    'type',
    'parent',
    'category',
    'wallet',
    'amount',
    'currency',
    'note',
    'event',
    'excluded',
  ].map((key) => t(`export.column.${key}`))
  const yes = t('export.yes')
  return toCsv([
    head,
    ...rows.map((row) => [
      row.occurredOn,
      csvText(kindText(row)),
      csvText(row.parentName),
      csvText(row.categoryName),
      csvText(row.walletName),
      toDecimalString(row.amount, minorUnit(row.currencyCode)),
      row.currencyCode,
      csvText(row.note),
      csvText(row.eventName),
      row.excluded ? yes : '',
    ]),
  ])
}

/** The profile's live wallets (archived too) with how many rows each holds (rule 2). */
export const walletChoices = (db: LocalDatabase, profileId: string): PickRow[] =>
  db
    .selectObjects(
      `SELECT w.id, w.name, w.icon, w.color, w.is_archived,
         (SELECT count(*) FROM ${TRANSACTION_TABLE} t WHERE t.wallet_id = w.id AND t.deleted_at IS NULL)
         + (SELECT count(*) FROM ${TRANSFER_TABLE} r
            WHERE (r.from_wallet_id = w.id OR r.to_wallet_id = w.id) AND r.deleted_at IS NULL)
         + (SELECT count(*) FROM ${DEBT_ENTRY_TABLE} e WHERE e.wallet_id = w.id AND e.deleted_at IS NULL)
         AS n
       FROM ${WALLET_TABLE} w
       WHERE w.profile_id = ? AND w.deleted_at IS NULL
       ORDER BY w.is_archived, w.sort_order, w.created_at, w.id`,
      [profileId]
    )
    .map((row) => ({
      id: String(row['id']),
      name: text(row['name']),
      icon: text(row['icon']),
      color: text(row['color']),
      archived: Number(row['is_archived']) === 1,
      count: Number(row['n']),
      children: [],
    }))

/**
 * The profile's live categories of `type` as a tree (archived too, merged ones are tombstones
 * so they don't show), each with its own transaction count (rule 2).
 */
export const categoryChoices = (
  db: LocalDatabase,
  profileId: string,
  type: CategoryType
): PickRow[] => {
  const rows = db.selectObjects(
    `SELECT c.id, c.parent_id, c.name, c.icon, c.color, c.is_archived,
       (SELECT count(*) FROM ${TRANSACTION_TABLE} t
        WHERE t.category_id = c.id AND t.deleted_at IS NULL) AS n
     FROM ${CATEGORY_TABLE} c
     WHERE c.profile_id = ? AND c.type = ? AND c.deleted_at IS NULL
     ORDER BY c.is_archived, c.sort_order, c.created_at, c.id`,
    [profileId, type]
  )
  const toPick = (row: Record<string, unknown>): PickRow => ({
    id: String(row['id']),
    name: text(row['name']),
    icon: text(row['icon']),
    color: text(row['color']),
    archived: Number(row['is_archived']) === 1,
    count: Number(row['n']),
    children: [],
  })
  const parents = rows.filter((row) => typeof row['parent_id'] !== 'string').map(toPick)
  const byId = new Map(parents.map((parent) => [parent.id, parent]))
  for (const row of rows) {
    const parent = typeof row['parent_id'] === 'string' ? byId.get(row['parent_id']) : undefined
    parent?.children.push(toPick(row))
  }
  return parents
}

/** The first and last day the profile has a money row on, for "ทั้งหมด" (rule 2). */
export const dataSpan = (
  db: LocalDatabase,
  profileId: string
): { from: string; to: string } | null => {
  const row = db
    .selectObjects(
      `SELECT min(d) AS f, max(d) AS l FROM (
         SELECT min(occurred_on) AS d FROM ${TRANSACTION_TABLE} WHERE profile_id = ? AND deleted_at IS NULL
         UNION ALL SELECT max(occurred_on) FROM ${TRANSACTION_TABLE} WHERE profile_id = ? AND deleted_at IS NULL
         UNION ALL SELECT min(occurred_on) FROM ${TRANSFER_TABLE} WHERE profile_id = ? AND deleted_at IS NULL
         UNION ALL SELECT max(occurred_on) FROM ${TRANSFER_TABLE} WHERE profile_id = ? AND deleted_at IS NULL)`,
      [profileId, profileId, profileId, profileId]
    )
    .at(0)
  return typeof row?.['f'] === 'string' && typeof row['l'] === 'string'
    ? { from: row['f'], to: row['l'] }
    : null
}
