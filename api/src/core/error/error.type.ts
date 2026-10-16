import type { Source, StackFrame } from '@/core/logger'
import type { ErrorSeverity, HttpStatus } from '@/shared/constants'

export type EndpointContext = {
  method: string
  url: string
  params?: Record<string, unknown>
  query?: Record<string, unknown>
  body?: Record<string, unknown>
}

export type ErrorContext = {
  operation?: string
  endpoint?: EndpointContext
  metadata?: Record<string, unknown>
}

// JSON-serializable error shape shared by structured logging and dev responses.
export type StructuredError = {
  message: string
  source?: Source
  status: HttpStatus
  severity: ErrorSeverity
  context: ErrorContext
  error: {
    name: string
    message: string
    stack: StackFrame[]
  }
}
