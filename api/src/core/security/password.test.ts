import { hash } from '@node-rs/argon2'
import { describe, expect, it } from 'vitest'
import {
  hashPassword,
  PASSWORD_HASH_OPTIONS,
  passwordNeedsRehash,
  verifyDummyPassword,
  verifyPassword,
} from './password'

describe('hashPassword', () => {
  it('returns an Argon2id PHC string with the configured parameters and a fresh salt', async () => {
    const first = await hashPassword('Gr33n Mango Tree')
    const second = await hashPassword('Gr33n Mango Tree')

    const { memoryCost, timeCost, parallelism } = PASSWORD_HASH_OPTIONS
    expect(first.startsWith(`$argon2id$v=19$m=${memoryCost},t=${timeCost},p=${parallelism}$`)).toBe(
      true
    )
    expect(first).not.toContain('Gr33n')
    expect(second).not.toBe(first)
  })

  it('uses at least the OWASP baseline (19 MiB, 2 passes, 1 lane)', () => {
    expect(PASSWORD_HASH_OPTIONS.memoryCost).toBeGreaterThanOrEqual(19 * 1024)
    expect(PASSWORD_HASH_OPTIONS.timeCost).toBeGreaterThanOrEqual(2)
    expect(PASSWORD_HASH_OPTIONS.parallelism).toBe(1)
  })
})

describe('verifyPassword', () => {
  it('accepts the right password and refuses a wrong one', async () => {
    const stored = await hashPassword('Gr33n Mango Tree')

    expect(await verifyPassword(stored, 'Gr33n Mango Tree')).toBe(true)
    expect(await verifyPassword(stored, 'gr33n mango tree')).toBe(false)
  })

  it('answers false instead of throwing for a hash it cannot parse', async () => {
    expect(await verifyPassword('not a phc string', 'anything')).toBe(false)
  })
})

describe('passwordNeedsRehash', () => {
  it('is false for a hash made with the current parameters', async () => {
    expect(passwordNeedsRehash(await hashPassword('x'))).toBe(false)
  })

  it('is true for a hash made with weaker parameters or that is not Argon2id', async () => {
    const weaker = await hash('x', { memoryCost: 8192, timeCost: 1, parallelism: 1 })

    expect(passwordNeedsRehash(weaker)).toBe(true)
    expect(passwordNeedsRehash('$2b$10$bcrypthashbcrypthashbcrypthashbcrypthashbcrypthash')).toBe(
      true
    )
  })
})

describe('verifyDummyPassword', () => {
  it('always answers false', async () => {
    expect(await verifyDummyPassword('')).toBe(false)
    expect(await verifyDummyPassword('Gr33n Mango Tree')).toBe(false)
  })
})
