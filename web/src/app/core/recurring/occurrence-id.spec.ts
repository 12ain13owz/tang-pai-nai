import { occurrenceId, sha256 } from './occurrence-id'

const hex = (bytes: Uint8Array) =>
  [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')

describe('occurrence ids (recurring rule 9)', () => {
  it('hashes with SHA-256 (the standard vectors, multi-block and UTF-8)', () => {
    expect(hex(sha256(''))).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
    expect(hex(sha256('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    )
    expect(hex(sha256('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'))).toBe(
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1'
    )
    expect(hex(sha256('ก'))).toBe(
      '2d1d9c572948ea561abf37b1aec906fd2ea595d9b8f182845f0cf0876f544fb2'
    )
  })

  it('gives one rule and day the same UUID (version 8) on every device, another day another', () => {
    const id = occurrenceId('0199a000-0000-7000-8000-000000000001', '2026-11-01')
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(occurrenceId('0199a000-0000-7000-8000-000000000001', '2026-11-01')).toBe(id)
    expect(occurrenceId('0199a000-0000-7000-8000-000000000001', '2026-12-01')).not.toBe(id)
    expect(occurrenceId('0199a000-0000-7000-8000-000000000002', '2026-11-01')).not.toBe(id)
  })
})
