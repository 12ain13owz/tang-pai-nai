import { syncRegistry } from '@/core/sync'
import { profileSyncHandler } from './profile.repository.drizzle'

// Profiles have no REST routes: devices write them locally and sync them (profile rule 1).
syncRegistry.register(profileSyncHandler)
