import { ErrorSeverity, HttpStatus } from '@/shared/constants'
import type { EndpointContext, ErrorContext } from './error.type'
import type { Request } from 'express'

// Body fields that hold a secret (auth spec rule 18). Their values never reach a log line or a dev
// error response, even when a request fails validation.
// `phone` isn't a secret, but auth rule 27 keeps full numbers out of the logs.
const SECRET_FIELDS = new Set([
  'code',
  'token',
  'password',
  'currentPassword',
  'newPassword',
  'phone',
])
const REDACTED = '[redacted]'

const redactSecrets = (body: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(
    Object.entries(body).map(([key, value]) => [key, SECRET_FIELDS.has(key) ? REDACTED : value])
  )

export class AppError extends Error {
  /** Machine-readable reason for the client (e.g. `OTP_EXPIRED`), sent beside `message`. */
  code?: string

  constructor(
    message: string,
    public status: HttpStatus = HttpStatus.INTERNAL_SERVER_ERROR,
    public severity: ErrorSeverity = ErrorSeverity.ERROR,
    public context: ErrorContext = {}
  ) {
    super(message)
    this.name = this.constructor.name
    Error.captureStackTrace(this, this.constructor)
  }

  withEndpoint(req: Request): this {
    const endpoint: EndpointContext = {
      method: req.method,
      url: req.originalUrl,
    }

    if (Object.keys(req.params).length > 0) {
      endpoint.params = { ...req.params }
    }

    if (Object.keys(req.query).length > 0) {
      endpoint.query = { ...req.query }
    }

    const body = req.body as Record<string, unknown>
    if (req.body && Object.keys(body).length > 0) {
      endpoint.body = redactSecrets(body)
    }

    this.context.endpoint = endpoint
    return this
  }

  withOperation(operation: string): this {
    this.context.operation = operation
    return this
  }

  withCode(code: string): this {
    this.code = code
    return this
  }

  withMetadata(metadata: Record<string, unknown>): this {
    this.context.metadata = metadata
    return this
  }
}
