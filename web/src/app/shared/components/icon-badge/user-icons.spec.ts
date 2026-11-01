import en from '@/core/i18n/en.json'
import th from '@/core/i18n/th.json'
import { TPN_ICONS } from './tpn-icons'
import {
  FALLBACK_ICON,
  knownIcon,
  PROFILE_ICON_NAMES,
  USER_ICONS,
  WALLET_DEFAULT_ICON,
  WALLET_ICON_GROUPS,
} from './user-icons'

describe('user icons', () => {
  it('keeps a known icon and draws the fallback for one this build lacks', () => {
    expect(knownIcon('tpnBankColumns')).toBe('tpnBankColumns')
    expect(knownIcon('lucideRocket')).toBe(FALLBACK_ICON)
    expect(knownIcon('tpnSomethingNew', WALLET_DEFAULT_ICON)).toBe('lucideWallet')
  })

  it('names every pickable icon with the shape the API accepts, labelled in both languages', () => {
    for (const name of Object.keys(USER_ICONS)) {
      expect(name).toMatch(/^(lucide|tpn)[A-Z][A-Za-z0-9]*$/)
      expect(name.length).toBeLessThanOrEqual(40)
      expect(th.icons).toHaveProperty(name)
      expect(en.icons).toHaveProperty(name)
    }
  })

  it('builds the wallet catalogue from known icons, once each, in labelled groups', () => {
    const names = WALLET_ICON_GROUPS.flatMap((group) => group.icons)
    expect(new Set(names).size).toBe(names.length)
    expect(names.every((name) => name in USER_ICONS)).toBe(true)
    expect(names).toContain(WALLET_DEFAULT_ICON)
    expect(names.filter((name) => name.startsWith('tpn')).sort()).toEqual(
      Object.keys(TPN_ICONS).sort()
    )
    for (const group of WALLET_ICON_GROUPS) {
      expect(th.iconGroups).toHaveProperty(group.key)
    }
    expect(PROFILE_ICON_NAMES.every((name) => name.startsWith('lucide'))).toBe(true)
  })

  it("draws every tpn icon in lucide's style: 24 × 24, 2px round stroke, no fill", () => {
    for (const svg of Object.values(TPN_ICONS)) {
      expect(svg).toMatch(/^<svg [^>]*viewBox="0 0 24 24"/)
      expect(svg).toContain('fill="none" stroke="currentColor" stroke-width="2"')
      expect(svg).toContain('stroke-linecap="round" stroke-linejoin="round"')
      expect(svg).not.toMatch(/<(text|image|use)\b/)
    }
  })
})
