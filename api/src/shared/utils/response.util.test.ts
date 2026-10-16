import { afterEach, describe, expect, it, vi } from 'vitest'
import { createResponse } from './response.util'

describe('createResponse', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('wraps message and data with an ISO timestamp', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-05T00:56:00.899Z'))

    const result = createResponse('ok', { id: 1 })
    expect(result).toEqual({
      message: 'ok',
      timestamp: '2026-08-05T00:56:00.899Z',
      data: { id: 1 },
    })
  })

  it('leaves data undefined when not provided', () => {
    const result = createResponse('ok')
    expect(result.data).toBeUndefined()
  })
})
