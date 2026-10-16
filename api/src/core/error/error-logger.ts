import { getLogWriter, parseStackTrace } from '@/core/logger'
import { ErrorSeverity, HttpStatus } from '@/shared/constants'
import type { LogLevel } from '@/shared/constants'
import { AppError } from './app-error'
import type { ErrorContext, StructuredError } from './error.type'

export class ErrorLogger {
  // Normalizes any error into a JSON-serializable shape with a parsed stack.
  private static toStructured(
    error: AppError | Error,
    additionalContext?: Partial<ErrorContext>
  ): StructuredError {
    const frames = parseStackTrace(error.stack)
    const originFrame = frames[0]
    const source = {
      function: originFrame.function,
      file: originFrame.file,
      line: originFrame.line,
    }
    const isAppError = error instanceof AppError

    return {
      message: error.message,
      source,
      status: isAppError ? error.status : HttpStatus.INTERNAL_SERVER_ERROR,
      severity: isAppError ? error.severity : ErrorSeverity.ERROR,
      context: { ...(isAppError ? error.context : {}), ...additionalContext },
      error: {
        name: error.name,
        message: error.message,
        stack: frames,
      },
    }
  }

  // Logs at the level matching the error severity and returns the structured form.
  static log(error: AppError | Error, additionalContext?: Partial<ErrorContext>): StructuredError {
    const structured = this.toStructured(error, additionalContext)
    const level = (error instanceof AppError ? error.severity : ErrorSeverity.ERROR) as LogLevel
    const hasContext = Object.keys(structured.context).length > 0

    const write = getLogWriter(level)
    write(structured.message, {
      source: structured.source,
      status: structured.status,
      severity: structured.severity,
      context: hasContext ? structured.context : undefined,
      error: structured.error,
    })

    return structured
  }
}
