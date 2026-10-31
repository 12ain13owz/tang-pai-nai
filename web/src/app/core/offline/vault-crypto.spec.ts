import { createDataKey, PBKDF2_ITERATIONS, seal, unseal, unwrapDataKey, wrapDataKey } from './vault-crypto'

// Fewer PBKDF2 rounds keep the specs fast; the production default is checked on its own.
const ROUNDS = 1_000
const bytes = (text: string) => new TextEncoder().encode(text)

describe('vault crypto', () => {
  it('derives the PIN key with 600,000 PBKDF2 rounds by default (rule 4)', async () => {
    expect(PBKDF2_ITERATIONS).toBe(600_000)
    const wrapped = await wrapDataKey(await createDataKey(), '123456', ROUNDS)
    expect(wrapped.iterations).toBe(ROUNDS)
    expect(wrapped.salt.byteLength).toBe(16)
  })

  it('unwraps the data key with the right PIN only', async () => {
    const dataKey = await createDataKey()
    const wrapped = await wrapDataKey(dataKey, '123456', ROUNDS)

    expect(await unwrapDataKey(wrapped, '654321')).toBeNull()
    const unwrapped = await unwrapDataKey(wrapped, '123456')
    expect(unwrapped).not.toBeNull()
    // The unwrapped key opens what the original sealed.
    const sealed = await seal(dataKey, bytes('ข้าวมันไก่'))
    expect(new TextDecoder().decode(await unseal(unwrapped as CryptoKey, sealed))).toBe(
      'ข้าวมันไก่'
    )
  })

  it('wraps with a fresh salt each time, so a new PIN never reuses the old one', async () => {
    const dataKey = await createDataKey()
    const first = await wrapDataKey(dataKey, '123456', ROUNDS)
    const second = await wrapDataKey(dataKey, '123456', ROUNDS)
    expect(first.salt).not.toEqual(second.salt)
  })

  it('seals with a fresh IV and keeps nothing readable', async () => {
    const dataKey = await createDataKey()
    const plain = bytes('SQLite format 3')
    const first = await seal(dataKey, plain)
    const second = await seal(dataKey, plain)

    expect(first.iv).not.toEqual(second.iv)
    expect(new TextDecoder().decode(first.data)).not.toContain('SQLite')
    // jsdom and Node each have their own Uint8Array, so compare the bytes themselves.
    expect([...(await unseal(dataKey, first))]).toEqual([...plain])
  })

  it('refuses a snapshot that was changed or sealed with another key', async () => {
    const dataKey = await createDataKey()
    const sealed = await seal(dataKey, bytes('balance'))
    const tampered = new Uint8Array(sealed.data.slice(0))
    tampered[0] ^= 1

    await expect(unseal(dataKey, { iv: sealed.iv, data: tampered.buffer })).rejects.toBeTruthy()
    await expect(unseal(await createDataKey(), sealed)).rejects.toBeTruthy()
  })
})
