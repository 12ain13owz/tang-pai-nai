import type { SyncRow } from '@/core/sync'
import type { SyncRejectCode } from './sync.const'

// docs/features/offline-sync.md → Endpoints.

export interface PushOp {
  opId: string
  table: string
  op: 'upsert' | 'delete'
  row: { id: string } & Record<string, unknown>
  baseSeq: number | null
}

/** A conflict notice: the version that lost (rule 12). */
export interface SyncNotice {
  id: string
  table: string
  rowId: string
  previous: Record<string, unknown>
  overwrittenBy: string
  createdAt: number
}

export type OpResult =
  | { opId: string; status: 'applied'; row: SyncRow | null; changeSeq: number | null }
  | { opId: string; status: 'overridden'; row: SyncRow; changeSeq: number; notice: SyncNotice }
  | { opId: string; status: 'rejected'; row: SyncRow | null; code: SyncRejectCode; message: string }

export interface HistoryEntry {
  id: string
  table: string
  rowId: string
  overwrittenBy: string
  overwrittenByDevice: string
  previous: Record<string, unknown>
  loserUserId: string
  loserDeviceId: string | null
  changeSeq: number
  createdAt: number
}

export interface PullChange {
  table: string
  row: SyncRow
}

export interface PullResult {
  changes: PullChange[]
  notices: SyncNotice[]
  cursor: number
  hasMore: boolean
  tables: string[]
}
