import type { Executor } from '@/core/database'

// The per-table contract between a feature and `features/sync` (docs/features/offline-sync.md →
// Interactions). Features can't import each other, so each one registers a handler here from its
// own `index.ts`, and the sync feature reads the registry.

/** A synced row as it travels in `/sync/pull` and push results: the table's own fields, camelCase. */
export type SyncRow = {
  id: string
  changeSeq: number
  updatedAt: number
  /** Tables that soft-delete (all user data) carry these two; master data doesn't. */
  deletedAt?: number | null
  updatedBy?: string
} & Record<string, unknown>

/** A row a device pushes, after the feature's validation (server columns not set yet). */
export type SyncRowInput = {
  id: string
  createdAt: number
  updatedAt: number
  deletedAt: number | null
} & Record<string, unknown>

/** The row to store: the input plus what the server stamps (rule 10). */
export type SyncRowWrite = SyncRowInput & { changeSeq: number; updatedBy: string }

export type SyncValidation = { ok: true; row: SyncRowInput } | { ok: false; message: string }

/**
 * Rows an editor of a shared wallet may write too (docs/features/sharing.md rules 11–14). The
 * row is stored as the owner's; sync checks who may write it, the table says which fields only
 * the owner (or the server) sets.
 */
export interface SyncSharedRows {
  /** The wallet a pushed or stored row lives in, or null when it names none. */
  walletOf(row: Record<string, unknown>): string | null
  /** The version to store when an editor writes it: owner-only fields come from `stored`. */
  forEditor(row: SyncRowInput, stored: SyncRow | null, editorId: string): SyncRowInput
  /** The version to store when the owner writes it: keeps what the server set (`addedBy`). */
  forOwner(row: SyncRowInput, stored: SyncRow | null): SyncRowInput
}

/** The handler half that accepts pushes. A pull-only table (master data) has none. */
export interface SyncPushHandler {
  /** The feature's own validation of a pushed row (pure, no database). */
  validate(row: unknown): SyncValidation
  /** The row with this id, whoever owns it, tombstones included. */
  find(executor: Executor, id: string): Promise<{ ownerId: string; row: SyncRow } | null>
  /** A feature rule about other rows (e.g. a unique name); the message when it's broken. */
  check(executor: Executor, userId: string, row: SyncRowInput): Promise<string | null>
  /**
   * Optional: adjusts a pushed live row before the conflict rules and `check` (a transaction on
   * a merged category moves to the category it was merged into, category rule 15).
   */
  resolve?(executor: Executor, userId: string, row: SyncRowInput): Promise<SyncRowInput>
  /**
   * Optional: a pushed **create** (`baseSeq` null) of a row the server already has keeps the
   * server's row and answers it as `overridden`, with no conflict notice, when this is true. Two
   * devices record one occurrence of a recurring rule under the same id (recurring rule 9), so
   * the second one must not undo an edit or a skip made since.
   */
  keepsStored?(row: SyncRowInput): boolean
  /**
   * Optional: two versions of a row that differ in nothing the user would call a change (a
   * recurring rule's `nextOn`, recurring rule 9). A conflict between them writes no notice.
   */
  sameChange?(a: Record<string, unknown>, b: Record<string, unknown>): boolean
  /** Inserts or replaces the row, owned by `userId`; answers it as pull would. */
  write(executor: Executor, userId: string, row: SyncRowWrite): Promise<SyncRow>
  /**
   * Optional: writes on other rows that a written row implies, in the same transaction (a merged
   * category's tombstone moves what still points at it, category rule 15). Each written row needs
   * its own `changeSeq`: `takeSeqs(n)` reserves `n` in a row and answers the first.
   */
  followUp?(
    executor: Executor,
    userId: string,
    row: SyncRow,
    takeSeqs: (count: number) => Promise<number>
  ): Promise<void>
  /** Optional (#16.2): the table's rows may be written by editors of a shared wallet. */
  shared?: SyncSharedRows
  /** Deletes tombstones deleted before `before`; the count and the highest `changeSeq` removed. */
  purge(executor: Executor, before: number): Promise<{ removed: number; maxSeq: number }>
}

export interface SyncTableHandler {
  /** The table name devices use, e.g. `currencies`. */
  table: string
  /** Rows `userId` may sync with `changeSeq > since`, by `changeSeq`, at most `limit`. */
  pull(executor: Executor, userId: string, since: number, limit: number): Promise<SyncRow[]>
  push?: SyncPushHandler
}
