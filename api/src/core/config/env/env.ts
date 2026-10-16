/* eslint-disable no-console */
/* eslint-disable no-process-env */
import chalk from 'chalk'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { ERRORS, LOG } from '@/shared/constants'
import { AppEnv, EnvFileName } from '@/shared/types'
import { envSchema } from './env.schema'
import type { EnvConfig } from './env.type'

const resolveEnvFile = (): string => {
  const nodeEnv = (process.env.NODE_ENV as AppEnv | undefined) ?? AppEnv.DEVELOPMENT
  return nodeEnv === AppEnv.PRODUCTION ? EnvFileName.PRODUCTION : EnvFileName.DEVELOPMENT
}

// Node loads the file itself via --env-file-if-exists (see package.json scripts).
// A missing file is fatal in development — you must have .env.dev locally. In
// production it's only a warning: hosts like Render inject env vars directly
// into process.env without an actual file on disk.
const reportEnvFile = (envFile: string): void => {
  const envPath = resolve(process.cwd(), envFile)

  if (existsSync(envPath)) {
    console.info(chalk.greenBright(LOG.CONFIG.load(envFile)))
    return
  }

  const nodeEnv = (process.env.NODE_ENV as AppEnv | undefined) ?? AppEnv.DEVELOPMENT
  if (nodeEnv === AppEnv.PRODUCTION) {
    console.warn(chalk.yellowBright(LOG.CONFIG.missing(envFile)))
    return
  }

  throw new Error(ERRORS.notFound(envFile))
}

const validateEnv = (): EnvConfig => {
  const env = envSchema.safeParse(process.env)
  if (!env.success) {
    const errorMessages = env.error.issues
      .map((issue) => `- ${issue.path.join('.')}: ${issue.message}`)
      .join('\n')

    throw new Error(`\n${errorMessages}`)
  }

  return env.data
}

const initEnv = (): EnvConfig => {
  const envFile = resolveEnvFile()

  try {
    reportEnvFile(envFile)
    return validateEnv()
  } catch (error) {
    console.error(chalk.redBright(LOG.CONFIG.loadError(envFile)), error)
    process.exit(1)
  }
}

export const env = initEnv()
