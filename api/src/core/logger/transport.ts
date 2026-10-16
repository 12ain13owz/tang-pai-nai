import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import DailyRotateFile from 'winston-daily-rotate-file'
import type { Logform } from 'winston'

const LOG_ROOT = join(process.cwd(), 'logs')

// logs/YYYY/MM/YYYY-MM-DD.log
const DATE_PATTERN = 'YYYY/MM/YYYY-MM-DD'

// Pre-creates logs/YYYY/MM to avoid ENOENT on Windows (path separator mismatch).
const ensureDatedLogDir = (date = new Date()): void => {
  const year = String(date.getFullYear())
  const month = String(date.getMonth() + 1).padStart(2, '0')

  mkdirSync(join(LOG_ROOT, year, month), { recursive: true })
}

export const createFileTransport = (
  level: string,
  format: Logform.Format,
  errorOnly = false
): DailyRotateFile => {
  const suffix = errorOnly ? '.error.log' : '.log'

  ensureDatedLogDir()

  const transport = new DailyRotateFile({
    filename: join(LOG_ROOT, `%DATE%${suffix}`),
    datePattern: DATE_PATTERN,
    format,
    level,
  })

  // Cover month/year rollovers while the process keeps running.
  transport.on('new', (newFilename: string) => {
    mkdirSync(join(newFilename, '..'), { recursive: true })
  })

  return transport
}
