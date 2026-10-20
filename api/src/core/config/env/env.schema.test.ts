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
  JWT_SECRET: 'x'.repeat(32),
  OTP_PEPPER: 'y'.repeat(32),
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

  it('leaves Google sign-in off when its settings are empty, with Google as the issuer', () => {
    const result = envSchema.safeParse({
      ...validEnv,
      GOOGLE_CLIENT_ID: '',
      GOOGLE_CLIENT_SECRET: '',
    })

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.GOOGLE_CLIENT_ID).toBeUndefined()
      expect(result.data.GOOGLE_ISSUER).toBe('https://accounts.google.com')
    }
  })

  it.each([
    [{ GOOGLE_CLIENT_ID: 'id' }, 'GOOGLE_CLIENT_SECRET'],
    [{ GOOGLE_CLIENT_SECRET: 'secret' }, 'GOOGLE_CLIENT_ID'],
  ])('needs both Google settings or neither (%o)', (google, missing) => {
    const result = envSchema.safeParse({ ...validEnv, ...google })

    expect(result.success).toBe(false)
    expect(result.error?.issues.map((issue) => issue.path.join('.'))).toContain(missing)
  })

  it('allows a plain-http issuer (the local stand-in) only outside production', () => {
    const google = {
      GOOGLE_CLIENT_ID: 'dev-client',
      GOOGLE_CLIENT_SECRET: 'dev-secret',
      GOOGLE_ISSUER: 'http://localhost:4400/',
    }
    const dev = envSchema.safeParse({ ...validEnv, ...google })
    const prod = envSchema.safeParse({
      ...validEnv,
      ...google,
      NODE_ENV: AppEnv.PRODUCTION,
      EMAIL_PROVIDER: 'smtp',
      SMTP_URL: 'smtp://mail.test',
      SMS_PROVIDER: 'disabled',
    })

    expect(dev.success && dev.data.GOOGLE_ISSUER).toBe('http://localhost:4400')
    expect(prod.error?.issues.map((issue) => issue.path.join('.'))).toEqual(['GOOGLE_ISSUER'])
  })
})
