import { describe, expect, it } from 'vitest'
import { AppEnv } from '@/shared/types'
import { envSchema } from './env.schema'

const validEnv = {
  PORT: '3000',
  NODE_ENV: AppEnv.DEVELOPMENT,
  BASE_URL: 'http://localhost:3000',
  LOG_LEVEL_CONSOLE: 'info',
  LOG_LEVEL_FILE: 'info',
  LOG_LEVEL_ERROR_FILE: 'error',
  SHUTDOWN_TIMEOUT_MS: '10000',
}

describe('envSchema', () => {
  it('parses a minimal valid env, coercing PORT to a number', () => {
    const result = envSchema.safeParse(validEnv)

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.PORT).toBe(3000)
      expect(result.data.SHUTDOWN_TIMEOUT_MS).toBe(10_000)
    }
  })

  it('rejects a PORT outside the valid range', () => {
    const result = envSchema.safeParse({ ...validEnv, PORT: '70000' })
    expect(result.success).toBe(false)
  })

  it('rejects an unrecognized NODE_ENV', () => {
    const result = envSchema.safeParse({ ...validEnv, NODE_ENV: 'staging' })
    expect(result.success).toBe(false)
  })

  it('rejects an unrecognized log level', () => {
    const result = envSchema.safeParse({ ...validEnv, LOG_LEVEL_CONSOLE: 'trace' })
    expect(result.success).toBe(false)
  })

  it('splits, trims, and drops empty entries in CORS_ORIGINS', () => {
    const result = envSchema.safeParse({
      ...validEnv,
      CORS_ORIGINS: 'http://a.com, http://b.com ,,',
    })

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.CORS_ORIGINS).toEqual(['http://a.com', 'http://b.com'])
    }
  })

  it('defaults CORS_ORIGINS to an empty array when omitted', () => {
    const result = envSchema.safeParse(validEnv)

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.CORS_ORIGINS).toEqual([])
    }
  })

  it('coerces SHUTDOWN_TIMEOUT_MS when provided', () => {
    const result = envSchema.safeParse({ ...validEnv, SHUTDOWN_TIMEOUT_MS: '5000' })

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.SHUTDOWN_TIMEOUT_MS).toBe(5000)
    }
  })
})
