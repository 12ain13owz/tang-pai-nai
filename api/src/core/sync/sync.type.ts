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

/** The handler half that accepts pushes. A pull-only table (master data) has none. */
export interface SyncPushHandler {
  /** The feature's own validation of a pushed row (pure, no database). */
  validate(row: unknown): SyncValidation
  /** The row with this id, whoever owns it, tombstones included. */
  find(executor: Executor, id: string): Promise<{ ownerId: string; row: SyncRow } | null>
  /** A feature rule about other rows (e.g. a unique name); the message when it's broken. */
  check(executor: Executor, userId: string, row: SyncRowInput): Promise<string | null>
  /** Inserts or replaces the row, owned by `userId`; answers it as pull would. */
  write(executor: Executor, userId: string, row: SyncRowWrite): Promise<SyncRow>
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
