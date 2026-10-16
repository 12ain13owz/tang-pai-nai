import { afterEach, describe, expect, it, vi } from 'vitest'
import { AnsiColors } from '@/shared/constants'
import { formatLogLevel, formatLogMessage, formatTimestamp, formatValue } from './format'

describe('formatTimestamp', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('formats the current time as HH:mm:ss.SSS', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-05T00:56:00.899'))

    expect(formatTimestamp()).toContain('00:56:00.899')
  })
})

describe('formatLogLevel', () => {
  it('uppercases the level and pads short names to 5 characters', () => {
    expect(formatLogLevel('info')).toContain('INFO ') // 'INFO' + 1 space = 5 ตัว
    expect(formatLogLevel('warn')).toContain('WARN ')
  })

  it('does not truncate levels longer than 5 characters', () => {
    expect(formatLogLevel('verbose')).toContain('VERBOSE')
  })

  it('applies the color mapped to the level (error -> red)', () => {
    const result = formatLogLevel('error')
    expect(result).toContain(`\x1b[${AnsiColors.ERROR}m`)
  })

  it('applies a different color for a different level (info -> green)', () => {
    const result = formatLogLevel('info')
    expect(result).toContain(`\x1b[${AnsiColors.INFO}m`)
  })
})

describe('formatValue', () => {
  it('wraps null/undefined with their labels', () => {
    expect(formatValue(null)).toContain('null')
    expect(formatValue(undefined)).toContain('undefined')
  })

  it('renders empty array/object as [] / {}', () => {
    expect(formatValue([])).toBe('[]')
    expect(formatValue({})).toBe('{}')
  })

  it('formats a short primitive array inline', () => {
    const result = formatValue([1, 2, 3])
    expect(result.startsWith('[')).toBe(true)
    expect(result.endsWith(']')).toBe(true)
  })
})

describe('formatLogMessage', () => {
  it('returns [] for an empty array message', () => {
    expect(formatLogMessage([])).toBe('[]')
  })

  it('unwraps a single-item array to just that value', () => {
    expect(formatLogMessage(['only'])).toBe(formatValue('only'))
  })

  it('numbers each item when message has multiple entries', () => {
    const result = formatLogMessage(['a', 'b'])
    expect(result).toContain('[0]')
    expect(result).toContain('[1]')
  })
})
