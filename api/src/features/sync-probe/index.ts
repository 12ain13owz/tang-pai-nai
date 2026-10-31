import { env } from '@/core/config'
import { syncRegistry } from '@/core/sync'
import { AppEnv } from '@/shared/types'
import { syncProbeSyncHandler } from './sync-probe.repository.drizzle'

// Dev only: a production API neither pulls nor accepts probes (offline-sync → tables synced in
// 4a.2). Removed with its table once Wallet (#6) syncs.
if (env.NODE_ENV !== AppEnv.PRODUCTION) {
  syncRegistry.register(syncProbeSyncHandler)
}
