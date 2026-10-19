import { computed, DOCUMENT, effect, inject, Service, signal } from '@angular/core'

export type ThemePreference = 'light' | 'dark' | 'system'

export type PaletteId = 'midnight-gold' | 'indigo-night' | 'gold-coin' | 'plum'

export interface Palette {
  id: PaletteId
  /** Shown as-is in every language: theme names are brand-like and stay English. */
  label: string
  /** The palette's `--background`, light and dark, for the browser's `theme-color`. */
  themeColor: { light: string; dark: string }
}

const PREFERENCES: readonly ThemePreference[] = ['light', 'dark', 'system']

/** Each palette's tokens live in `src/styles/themes/<id>.css`. The first one is the default. */
export const PALETTES: readonly Palette[] = [
  {
    id: 'midnight-gold',
    label: 'Midnight Gold',
    themeColor: { light: '#f4f7fc', dark: '#070d1a' },
  },
  { id: 'indigo-night', label: 'Indigo Night', themeColor: { light: '#f5f7fc', dark: '#080d1a' } },
  { id: 'gold-coin', label: 'Gold Coin', themeColor: { light: '#faf6f1', dark: '#110c08' } },
  { id: 'plum', label: 'Plum', themeColor: { light: '#f9f5fa', dark: '#110a15' } },
]

const DEFAULT_PALETTE = PALETTES[0]

/**
 * Two independent choices, both kept in localStorage: light / dark mode (follows the OS by
 * default) and the colour palette. `index.html` applies both before boot, so keep the keys and
 * theme colours in sync with it.
 */
@Service()
export class ThemeService {
  private document = inject(DOCUMENT)
  private readonly STORAGE_KEY = 'tpn-theme'
  private readonly PALETTE_KEY = 'tpn-palette'

  private darkQuery = this.document.defaultView?.matchMedia('(prefers-color-scheme: dark)')
  private systemDark = signal(this.darkQuery?.matches ?? false)

  preference = signal<ThemePreference>(this.readPreference())
  palette = signal<Palette>(this.readPalette())
  isDark = computed(() => {
    const preference = this.preference()
    return preference === 'system' ? this.systemDark() : preference === 'dark'
  })

  constructor() {
    this.darkQuery?.addEventListener('change', (event) => this.systemDark.set(event.matches))

    effect(() => {
      const dark = this.isDark()
      const palette = this.palette()
      const root = this.document.documentElement
      root.classList.toggle('dark', dark)
      root.dataset['palette'] = palette.id
      this.document
        .querySelector('meta[name="theme-color"]')
        ?.setAttribute('content', dark ? palette.themeColor.dark : palette.themeColor.light)
    })
  }

  setPreference(preference: ThemePreference): void {
    this.preference.set(preference)
    this.save(this.STORAGE_KEY, preference === 'system' ? null : preference)
  }

  setPalette(id: PaletteId): void {
    this.palette.set(PALETTES.find((palette) => palette.id === id) ?? DEFAULT_PALETTE)
    this.save(this.PALETTE_KEY, id === DEFAULT_PALETTE.id ? null : id)
  }

  /** `null` removes the key, so the default applies (and can change in a later release). */
  private save(key: string, value: string | null): void {
    try {
      if (value === null) {
        localStorage.removeItem(key)
      } else {
        localStorage.setItem(key, value)
      }
    } catch {
      // Storage can be blocked (private mode); the choice still applies for this session.
    }
  }

  private read(key: string): string | null {
    try {
      return localStorage.getItem(key)
    } catch {
      return null
    }
  }

  private readPreference(): ThemePreference {
    const saved = this.read(this.STORAGE_KEY)
    return PREFERENCES.find((preference) => preference === saved) ?? 'system'
  }

  private readPalette(): Palette {
    const saved = this.read(this.PALETTE_KEY)
    return PALETTES.find((palette) => palette.id === saved) ?? DEFAULT_PALETTE
  }
}
