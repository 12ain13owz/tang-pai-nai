import { describe, expect, it } from 'vitest'
import { createSealedBox } from './sealed-box'

const SECRET = 'sealed-box-test-secret-0000000000'

describe('createSealedBox', () => {
  it('opens what it sealed, and nobody can read it on the way', async () => {
    const box = createSealedBox(SECRET, 'flow')

    const sealed = await box.seal({ state: 'abc', returnUrl: '/wallets' }, 600)

    expect(sealed.split('.')).toHaveLength(5) // compact JWE
    expect(Buffer.from(sealed.split('.')[3], 'base64url').toString()).not.toContain('wallets')
    await expect(box.open(sealed)).resolves.toMatchObject({ state: 'abc', returnUrl: '/wallets' })
  })

  it('refuses a changed value, garbage, or one sealed for another purpose or secret', async () => {
    const box = createSealedBox(SECRET, 'flow')
    const sealed = await box.seal({ state: 'abc' }, 600)
    const parts = sealed.split('.')
    parts[3] = `${parts[3].slice(0, -2)}AA`

    await expect(box.open(parts.join('.'))).resolves.toBeNull()
    await expect(box.open('not-a-jwe')).resolves.toBeNull()
    await expect(createSealedBox(SECRET, 'other').open(sealed)).resolves.toBeNull()
    await expect(createSealedBox(`${SECRET}x`, 'flow').open(sealed)).resolves.toBeNull()
  })

  it('refuses a value past its lifetime', async () => {
    const box = createSealedBox(SECRET, 'flow')

    const sealed = await box.seal({ state: 'abc' }, 0)

    await expect(box.open(sealed)).resolves.toBeNull()
  })
})
