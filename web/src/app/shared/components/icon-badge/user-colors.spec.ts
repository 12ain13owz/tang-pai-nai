import { glyphColor, USER_COLORS } from './user-colors'
import { FALLBACK_ICON, knownIcon, PROFILE_ICON_NAMES } from './user-icons'

describe('glyphColor', () => {
  it('picks the glyph with the higher contrast', () => {
    expect(glyphColor('#2563eb')).toBe('#ffffff')
    expect(glyphColor('#ca8a04')).toBe('#000000')
    expect(glyphColor('#ffffff')).toBe('#000000')
    expect(glyphColor('#000000')).toBe('#ffffff')
  })

  it('falls back to white for something that is not #rrggbb', () => {
    expect(glyphColor('red')).toBe('#ffffff')
  })

  it('gives every palette colour a glyph of at least 4.5:1 contrast', () => {
    const channel = (hex: string, at: number) => {
      const v = parseInt(hex.slice(at, at + 2), 16) / 255
      return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
    }
    const lum = (hex: string) =>
      0.2126 * channel(hex, 1) + 0.7152 * channel(hex, 3) + 0.0722 * channel(hex, 5)
    for (const color of USER_COLORS) {
      const [a, b] = [lum(color), lum(glyphColor(color))].sort((x, y) => y - x)
      expect((a + 0.05) / (b + 0.05)).toBeGreaterThanOrEqual(4.5)
    }
  })
})

describe('knownIcon', () => {
  it('keeps a curated icon and replaces an unknown one', () => {
    expect(knownIcon('lucideStore')).toBe('lucideStore')
    expect(knownIcon('lucideRocket')).toBe(FALLBACK_ICON)
    expect(PROFILE_ICON_NAMES.every((name) => /^lucide[A-Z]/.test(name))).toBe(true)
  })
})
