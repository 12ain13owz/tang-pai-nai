import { env } from '@/core/config'
import { logger } from '@/core/logger'
import { LOG } from '@/shared/constants'
import type { Express } from 'express'
import type { Server } from 'http'

let serverInstance: Server | null = null
let isShuttingDown = false

export const startServer = (app: Express, port: number): void => {
  serverInstance = app.listen(port, () =>
    logger.info(LOG.SERVER.listening(env.BASE_URL), { source: false })
  )

  process.on('unhandledRejection', handleFatalError)
  process.on('uncaughtException', handleFatalError)

  // Wrap: Node passes the signal name ('SIGTERM') as the first argument, which would
  // otherwise land in `exitCode` and make process.exit() throw ERR_INVALID_ARG_TYPE.
  process.on('SIGTERM', () => shutdown())
  process.on('SIGINT', () => shutdown())
}

export const handleFatalError = (error: unknown): void => {
  logger.error(error)
  shutdown(1)
}

type CleanupFn = () => Promise<void>
const cleanups: CleanupFn[] = []

/** Register a resource to close on shutdown (DB pool, queue, cache…). */
export const onShutdown = (fn: CleanupFn): void => {
  cleanups.push(fn)
}

export const shutdown = (exitCode = 0): void => {
  if (isShuttingDown) {
    return
  }
  isShuttingDown = true

  // Hard ceiling so a stuck connection can't block process exit past the orchestrator's grace period.
  const forceExit = setTimeout(() => {
    logger.error('Forced shutdown: server did not close in time', { source: false })
    process.exit(exitCode)
  }, env.SHUTDOWN_TIMEOUT_MS)
  forceExit.unref()

  const closeServer = async (): Promise<void> =>
    new Promise((resolve) => (serverInstance ? serverInstance.close(() => resolve()) : resolve()))

  void Promise.allSettled([closeServer(), ...cleanups.map(async (fn) => fn())]).then((results) => {
    for (const result of results) {
      if (result.status === 'rejected') {
        logger.error(result.reason)
      }
    }
    clearTimeout(forceExit)
    process.exit(exitCode)
  })
}
