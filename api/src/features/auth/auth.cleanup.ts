import { client } from '@/core/database'
import { logger } from '@/core/logger'
import { LOG } from '@/shared/constants'
import { authService } from './index'

// Rule 20, run as `npm run auth:cleanup` by hand; on Vercel, Cron calls `GET /auth/cleanup` daily.
try {
  const removed = await authService.cleanup()
  logger.info(LOG.AUTH.cleanedUp(removed.challenges, removed.sessions, removed.rateLimitBuckets))
} finally {
  client.close()
}
