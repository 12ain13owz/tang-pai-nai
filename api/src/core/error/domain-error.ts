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

export class BusinessRuleError extends DomainError {
  constructor(message: string, metadata?: ErrorMetadata) {
    super(message, HttpStatus.UNPROCESSABLE_ENTITY, metadata)
  }
}
