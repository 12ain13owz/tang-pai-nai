import { describe, expect, it } from 'vitest'
import { ERRORS, ErrorSeverity, HttpStatus } from '@/shared/constants'
import { AppError } from './app-error'
import { wrapUnexpected } from './wrap-unexpected'

describe('wrapUnexpected', () => {
  it('resolves with the value returned by fn when it succeeds', async () => {
    const result = await wrapUnexpected(async () => 'ok', { operation: 'test' })
    expect(result).toBe('ok')
  })

  it('rethrows an AppError from fn unchanged, without wrapping it', async () => {
    const original = new AppError(
      'invalid credentials',
      HttpStatus.UNAUTHORIZED,
      ErrorSeverity.WARN
    )

    await expect(
      wrapUnexpected(
        async () => {
          throw original
        },
        { operation: 'login' }
      )
    ).rejects.toBe(original)
  })

  it('wraps a non-AppError Error into a generic 500 AppError', async () => {
    await expect(
      wrapUnexpected(
        async () => {
          throw new Error('connection refused')
        },
        { operation: 'login' }
      )
    ).rejects.toMatchObject({
      message: ERRORS.INTERNAL_SERVER_ERROR,
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      severity: ErrorSeverity.ERROR,
    })
  })

  it('wraps a non-Error throw (e.g. a string) the same way', async () => {
    await expect(
      wrapUnexpected(
        async () => {
          // eslint-disable-next-line @typescript-eslint/only-throw-error
          throw 'boom'
        },
        { operation: 'login' }
      )
    ).rejects.toMatchObject({
      message: ERRORS.INTERNAL_SERVER_ERROR,
      status: HttpStatus.INTERNAL_SERVER_ERROR,
    })
  })

  it('sets the operation on the wrapped AppError context', async () => {
    await expect(
      wrapUnexpected(
        async () => {
          throw new Error('boom')
        },
        { operation: 'persistRefreshToken' }
      )
    ).rejects.toMatchObject({
      context: { operation: 'persistRefreshToken' },
    })
  })

  it('preserves the original error as metadata.cause when it is an Error', async () => {
    await expect(
      wrapUnexpected(
        async () => {
          throw new TypeError('bad shape')
        },
        { operation: 'login', metadata: { userId: 'user-1' } }
      )
    ).rejects.toMatchObject({
      context: {
        metadata: {
          userId: 'user-1',
          cause: { name: 'TypeError', message: 'bad shape' },
        },
      },
    })
  })

  it('falls back to a generic cause name when the thrown value is not an Error', async () => {
    await expect(
      wrapUnexpected(
        async () => {
          // eslint-disable-next-line @typescript-eslint/only-throw-error
          throw 'boom'
        },
        { operation: 'login' }
      )
    ).rejects.toMatchObject({
      context: {
        metadata: { cause: { name: 'UnknownError', message: 'boom' } },
      },
    })
  })

  it('uses the custom message when provided, instead of the generic default', async () => {
    await expect(
      wrapUnexpected(
        async () => {
          throw new Error('boom')
        },
        { operation: 'login', message: 'Could not save session' }
      )
    ).rejects.toMatchObject({
      message: 'Could not save session',
    })
  })
})
