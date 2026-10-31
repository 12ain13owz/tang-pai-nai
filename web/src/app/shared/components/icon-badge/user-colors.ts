/**
 * The colours a user can pick for a profile (and later wallets and categories). User colours
 * are data, the only raw colours allowed (DESIGN.md §3); the glyph on them is white or black,
 * whichever contrasts more.
 */
export const USER_COLORS = [
  '#2563eb',
  '#0891b2',
  '#0d9488',
  '#16a34a',
  '#ca8a04',
  '#ea580c',
  '#dc2626',
  '#db2777',
  '#9333ea',
  '#475569',
] as const

const channel = (hex: string, at: number): number => {
  const value = parseInt(hex.slice(at, at + 2), 16) / 255
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
}

/** WCAG relative luminance of `#rrggbb`. */
const luminance = (hex: string): number =>
  0.2126 * channel(hex, 1) + 0.7152 * channel(hex, 3) + 0.0722 * channel(hex, 5)

/** `#ffffff` or `#000000`, whichever has the higher contrast on `hex`. */
export const glyphColor = (hex: string): string => {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) {
    return '#ffffff'
  }
  const l = luminance(hex)
  return 1.05 / (l + 0.05) >= (l + 0.05) / 0.05 ? '#ffffff' : '#000000'
}
