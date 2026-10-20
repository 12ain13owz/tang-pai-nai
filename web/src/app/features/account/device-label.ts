/** What a session row shows for its user agent (auth spec rule 28). */
export interface DeviceLabel {
  /** `Chrome · Android`, or `null` when the user agent says nothing we know. */
  name: string | null
  kind: 'phone' | 'tablet' | 'computer'
}

// First match wins, so the browsers built on Chrome (and Chrome on iOS) come before Chrome itself.
const BROWSERS: [RegExp, string][] = [
  [/EdgA?\//, 'Edge'],
  [/SamsungBrowser\//, 'Samsung Internet'],
  [/OPR\/|Opera/, 'Opera'],
  [/Line\//, 'LINE'],
  [/FBAN|FBAV/, 'Facebook'],
  [/CriOS\/|Chrome\//, 'Chrome'],
  [/FxiOS\/|Firefox\//, 'Firefox'],
  [/Safari\//, 'Safari'],
]

const SYSTEMS: [RegExp, string][] = [
  [/iPhone|iPod/, 'iPhone'],
  [/iPad/, 'iPad'],
  [/Android/, 'Android'],
  [/CrOS/, 'ChromeOS'],
  [/Windows/, 'Windows'],
  [/Macintosh|Mac OS X/, 'Mac'],
  [/Linux/, 'Linux'],
]

const firstMatch = (userAgent: string, table: [RegExp, string][]): string | null =>
  table.find(([pattern]) => pattern.test(userAgent))?.[1] ?? null

/**
 * A short, human name for a user agent: browser and system ("Chrome · Android"). It's a hint for
 * the owner, not a security check: any client can send any user agent.
 */
export const deviceLabel = (userAgent: string | null): DeviceLabel => {
  if (!userAgent) {
    return { name: null, kind: 'computer' }
  }
  const browser = firstMatch(userAgent, BROWSERS)
  const system = firstMatch(userAgent, SYSTEMS)
  const name = [browser, system].filter(Boolean).join(' · ') || null
  const tablet =
    /iPad|Tablet/.test(userAgent) || (/Android/.test(userAgent) && !/Mobile/.test(userAgent))
  const phone = !tablet && /Mobile|iPhone|iPod|Android/.test(userAgent)
  return { name, kind: tablet ? 'tablet' : phone ? 'phone' : 'computer' }
}
