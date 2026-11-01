import '@/features/currency'
import '@/features/profile'
import '@/features/wallet'
import { client } from '@/core/database'
import { logger } from '@/core/logger'
import { LOG } from '@/shared/constants'
import { syncService } from './index'

// Rule 9, run as `npm run sync:cleanup` until the Vercel Cron endpoint lands with deploy (#17).
try {
  const removed = await syncService.cleanup()
  logger.info(LOG.SYNC.cleanedUp(removed.tombstones, removed.ops))
} finally {
  client.close()
}
