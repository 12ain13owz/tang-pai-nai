import { computed, DOCUMENT, effect, inject, Service, signal } from '@angular/core'

export type ThemePreference = 'light' | 'dark' | 'system'

const PREFERENCES: readonly ThemePreference[] = ['light', 'dark', 'system']

/**
 * Light / dark mode. Follows the OS by default; the user can pin light or dark, kept in
 * localStorage. `index.html` applies the saved choice before boot, so keep the key in sync.
 */
@Service()
export class ThemeService {
  private document = inject(DOCUMENT)
  private readonly STORAGE_KEY = 'tpn-theme'
  private readonly THEME_COLORS = { light: '#ffffff', dark: '#0a0a0a' } as const

  private darkQuery = this.document.defaultView?.matchMedia('(prefers-color-scheme: dark)')
  private systemDark = signal(this.darkQuery?.matches ?? false)

  preference = signal<ThemePreference>(this.readPreference())
  isDark = computed(() => {
    const preference = this.preference()
    return preference === 'system' ? this.systemDark() : preference === 'dark'
  })

  constructor() {
    this.darkQuery?.addEventListener('change', (event) => this.systemDark.set(event.matches))

    effect(() => {
      const dark = this.isDark()
      this.document.documentElement.classList.toggle('dark', dark)
      this.document
        .querySelector('meta[name="theme-color"]')
        ?.setAttribute('content', dark ? this.THEME_COLORS.dark : this.THEME_COLORS.light)
    })
  }

  setPreference(preference: ThemePreference): void {
    this.preference.set(preference)
    try {
      if (preference === 'system') {
        localStorage.removeItem(this.STORAGE_KEY)
      } else {
        localStorage.setItem(this.STORAGE_KEY, preference)
      }
    } catch {
      // Storage can be blocked (private mode); the choice still applies for this session.
    }
  }

  private readPreference(): ThemePreference {
    try {
      const saved = localStorage.getItem(this.STORAGE_KEY)
      return PREFERENCES.find((preference) => preference === saved) ?? 'system'
    } catch {
      return 'system'
    }
  }
}
