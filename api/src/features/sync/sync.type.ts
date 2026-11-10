import type { OpResult } from './sync.entity'

export interface SyncPushData {
  results: OpResult[]
}

/** What `GET /sync/cleanup` removed (rule 9). */
export interface SyncCleanupData {
  tombstones: number
  ops: number
}
