import { syncRegistry } from '@/core/sync'
import { eventSyncHandler } from './event.repository.drizzle'

// Events have no REST routes: devices write them locally and sync them (event rule 1).
syncRegistry.register(eventSyncHandler)
