import '@/features/currency'
import '@/features/profile'
import '@/features/category'
import '@/features/wallet'
import '@/features/transaction'
import '@/features/transfer'
import '@/features/recurring'
import '@/features/debt'
import '@/features/event'
import { client } from '@/core/database'
import { logger } from '@/core/logger'
import { LOG } from '@/shared/constants'
import { syncService } from './index'

// Rule 9, run as `npm run sync:cleanup` by hand; on Vercel, Cron calls `GET /sync/cleanup` daily.
try {
  const removed = await syncService.cleanup()
  logger.info(LOG.SYNC.cleanedUp(removed.tombstones, removed.ops))
} finally {
  client.close()
}
