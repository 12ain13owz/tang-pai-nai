import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppError } from '@/core/error'
import { HttpStatus } from '@/shared/constants'
import { requireCronSecret } from './require-cron-secret'
import type { Request, Response } from 'express'

const SECRET = 's'.repeat(40)
const makeReq = (authorization?: string): Request =>
  ({ get: (name: string) => (name === 'authorization' ? authorization : undefined) }) as Request
const next = vi.fn<(err?: unknown) => void>()

const statusOf = (): number | undefined => {
  const error: unknown = next.mock.calls[0]?.[0]
  return error instanceof AppError ? error.status : undefined
}

beforeEach(() => {
  next.mockClear()
})

describe('requireCronSecret', () => {
  it('passes a request that sends the secret as a bearer', () => {
    requireCronSecret(SECRET)(makeReq(`Bearer ${SECRET}`), {} as Response, next)
    expect(next).toHaveBeenCalledWith()
  })

  it('refuses a wrong secret with 401', () => {
    requireCronSecret(SECRET)(makeReq(`Bearer ${SECRET}x`), {} as Response, next)
    expect(statusOf()).toBe(HttpStatus.UNAUTHORIZED)
  })

  it('refuses a request without a bearer with 401', () => {
    requireCronSecret(SECRET)(makeReq(), {} as Response, next)
    expect(statusOf()).toBe(HttpStatus.UNAUTHORIZED)
  })

  it('answers 404 when no secret is configured, even to an empty bearer', () => {
    requireCronSecret(undefined)(makeReq('Bearer '), {} as Response, next)
    expect(statusOf()).toBe(HttpStatus.NOT_FOUND)
  })
})
