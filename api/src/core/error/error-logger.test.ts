import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as CoreLogger from '@/core/logger'
import { ErrorSeverity, HttpStatus } from '@/shared/constants'
import type { LogLevel } from '@/shared/constants'
import { AppError } from './app-error'
import { ErrorLogger } from './error-logger'

const write = vi.fn()
const getLogWriter = vi.fn((_level: LogLevel) => write)

vi.mock('@/core/logger', async (importOriginal) => {
  const actual = await importOriginal<typeof CoreLogger>()
  return {
    ...actual,
    getLogWriter: (level: LogLevel) => getLogWriter(level),
  }
})

describe('ErrorLogger.log', () => {
  beforeEach(() => {
    write.mockClear()
    getLogWriter.mockClear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('normalizes a plain Error with INTERNAL_SERVER_ERROR status and ERROR severity', () => {
    const error = new Error('boom')
    const structured = ErrorLogger.log(error)

    expect(structured.status).toBe(HttpStatus.INTERNAL_SERVER_ERROR)
    expect(structured.severity).toBe(ErrorSeverity.ERROR)
    expect(structured.message).toBe('boom')
    expect(structured.context).toEqual({})
    expect(structured.error.name).toBe('Error')
    expect(structured.error.message).toBe('boom')
    expect(Array.isArray(structured.error.stack)).toBe(true)
  })

  it('carries status, severity, and context from an AppError', () => {
    const error = new AppError('bad input', HttpStatus.BAD_REQUEST, ErrorSeverity.WARN, {
      operation: 'createUser',
    })
    const structured = ErrorLogger.log(error)

    expect(structured.status).toBe(HttpStatus.BAD_REQUEST)
    expect(structured.severity).toBe(ErrorSeverity.WARN)
    expect(structured.context).toEqual({ operation: 'createUser' })
  })

  it('merges additionalContext on top of the error context', () => {
    const error = new AppError('bad input', HttpStatus.BAD_REQUEST, ErrorSeverity.WARN, {
      operation: 'createUser',
    })
    const structured = ErrorLogger.log(error, { metadata: { userId: 1 } })

    expect(structured.context).toEqual({ operation: 'createUser', metadata: { userId: 1 } })
  })

  it('picks the log writer matching the error severity', () => {
    const error = new AppError('bad input', HttpStatus.BAD_REQUEST, ErrorSeverity.WARN)

    ErrorLogger.log(error)
    expect(getLogWriter).toHaveBeenCalledWith(ErrorSeverity.WARN)
    expect(write).toHaveBeenCalledWith(
      'bad input',
      expect.objectContaining({ status: HttpStatus.BAD_REQUEST, severity: ErrorSeverity.WARN })
    )
  })

  it('omits context from the log payload when it is empty', () => {
    ErrorLogger.log(new Error('boom'))

    const [, payload] = write.mock.calls[0] as [string, { context?: unknown }]
    expect(payload.context).toBeUndefined()
  })

  it('throws when the error stack has no parseable frames', () => {
    const error = new Error('boom')
    error.stack = 'Error: boom'

    expect(() => ErrorLogger.log(error)).toThrow(TypeError)
  })
})
