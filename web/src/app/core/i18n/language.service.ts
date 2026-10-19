import { computed, DOCUMENT, inject, Service, signal } from '@angular/core'
import { firstValueFrom } from 'rxjs'
import { TranslocoService } from '@jsverse/transloco'

export type Language = 'th' | 'en'

export interface LanguageOption {
  id: Language
  /** Each language names itself, so it can be found from the other one. */
  label: string
  /** Locale for `Intl` number / date / currency formatting. */
  locale: string
}

export const LANGUAGES: readonly LanguageOption[] = [
  { id: 'th', label: 'ไทย', locale: 'th-TH' },
  { id: 'en', label: 'English', locale: 'en-GB' },
]

const DEFAULT_LANGUAGE = LANGUAGES[0]

/**
 * The UI language: Thai by default, switchable at runtime (no reload), kept in localStorage.
 * `index.html` sets `<html lang>` before boot, so keep the key in sync with it.
 */
@Service()
export class LanguageService {
  private document = inject(DOCUMENT)
  private transloco = inject(TranslocoService)
  private readonly STORAGE_KEY = 'tpn-lang'

  language = signal<LanguageOption>(this.readLanguage())
  /** `th-TH` (Buddhist era) or `en-GB` (Gregorian, day-month order). */
  locale = computed(() => this.language().locale)

  /** Loads the saved language before the first render, so no screen flashes untranslated keys. */
  async init(): Promise<void> {
    await this.apply(this.language())
  }

  async setLanguage(id: Language): Promise<void> {
    const language = LANGUAGES.find((option) => option.id === id) ?? DEFAULT_LANGUAGE
    await this.apply(language)
    try {
      if (language.id === DEFAULT_LANGUAGE.id) {
        localStorage.removeItem(this.STORAGE_KEY)
      } else {
        localStorage.setItem(this.STORAGE_KEY, language.id)
      }
    } catch {
      // Storage can be blocked (private mode); the choice still applies for this session.
    }
  }

  private async apply(language: LanguageOption): Promise<void> {
    // Load first, then switch, so the whole UI changes in one go instead of showing keys.
    await firstValueFrom(this.transloco.load(language.id))
    this.transloco.setActiveLang(language.id)
    this.document.documentElement.lang = language.id
    this.language.set(language)
  }

  private readLanguage(): LanguageOption {
    try {
      const saved = localStorage.getItem(this.STORAGE_KEY)
      return LANGUAGES.find((option) => option.id === saved) ?? DEFAULT_LANGUAGE
    } catch {
      return DEFAULT_LANGUAGE
    }
  }
}
