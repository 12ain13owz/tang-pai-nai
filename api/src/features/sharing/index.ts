import { env } from '@/core/config'
import { db } from '@/core/database'
import { notifier } from '@/core/notification'
import { createSharingController } from './sharing.controller'
import { createDrizzleSharingRepository } from './sharing.repository.drizzle'
import { createSharingRouter } from './sharing.routes'
import { createSharingService } from './sharing.service'

const sharingRepo = createDrizzleSharingRepository(db)
const sharingService = createSharingService({
  sharingRepo,
  notifier,
  config: { webOrigin: env.WEB_ORIGIN, emailDailyLimit: env.EMAIL_DAILY_LIMIT },
})

export const sharingRouter = createSharingRouter(createSharingController(sharingService))
