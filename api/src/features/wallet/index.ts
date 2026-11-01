import { syncRegistry } from '@/core/sync'
import { walletSyncHandler } from './wallet.repository.drizzle'

// Wallets have no REST routes in 6.2: devices write them locally and sync them (wallet rule 1).
// Online endpoints for members of shared wallets arrive with #16.
syncRegistry.register(walletSyncHandler)
