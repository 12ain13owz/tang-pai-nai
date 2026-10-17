import {
  inject,
  isDevMode,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
} from '@angular/core'
import type { ApplicationConfig } from '@angular/core'
import { provideRouter, TitleStrategy } from '@angular/router'
import { provideServiceWorker } from '@angular/service-worker'
import { PageTitleStrategy } from '@/core/routing'
import { ThemeService } from '@/core/theme'
import { routes } from './app.routes'

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    { provide: TitleStrategy, useExisting: PageTitleStrategy },
    // Start the theme at boot so it follows OS changes on every screen, not only after settings.
    provideAppInitializer(() => {
      inject(ThemeService)
    }),
    // App shell only (see ngsw-config.json); never API data. Off in `ng serve`.
    provideServiceWorker('ngsw-worker.js', {
      enabled: !isDevMode(),
      registrationStrategy: 'registerWhenStable:30000',
    }),
  ],
}
