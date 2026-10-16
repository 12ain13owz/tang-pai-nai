import { createLogger, format, transports } from 'winston'
import { env } from '@/core/config'
import type { LogLevel } from '@/shared/constants'
import { LOG_LEVELS } from '@/shared/constants'
import { formatLogLevel, formatLogMessage, formatTimestamp, formatValue } from './format'
import { getCallerSource } from './stack'
import { createFileTransport } from './transport'
import type { Source } from './stack'

// Handled explicitly or used as control flags; everything else is metadata.
const RESERVED_LOG_KEYS = new Set(['level', 'message', 'timestamp', 'persist'])

// Build from entries instead of `metadata[key] = value` to avoid computed key injection.
const extractMetadata = (info: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(
    Object.entries(info).filter(
      ([key, value]) => !RESERVED_LOG_KEYS.has(key) && value !== undefined
    )
  )

const consoleLogFormat = format.printf((info) => {
  const timestamp = formatTimestamp()
  const level = formatLogLevel(info.level as LogLevel)
  const message = formatLogMessage(info.message)

  const metadata = extractMetadata(info)
  const metadataText = Object.keys(metadata).length > 0 ? `\n${formatValue(metadata, 0)}` : ''

  return `${timestamp} ${level} ${message}${metadataText}`
})

// Drops entries flagged with `persist: false` so they stay console-only.
const skipUnpersisted = format((info) => (info.persist === false ? false : info))

const jsonFileFormat = format.combine(
  skipUnpersisted(),
  format.timestamp(),
  format.printf((info) => {
    const { timestamp, level, message } = info
    const metadata = extractMetadata(info)

    return JSON.stringify({
      timestamp,
      level: String(level).toUpperCase(),
      message,
      ...metadata,
    })
  })
)

const baseLogger = createLogger({
  levels: LOG_LEVELS,
  transports: [
    new transports.Console({
      format: consoleLogFormat,
      level: env.LOG_LEVEL_CONSOLE,
      silent: env.LOG_SILENT,
    }),
    // Skipped entirely when silent so no logs/ directory or file is created (e.g. under tests).
    ...(env.LOG_SILENT
      ? []
      : [
          createFileTransport(env.LOG_LEVEL_FILE, jsonFileFormat),
          createFileTransport(env.LOG_LEVEL_ERROR_FILE, jsonFileFormat, true),
        ]),
  ],
})

/**
 * - `source`: a `Source` overrides the captured call site; `false` omits it.
 * - `persist`: `false` keeps the entry on the console only.
 * - any other key is treated as structured metadata.
 */
export type LogMetadata = {
  source?: Source | false
  persist?: boolean
} & Partial<Record<'level' | 'message' | 'timestamp', never>> & {
    [key: string]: unknown
  }

const writeLog = (level: LogLevel, message: unknown, metadata: LogMetadata = {}): void => {
  const { source: sourceOption, persist, ...rest } = metadata
  const source = sourceOption === false ? undefined : (sourceOption ?? getCallerSource())

  // Strip any reserved keys that slipped through untyped callers so metadata can't clobber the real log fields.
  const safeRest = Object.fromEntries(
    Object.entries(rest).filter(([key]) => !RESERVED_LOG_KEYS.has(key))
  )

  // Winston types `message` as string, but the runtime accepts any value.
  baseLogger.log({ level, message: message as string, ...safeRest, source, persist })
}

export const logger = {
  error: (message: unknown, metadata?: LogMetadata) => writeLog('error', message, metadata),
  warn: (message: unknown, metadata?: LogMetadata) => writeLog('warn', message, metadata),
  info: (message: unknown, metadata?: LogMetadata) => writeLog('info', message, metadata),
  http: (message: unknown, metadata?: LogMetadata) => writeLog('http', message, metadata),
  verbose: (message: unknown, metadata?: LogMetadata) => writeLog('verbose', message, metadata),
  debug: (message: unknown, metadata?: LogMetadata) => writeLog('debug', message, metadata),
}

// Built once at load. `Map.get` resolves a runtime level without computed key access.
const LOG_WRITERS = new Map(Object.entries(logger))

// Resolves the writer for a runtime level, falling back to `error`.
export const getLogWriter = (level: LogLevel) => LOG_WRITERS.get(level) ?? logger.error
