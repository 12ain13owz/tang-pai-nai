import { afterEach, describe, expect, it, vi } from 'vitest'
import { getCallerSource } from './stack'

describe('getCallerSource', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  const cwd = process.cwd().replace(/\\/g, '/')

  const mockStack = (stack: string | undefined) => {
    vi.spyOn(globalThis, 'Error').mockImplementation(function MockError() {
      return { stack } as Error
    })
  }

  it('returns undefined when Error has no stack', () => {
    mockStack(undefined)
    expect(getCallerSource()).toBeUndefined()
  })

  it('skips frames inside core/logger and returns the first external caller', () => {
    mockStack(
      `Error\n` +
        `    at Logger.info (${cwd}/src/core/logger/logger.ts:10:5)\n` +
        `    at handleRequest (${cwd}/src/features/health/health.controller.ts:20:3)`
    )

    expect(getCallerSource()).toEqual({
      function: 'handleRequest',
      file: 'src/features/health/health.controller.ts',
      line: 20,
    })
  })

  it('returns undefined when every frame is inside core/logger or unparsable', () => {
    mockStack(
      `Error\n` +
        `    at Logger.info (${cwd}/src/core/logger/logger.ts:10:5)\n` +
        `    garbage line`
    )

    expect(getCallerSource()).toBeUndefined()
  })
})
