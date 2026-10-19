import { Component, computed, inject } from '@angular/core'
import { takeUntilDestroyed } from '@angular/core/rxjs-interop'
import { NonNullableFormBuilder } from '@angular/forms'
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco'
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
  imports: [TranslocoPipe, SelectField, PalettePicker],
  template: `
    <div class="flex flex-col gap-6 p-4">
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
    </div>
  `,
})
export class AccountPage {
  private nnfb = inject(NonNullableFormBuilder)
  private transloco = inject(TranslocoService)
  private themeService = inject(ThemeService)
  private languageService = inject(LanguageService)
  protected deviceStorageService = inject(DeviceStorageService)

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
}
