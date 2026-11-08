import { syncRegistry } from '@/core/sync'
import { recurringSyncHandler } from './recurring.repository.drizzle'

// Recurring rules have no REST routes: devices write them locally and sync them (recurring
// rule 1); the device records their occurrences as transactions and transfers.
syncRegistry.register(recurringSyncHandler)
