import { ErrorSeverity, HttpStatus } from '@/shared/constants'
import type { EndpointContext, ErrorContext } from './error.type'
import type { Request } from 'express'

export class AppError extends Error {
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
      endpoint.body = { ...body }
    }

    this.context.endpoint = endpoint
    return this
  }

  withOperation(operation: string): this {
    this.context.operation = operation
    return this
  }

  withMetadata(metadata: Record<string, unknown>): this {
    this.context.metadata = metadata
    return this
  }
}
