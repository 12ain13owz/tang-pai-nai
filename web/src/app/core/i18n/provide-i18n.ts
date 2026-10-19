import { inject, isDevMode, provideAppInitializer } from '@angular/core'
import type { EnvironmentProviders, Provider } from '@angular/core'
import { provideTransloco } from '@jsverse/transloco'
import { LanguageService } from './language.service'
import type { Translation, TranslocoLoader } from '@jsverse/transloco'

/**
 * Translations are bundled as lazy JS chunks instead of fetched JSON, so the service worker
 * prefetches them with the rest of the app shell and every language works offline.
 */
const TRANSLATIONS: Record<string, () => Promise<Translation>> = {
  th: async () => import('./th.json').then((m) => m.default),
  en: async () => import('./en.json').then((m) => m.default),
}

class BundledLoader implements TranslocoLoader {
  async getTranslation(lang: string): Promise<Translation> {
    const load = TRANSLATIONS[lang] ?? TRANSLATIONS['th']
    return load()
  }
}

export const provideI18n = (): (Provider | EnvironmentProviders)[] => [
  provideTransloco({
    config: {
      availableLangs: ['th', 'en'],
      defaultLang: 'th',
      fallbackLang: 'th',
      missingHandler: { useFallbackTranslation: true, logMissingKey: isDevMode() },
      reRenderOnLangChange: true,
      prodMode: !isDevMode(),
    },
    loader: BundledLoader,
  }),
  provideAppInitializer(async () => inject(LanguageService).init()),
]
