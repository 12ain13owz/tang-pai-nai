import type { SyncTableHandler } from './sync.type'

export interface SyncRegistry {
  register(handler: SyncTableHandler): void
  get(table: string): SyncTableHandler | undefined
  all(): SyncTableHandler[]
}

export const createSyncRegistry = (): SyncRegistry => {
  const handlers = new Map<string, SyncTableHandler>()
  return {
    register: (handler) => {
      if (handlers.has(handler.table)) {
        throw new Error(`Sync table "${handler.table}" is already registered`)
      }
      handlers.set(handler.table, handler)
    },
    get: (table) => handlers.get(table),
    all: () => [...handlers.values()],
  }
}

/** The app's registry: features register their tables from their `index.ts`. */
export const syncRegistry = createSyncRegistry()
