import { syncRegistry } from '@/core/sync'
import { transferSyncHandler } from './transfer.repository.drizzle'

// Transfers have no REST routes: devices write them locally and sync them (transfer rule 1).
syncRegistry.register(transferSyncHandler)
