import { uuidv7 } from './uuid'

describe('uuidv7', () => {
  it('is a version 7, RFC 4122 variant UUID', () => {
    expect(uuidv7()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    )
  })

  it('starts with the time in ms, so ids sort by creation', () => {
    const id = uuidv7(0x0199a0001234)
    expect(id.startsWith('0199a000-1234-7')).toBe(true)
    expect(uuidv7(1000) < uuidv7(2000)).toBe(true)
  })

  it('differs between calls in the same ms', () => {
    expect(uuidv7(5)).not.toBe(uuidv7(5))
  })
})
