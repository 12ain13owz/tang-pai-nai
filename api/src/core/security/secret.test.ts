import { describe, expect, it } from 'vitest'
import { createKeyedHasher, randomCode, randomToken, safeEqualHex, sha256 } from './secret'

describe('randomToken', () => {
  it('returns 43 URL-safe characters for 32 bytes, different every time', () => {
    const token = randomToken()

    expect(token).toMatch(/^[\w-]{43}$/)
    expect(randomToken()).not.toBe(token)
  })
})

describe('randomCode', () => {
  it('returns exactly the requested number of digits, zero-padded', () => {
    const codes = Array.from({ length: 200 }, () => randomCode(6))

    expect(codes.every((code) => /^\d{6}$/.test(code))).toBe(true)
    expect(randomCode(1)).toMatch(/^\d$/)
  })
})

describe('createKeyedHasher', () => {
  it('gives a different digest than a plain hash, and a different one per secret', () => {
    const one = createKeyedHasher('secret-one')
    const two = createKeyedHasher('secret-two')

    expect(one('123456')).toMatch(/^[0-9a-f]{64}$/)
    expect(one('123456')).toBe(one('123456'))
    expect(one('123456')).not.toBe(two('123456'))
    expect(one('123456')).not.toBe(sha256('123456'))
  })
})

describe('safeEqualHex', () => {
  it('is true only for equal digests', () => {
    expect(safeEqualHex(sha256('a'), sha256('a'))).toBe(true)
    expect(safeEqualHex(sha256('a'), sha256('b'))).toBe(false)
  })

  it('is false, not a throw, for digests of different lengths', () => {
    expect(safeEqualHex('abcd', sha256('a'))).toBe(false)
  })
})
