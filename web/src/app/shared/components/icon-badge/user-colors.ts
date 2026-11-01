/**
 * The colours a user can pick for a profile, wallet or category. User colours are data, the only
 * raw colours allowed (DESIGN.md §3). Each is dark enough for a **white** glyph at ≥ 4.5:1
 * (owner's choice in #7: white icons everywhere), so `glyphColor` picks white on all of them.
 */
export const USER_COLORS = [
  '#2563eb',
  '#0e7490',
  '#0f766e',
  '#15803d',
  '#a16207',
  '#c2410c',
  '#dc2626',
  '#db2777',
  '#9333ea',
  '#475569',
] as const

/**
 * Colours of the palette before #7, made one step darker then. Rows keep the hex they were saved
 * with, so they are drawn with the new colour (`userColor`) and saved with it on their next edit.
 */
const RENAMED_COLORS: Readonly<Record<string, string>> = {
  '#0891b2': '#0e7490',
  '#0d9488': '#0f766e',
  '#16a34a': '#15803d',
  '#ca8a04': '#a16207',
  '#ea580c': '#c2410c',
}

/** The colour to draw for a stored `color` (an old palette colour becomes its darker one). */
export const userColor = (hex: string): string => RENAMED_COLORS[hex.toLowerCase()] ?? hex

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
