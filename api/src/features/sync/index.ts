import { v7 as uuidv7 } from 'uuid'
import { db } from '@/core/database'
import { syncRegistry } from '@/core/sync'
import { createSyncController } from './sync.controller'
import { createDrizzleSyncRepository } from './sync.repository.drizzle'
import { createSyncRouter } from './sync.routes'
import { createSyncService } from './sync.service'

// Tables come from the registry, which each synced feature fills from its own index.ts.
const syncRepo = createDrizzleSyncRepository(db, syncRegistry)
export const syncService = createSyncService({ syncRepo, registry: syncRegistry, newId: uuidv7 })
const syncController = createSyncController(syncService)

export const syncRouter = createSyncRouter(syncController)
