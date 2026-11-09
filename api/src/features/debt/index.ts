import { syncRegistry } from '@/core/sync'
import { debtEntrySyncHandler, debtSyncHandler } from './debt.repository.drizzle'

// Debts have no REST routes: devices write them locally and sync them (debt rule 1).
syncRegistry.register(debtSyncHandler)
syncRegistry.register(debtEntrySyncHandler)
