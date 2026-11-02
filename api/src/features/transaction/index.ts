import { syncRegistry } from '@/core/sync'
import { transactionSyncHandler } from './transaction.repository.drizzle'

// Transactions have no REST routes: devices write them locally and sync them (transaction rule 1).
syncRegistry.register(transactionSyncHandler)
