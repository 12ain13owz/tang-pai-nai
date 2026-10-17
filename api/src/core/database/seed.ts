import { env } from '@/core/config'
import { logger } from '@/core/logger'
import { LOG } from '@/shared/constants'
import { AppEnv } from '@/shared/types'
import { client, db } from './index'
import type { Database } from './client'

// Dev data. Each feature adds one idempotent seeder here (insert ... on conflict do nothing), so
// `npm run db:seed` can run any number of times. Never runs in production.
type Seeder = { name: string; run: (db: Database) => Promise<void> }

const seeders: Seeder[] = []

const run = async (): Promise<void> => {
  if (env.NODE_ENV === AppEnv.PRODUCTION) {
    logger.warn(LOG.DATABASE.seedSkippedInProduction)
    return
  }
  for (const seeder of seeders) {
    await seeder.run(db)
    logger.info(LOG.DATABASE.seeded(seeder.name))
  }
  logger.info(LOG.DATABASE.seedDone(seeders.length))
}

try {
  await run()
} finally {
  client.close()
}
