import { Component, computed, inject, signal } from '@angular/core'
import { takeUntilDestroyed } from '@angular/core/rxjs-interop'
import { NonNullableFormBuilder } from '@angular/forms'
import { Router, RouterLink } from '@angular/router'
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco'
import { NgIcon, provideIcons } from '@ng-icons/core'
import { lucideChevronRight, lucideLogOut, lucideShieldCheck } from '@ng-icons/lucide'
import { HlmButton } from '@spartan-ng/helm/button'
import { HlmSpinner } from '@spartan-ng/helm/spinner'
import { AuthService, AuthStore, SIGN_IN_URL } from '@/core/auth'
import { LANGUAGES, LanguageService } from '@/core/i18n'
import type { Language } from '@/core/i18n'
import { DeviceStorageService } from '@/core/pwa'
import { PALETTES, ThemeService } from '@/core/theme'
import type { PaletteId, ThemePreference } from '@/core/theme'
import { SelectField } from '@/shared/components/form'
import type { SelectOption } from '@/shared/types'
import { PalettePicker } from './palette-picker'

@Component({
  selector: 'app-account-page',
  imports: [TranslocoPipe, RouterLink, SelectField, PalettePicker, NgIcon, HlmButton, HlmSpinner],
  providers: [provideIcons({ lucideLogOut, lucideChevronRight, lucideShieldCheck })],
  template: `
    <div class="flex flex-col gap-6 p-4">
      @if (authStore.user(); as user) {
        <section class="flex flex-col gap-3" aria-labelledby="profile-heading">
          <h2 id="profile-heading" class="text-sm font-medium text-muted-foreground">
            {{ 'account.signedInAs' | transloco }}
          </h2>
          <div class="rounded-xl border border-border bg-card px-4 py-3 text-card-foreground">
            <p class="text-base font-medium break-all">{{ user.displayName }}</p>
            <p class="text-sm break-all text-muted-foreground">{{ user.email }}</p>
          </div>
        </section>

        <a
          routerLink="/account/security"
          class="flex min-h-14 items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 text-card-foreground"
        >
          <span
            class="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted text-xl text-muted-foreground"
            aria-hidden="true"
          >
            <ng-icon name="lucideShieldCheck" />
          </span>
          <span class="flex min-w-0 flex-1 flex-col">
            <span class="text-base">{{ 'account.security' | transloco }}</span>
            <span class="text-sm text-muted-foreground">
              {{ 'account.securityHint' | transloco }}
            </span>
          </span>
          <ng-icon
            name="lucideChevronRight"
            size="20"
            class="text-muted-foreground"
            aria-hidden="true"
          />
        </a>
      }

      <section class="flex flex-col gap-3" aria-labelledby="appearance-heading">
        <h2 id="appearance-heading" class="text-sm font-medium text-muted-foreground">
          {{ 'account.appearance' | transloco }}
        </h2>
        <app-select-field
          [control]="languageControl"
          [label]="'account.language' | transloco"
          [options]="languageOptions"
        />
        <app-select-field
          [control]="themeControl"
          [label]="'account.mode' | transloco"
          [options]="themeOptions()"
        />
        <app-palette-picker [control]="paletteControl" [palettes]="palettes" />
      </section>

      <section class="flex flex-col gap-3" aria-labelledby="device-heading">
        <h2 id="device-heading" class="text-sm font-medium text-muted-foreground">
          {{ 'account.device' | transloco }}
        </h2>
        <dl
          class="divide-y divide-border rounded-xl border border-border bg-card text-sm text-card-foreground"
        >
          <div class="flex items-center justify-between gap-4 px-4 py-3">
            <dt>{{ 'account.installed' | transloco }}</dt>
            <dd class="text-muted-foreground">
              {{
                (deviceStorageService.isInstalled()
                  ? 'account.installedYes'
                  : 'account.installedNo'
                ) | transloco
              }}
            </dd>
          </div>
          <div class="flex items-center justify-between gap-4 px-4 py-3">
            <dt>{{ 'account.persistent' | transloco }}</dt>
            <dd class="text-muted-foreground">
              @switch (deviceStorageService.isPersisted()) {
                @case (true) {
                  {{ 'account.persistentOn' | transloco }}
                }
                @case (false) {
                  {{ 'account.persistentOff' | transloco }}
                }
                @default {
                  {{ 'account.persistentUnknown' | transloco }}
                }
              }
            </dd>
          </div>
        </dl>
      </section>

      <section class="flex flex-col gap-3">
        <button
          hlmBtn
          variant="outline"
          type="button"
          class="h-11 w-full text-base"
          [disabled]="isSigningOut()"
          (click)="signOut()"
        >
          @if (isSigningOut()) {
            <hlm-spinner [aria-label]="'account.signingOut' | transloco" />
          } @else {
            <ng-icon name="lucideLogOut" aria-hidden="true" />
          }
          {{ 'account.signOut' | transloco }}
        </button>
        @if (signOutFailed()) {
          <p role="alert" class="text-center text-sm text-destructive">
            {{ 'account.signOutFailed' | transloco }}
          </p>
        }
      </section>
    </div>
  `,
})
export class AccountPage {
  private nnfb = inject(NonNullableFormBuilder)
  private transloco = inject(TranslocoService)
  private themeService = inject(ThemeService)
  private languageService = inject(LanguageService)
  protected deviceStorageService = inject(DeviceStorageService)
  private router = inject(Router)
  private authService = inject(AuthService)
  protected authStore = inject(AuthStore)

  protected isSigningOut = signal(false)
  protected signOutFailed = signal(false)

  protected readonly palettes = PALETTES
  // Language names are shown in their own language, so they never need translating.
  protected readonly languageOptions: readonly SelectOption<Language>[] = LANGUAGES.map(
    (language) => ({ value: language.id, label: language.label })
  )
  protected themeOptions = computed<readonly SelectOption<ThemePreference>[]>(() => {
    this.languageService.language() // re-translate on a language switch
    return [
      { value: 'system', label: this.transloco.translate('account.modeSystem') },
      { value: 'light', label: this.transloco.translate('account.modeLight') },
      { value: 'dark', label: this.transloco.translate('account.modeDark') },
    ]
  })

  protected languageControl = this.nnfb.control<Language | ''>(this.languageService.language().id)
  protected themeControl = this.nnfb.control<ThemePreference | ''>(this.themeService.preference())
  protected paletteControl = this.nnfb.control<PaletteId>(this.themeService.palette().id)

  constructor() {
    // Fresh profile; the one from sign-in is shown meanwhile, and offline it simply stays.
    this.authService.loadMe().catch(() => undefined)

    this.languageControl.valueChanges.pipe(takeUntilDestroyed()).subscribe((language) => {
      if (language) {
        this.languageService.setLanguage(language).catch((error: unknown) => {
          console.error('Language switch failed', error)
        })
      }
    })
    this.themeControl.valueChanges.pipe(takeUntilDestroyed()).subscribe((preference) => {
      if (preference) {
        this.themeService.setPreference(preference)
      }
    })
    this.paletteControl.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe((id) => this.themeService.setPalette(id))
  }

  protected async signOut(): Promise<void> {
    this.isSigningOut.set(true)
    this.signOutFailed.set(false)
    try {
      await this.authService.signOut()
      await this.router.navigateByUrl(SIGN_IN_URL, { replaceUrl: true })
    } catch {
      this.signOutFailed.set(true)
    } finally {
      this.isSigningOut.set(false)
    }
  }
}
