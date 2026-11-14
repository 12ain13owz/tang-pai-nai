import { OVERLAY_DEFAULT_CONFIG } from '@angular/cdk/overlay'
import {
  inject,
  isDevMode,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
} from '@angular/core'
import type { ApplicationConfig } from '@angular/core'
import { provideRouter, TitleStrategy, withInMemoryScrolling } from '@angular/router'
import { provideServiceWorker } from '@angular/service-worker'
import { provideAuth } from '@/core/auth'
import { provideI18n } from '@/core/i18n'
import { PageTitleStrategy } from '@/core/routing'
import { ThemeService } from '@/core/theme'
import { routes } from './app.routes'

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    // A page opened anew starts at the top; back (‹, the browser's) returns to where it was.
    provideRouter(routes, withInMemoryScrolling({ scrollPositionRestoration: 'enabled' })),
    provideAuth(),
    provideI18n(),
    { provide: TitleStrategy, useExisting: PageTitleStrategy },
    // Overlays (sheets, menus) stay in the page instead of the browser's top layer, so the toaster
    // (z-index above the overlay container) shows over an open sheet and its backdrop (8.2).
    { provide: OVERLAY_DEFAULT_CONFIG, useValue: { usePopover: false } },
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
