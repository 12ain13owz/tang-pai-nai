import morgan from 'morgan'
import { logger } from '@/core/logger'

// Plain (uncolored) morgan line, routed through Winston at `http` level so it follows the
// same transports, levels, and LOG_SILENT as every other log line. `:remote-addr` is `req.ip`,
// so the line shows whether TRUST_PROXY_HOPS finds the client behind the Vercel rewrite.
const REQUEST_FORMAT =
  ':method :url :status :response-time ms - :res[content-length] - :remote-addr'

export const requestLogger = morgan(REQUEST_FORMAT, {
  stream: {
    write: (line: string) => logger.http(line.trim(), { source: false }),
  },
})
