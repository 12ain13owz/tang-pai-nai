import type { SyncRow, SyncRowInput } from '@/core/sync'
import type { HistoryEntry, OpResult } from './sync.entity'
import type { StoredOp, SyncRepository } from './sync.repository'

interface MemoryState {
  lastSeq: number
  purgedSeq: number
  ops: Map<string, StoredOp & { deviceId: string; appliedAt: number }>
  history: HistoryEntry[]
  tables: Map<string, Map<string, { ownerId: string; row: SyncRow }>>
}

type CheckRule = (rows: SyncRow[], userId: string, row: SyncRowInput) => string | null

export interface MemorySyncOptions {
  /** A feature rule per table (like the probe's unique title): the message when broken. */
  checks?: Record<string, CheckRule>
  /** Rows per table that every user may pull (master data). */
  shared?: Record<string, SyncRow[]>
}

/**
 * The sync port in memory, for service tests: any table name works, rows are stored as given,
 * and a transaction rolls back when `work` throws.
 */
export const createMemorySyncRepository = (options: MemorySyncOptions = {}) => {
  let state: MemoryState = {
    lastSeq: 0,
    purgedSeq: 0,
    ops: new Map(),
    history: [],
    tables: new Map(),
  }
  const checks = new Map<string, CheckRule>(Object.entries(options.checks ?? {}))
  for (const [table, rows] of Object.entries(options.shared ?? {})) {
    state.tables.set(table, new Map(rows.map((row) => [row.id, { ownerId: '*', row }])))
    state.lastSeq = Math.max(state.lastSeq, ...rows.map((row) => row.changeSeq))
  }

  const table = (name: string) => {
    let rows = state.tables.get(name)
    if (!rows) {
      rows = new Map()
      state.tables.set(name, rows)
    }
    return rows
  }

  const clone = (): MemoryState => ({
    ...state,
    ops: new Map(state.ops),
    history: [...state.history],
    tables: new Map([...state.tables].map(([name, rows]) => [name, new Map(rows)])),
  })

  const repo: SyncRepository = {
    transaction: async (work) => {
      const before = clone()
      try {
        return await work(repo)
      } catch (error) {
        state = before
        throw error
      }
    },
    nextSeq: async () => Promise.resolve(++state.lastSeq),
    lastSeq: async () => Promise.resolve(state.lastSeq),
    purgedSeq: async () => Promise.resolve(state.purgedSeq),
    raisePurgedSeq: async (seq) => {
      state.purgedSeq = Math.max(state.purgedSeq, seq)
      return Promise.resolve()
    },
    findOp: async (opId) => {
      const op = state.ops.get(opId)
      return Promise.resolve(op ? { userId: op.userId, result: op.result } : null)
    },
    saveOp: async ({ opId, userId, deviceId, appliedAt, result }) => {
      state.ops.set(opId, { userId, deviceId, appliedAt, result: structuredClone(result) })
      return Promise.resolve()
    },
    addHistory: async (entry) => {
      state.history.push(structuredClone(entry))
      return Promise.resolve()
    },
    notices: async (userId, deviceId, since, upTo) =>
      Promise.resolve(
        state.history
          .filter(
            (entry) =>
              entry.loserUserId === userId &&
              entry.loserDeviceId === null &&
              entry.overwrittenByDevice !== deviceId &&
              entry.changeSeq > since &&
              entry.changeSeq <= upTo
          )
          .map(({ id, table: name, rowId, previous, overwrittenBy, createdAt }) => ({
            id,
            table: name,
            rowId,
            previous,
            overwrittenBy,
            createdAt,
          }))
      ),
    deleteOpsBefore: async (before) => {
      let removed = 0
      for (const [opId, op] of state.ops) {
        if (op.appliedAt < before) {
          state.ops.delete(opId)
          removed++
        }
      }
      return Promise.resolve(removed)
    },
    pull: async (name, userId, since, limit) =>
      Promise.resolve(
        [...table(name).values()]
          .filter(
            ({ ownerId, row }) => (ownerId === '*' || ownerId === userId) && row.changeSeq > since
          )
          .map(({ row }) => row)
          .sort((a, b) => a.changeSeq - b.changeSeq)
          .slice(0, limit)
      ),
    find: async (name, id) => Promise.resolve(table(name).get(id) ?? null),
    check: async (name, userId, row) => {
      const rule = checks.get(name)
      const own = [...table(name).values()]
        .filter((stored) => stored.ownerId === userId)
        .map((stored) => stored.row)
      return Promise.resolve(rule ? rule(own, userId, row) : null)
    },
    write: async (name, userId, row) => {
      const stored = { ...row } as SyncRow
      table(name).set(row.id, { ownerId: userId, row: stored })
      return Promise.resolve(stored)
    },
    purge: async (name, before) => {
      let removed = 0
      let maxSeq = 0
      for (const [id, { row }] of table(name)) {
        if (typeof row.deletedAt === 'number' && row.deletedAt < before) {
          table(name).delete(id)
          removed++
          maxSeq = Math.max(maxSeq, row.changeSeq)
        }
      }
      return Promise.resolve({ removed, maxSeq })
    },
  }

  return {
    repo,
    /** Read-only views for assertions. */
    history: () => state.history,
    row: (name: string, id: string) => table(name).get(id) ?? null,
    opResult: (opId: string): OpResult | undefined => state.ops.get(opId)?.result,
  }
}
