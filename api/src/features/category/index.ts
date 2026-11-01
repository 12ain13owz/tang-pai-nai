import { syncRegistry } from '@/core/sync'
import { categorySyncHandler } from './category.repository.drizzle'

// Categories have no REST routes: devices write them locally and sync them (category rule 1).
syncRegistry.register(categorySyncHandler)
