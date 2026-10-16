import { describe, expect, it } from 'vitest'
import { ErrorSeverity, HttpStatus } from '@/shared/constants'
import { AppError } from './app-error'
import type { Request } from 'express'

const makeReq = (overrides: Partial<Request> = {}): Request =>
  ({
    method: 'GET',
    originalUrl: '/foo',
    params: {},
    query: {},
    body: undefined,
    ...overrides,
  }) as Request

describe('AppError', () => {
  it('defaults status, severity, and context when not provided', () => {
    const error = new AppError('boom')

    expect(error.status).toBe(HttpStatus.INTERNAL_SERVER_ERROR)
    expect(error.severity).toBe(ErrorSeverity.ERROR)
    expect(error.context).toEqual({})
    expect(error.message).toBe('boom')
    expect(error.name).toBe('AppError')
  })

  it('accepts explicit status, severity, and context', () => {
    const error = new AppError('bad input', HttpStatus.BAD_REQUEST, ErrorSeverity.WARN, {
      operation: 'createUser',
    })

    expect(error.status).toBe(HttpStatus.BAD_REQUEST)
    expect(error.severity).toBe(ErrorSeverity.WARN)
    expect(error.context).toEqual({ operation: 'createUser' })
  })

  describe('withEndpoint', () => {
    it('sets method and url, omitting params/query/body when empty', () => {
      const error = new AppError('boom').withEndpoint(makeReq())
      expect(error.context.endpoint).toEqual({ method: 'GET', url: '/foo' })
    })

    it('includes params, query, and body when present', () => {
      const req = makeReq({
        params: { id: '1' },
        query: { page: '2' },
        body: { name: 'x' },
      })
      const error = new AppError('boom').withEndpoint(req)

      expect(error.context.endpoint).toEqual({
        method: 'GET',
        url: '/foo',
        params: { id: '1' },
        query: { page: '2' },
        body: { name: 'x' },
      })
    })

    it('is chainable and returns the same instance', () => {
      const error = new AppError('boom')
      expect(error.withEndpoint(makeReq())).toBe(error)
    })
  })

  describe('withOperation', () => {
    it('sets the operation on context', () => {
      const error = new AppError('boom').withOperation('createUser')
      expect(error.context.operation).toBe('createUser')
    })
  })

  describe('withMetadata', () => {
    it('sets metadata on context', () => {
      const error = new AppError('boom').withMetadata({ userId: 42 })
      expect(error.context.metadata).toEqual({ userId: 42 })
    })
  })

  it('supports chaining multiple with* calls', () => {
    const error = new AppError('boom')
      .withOperation('createUser')
      .withMetadata({ userId: 42 })
      .withEndpoint(makeReq())

    expect(error.context).toEqual({
      operation: 'createUser',
      metadata: { userId: 42 },
      endpoint: { method: 'GET', url: '/foo' },
    })
  })
})
