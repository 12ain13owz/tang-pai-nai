import type { SyncRow, SyncRowInput, SyncRowWrite } from '@/core/sync'
import type { HistoryEntry, OpResult, SyncNotice } from './sync.entity'

export interface StoredOp {
  userId: string
  result: OpResult
}

export interface SyncRepository {
  /** Runs `work` in one write transaction; it receives a repository bound to it. */
  transaction<T>(work: (tx: SyncRepository) => Promise<T>): Promise<T>
  /** The next `changeSeq` from the database-wide counter. */
  nextSeq(): Promise<number>
  /** The highest `changeSeq` handed out so far (every row up to it has committed). */
  lastSeq(): Promise<number>
  purgedSeq(): Promise<number>
  raisePurgedSeq(seq: number): Promise<void>
  findOp(opId: string): Promise<StoredOp | null>
  saveOp(op: {
    opId: string
    userId: string
    deviceId: string
    appliedAt: number
    result: OpResult
  }): Promise<void>
  addHistory(entry: HistoryEntry): Promise<void>
  /** Notices pull carries to `deviceId` of `userId` with `since < changeSeq <= upTo` (rule 12). */
  notices(userId: string, deviceId: string, since: number, upTo: number): Promise<SyncNotice[]>
  deleteOpsBefore(before: number): Promise<number>

  // Per-table work, through the table's registered handler.
  pull(table: string, userId: string, since: number, limit: number): Promise<SyncRow[]>
  find(table: string, id: string): Promise<{ ownerId: string; row: SyncRow } | null>
  check(table: string, userId: string, row: SyncRowInput): Promise<string | null>
  write(table: string, userId: string, row: SyncRowWrite): Promise<SyncRow>
  purge(table: string, before: number): Promise<{ removed: number; maxSeq: number }>
}
