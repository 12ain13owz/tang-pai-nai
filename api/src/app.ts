import cors from 'cors'
import express from 'express'
import rateLimit from 'express-rate-limit'
import helmet from 'helmet'
import { corsOptions, helmetOptions, rateLimitOptions } from '@/core/config'
import { errorHandler } from '@/core/error'
import { requestLogger } from '@/core/middleware'
import { mainRoutes } from '@/routes'
import type { Express } from 'express'

export const createApp = (): Express => {
  const app = express()

  app.use(cors(corsOptions))
  app.use(helmet(helmetOptions))
  app.use(rateLimit(rateLimitOptions))
  app.use(requestLogger)
  app.use(express.json())

  app.use(mainRoutes)
  app.use(errorHandler)

  return app
}
