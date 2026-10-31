import { ERRORS, ErrorSeverity, HttpStatus } from '@/shared/constants'
import { AppError } from './app-error'

type ErrorMetadata = Record<string, unknown>

// Expected business failures. Each subclass pins its HTTP status + WARN severity, so services
// throw these without importing HttpStatus; errorHandler/ErrorLogger see a plain AppError.
export abstract class DomainError extends AppError {
  protected constructor(message: string, status: HttpStatus, metadata?: ErrorMetadata) {
    super(message, status, ErrorSeverity.WARN)
    if (metadata) {
      this.withMetadata(metadata)
    }
  }
}

export class NotFoundError extends DomainError {
  constructor(resource: string, metadata?: ErrorMetadata) {
    super(ERRORS.notFound(resource), HttpStatus.NOT_FOUND, metadata)
  }
}

export class ConflictError extends DomainError {
  constructor(message: string, metadata?: ErrorMetadata) {
    super(message, HttpStatus.CONFLICT, metadata)
  }
}

export class UnauthorizedError extends DomainError {
  constructor(message: string, metadata?: ErrorMetadata) {
    super(message, HttpStatus.UNAUTHORIZED, metadata)
  }
}

export class BadRequestError extends DomainError {
  constructor(message: string, metadata?: ErrorMetadata) {
    super(message, HttpStatus.BAD_REQUEST, metadata)
  }
}

/** What the client asked for existed once but is gone for good (e.g. a sync cursor past retention). */
export class GoneError extends DomainError {
  constructor(message: string, metadata?: ErrorMetadata) {
    super(message, HttpStatus.GONE, metadata)
  }
}

export class ForbiddenError extends DomainError {
  constructor(message: string, metadata?: ErrorMetadata) {
    super(message, HttpStatus.FORBIDDEN, metadata)
  }
}

/** A rate limit was hit. `errorHandler` sends `retryAfterSeconds` as the `Retry-After` header. */
export class TooManyRequestsError extends DomainError {
  constructor(
    message: string,
    public retryAfterSeconds: number,
    metadata?: ErrorMetadata
  ) {
    super(message, HttpStatus.TOO_MANY_REQUESTS, metadata)
  }
}

export class BusinessRuleError extends DomainError {
  constructor(message: string, metadata?: ErrorMetadata) {
    super(message, HttpStatus.UNPROCESSABLE_ENTITY, metadata)
  }
}
