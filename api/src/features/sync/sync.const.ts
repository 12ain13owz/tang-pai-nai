export const SYNC_LIMITS = {
  /** Ops per push request (offline-sync rule 10). */
  MAX_OPS: 100,
  PULL_DEFAULT: 500,
  PULL_MAX: 1000,
  /** Tombstones and `sync_ops` older than this are purged (rule 9). */
  RETENTION_MS: 90 * 24 * 60 * 60 * 1000,
} as const

/** Error codes the web app switches on (offline-sync → Endpoints). */
export const SyncErrorCode = {
  CURSOR_EXPIRED: 'CURSOR_EXPIRED',
} as const

/** Why a pushed op was `rejected` (offline-sync → Endpoints). */
export const SyncRejectCode = {
  VALIDATION: 'VALIDATION',
  CONFLICT: 'CONFLICT',
  ID_TAKEN: 'ID_TAKEN',
  UNKNOWN_TABLE: 'UNKNOWN_TABLE',
  READ_ONLY: 'READ_ONLY',
  /** An editor's update or delete whose `baseSeq` isn't the row's current one (sharing rule 13). */
  STALE: 'STALE',
  /** The row's wallet isn't shared with the caller as editor (sharing rules 11, 13). */
  NOT_SHARED: 'NOT_SHARED',
} as const
export type SyncRejectCode = (typeof SyncRejectCode)[keyof typeof SyncRejectCode]

export const SYNC_MESSAGE = {
  PUSHED: 'Sync push processed',
  PULLED: 'Sync pull processed',
  CURSOR_EXPIRED: 'The sync cursor is older than the retention period; resync from 0',
  ID_TAKEN: 'This id belongs to another user',
  UNKNOWN_TABLE: 'This table does not sync',
  READ_ONLY: 'This table is read-only for devices',
  STALE: 'This row changed since you read it; reload it',
  NOT_SHARED: 'This wallet is not shared with you as an editor',
}
