import { ERRORS, ErrorSeverity, HttpStatus } from '@/shared/constants'
import { AppError } from './app-error'

interface WrapOptions {
  operation: string
  message?: string
  metadata?: Record<string, unknown>
}

interface Cause {
  name: string
  message: string
}

const toCause = (error: unknown): Cause =>
  error instanceof Error
    ? { name: error.name, message: error.message }
    : { name: 'UnknownError', message: String(error) }

/**
 * Runs `fn` and, if it throws something that isn't already an `AppError`,
 * rethrows a generic 500 `AppError` instead — so a raw driver/DB error message
 * never reaches `errorHandler` (which only hides `data` in production, not
 * `message` — see error.middleware.ts). The original error is preserved as
 * `metadata.cause` for logs.
 */
export const wrapUnexpected = async <T>(
  fn: () => Promise<T>,
  { operation, message = ERRORS.INTERNAL_SERVER_ERROR, metadata }: WrapOptions
): Promise<T> => {
  try {
    return await fn()
  } catch (error) {
    if (error instanceof AppError) {
      throw error
    }

    throw new AppError(message, HttpStatus.INTERNAL_SERVER_ERROR, ErrorSeverity.ERROR)
      .withOperation(operation)
      .withMetadata({ ...metadata, cause: toCause(error) })
  }
}
