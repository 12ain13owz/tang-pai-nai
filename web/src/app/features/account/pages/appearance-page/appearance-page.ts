import { Component, computed, inject } from '@angular/core'
import { takeUntilDestroyed } from '@angular/core/rxjs-interop'
import { NonNullableFormBuilder } from '@angular/forms'
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco'
import { LANGUAGES, LanguageService } from '@/core/i18n'
import type { Language } from '@/core/i18n'
import { PALETTES, ThemeService } from '@/core/theme'
import type { PaletteId, ThemePreference } from '@/core/theme'
import { PalettePicker } from '@/features/account/pages/account-page/palette-picker'
import { SelectField } from '@/shared/components/form'
import type { SelectOption } from '@/shared/types'

/** Account › การแสดงผล: language, mode and theme (DESIGN.md §3, §11), each applied at once. */
@Component({
  selector: 'app-appearance-page',
  imports: [TranslocoPipe, SelectField, PalettePicker],
  template: `
    <div class="flex flex-col gap-4 p-4">
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
    </div>
  `,
})
export class AppearancePage {
  private nnfb = inject(NonNullableFormBuilder)
  private transloco = inject(TranslocoService)
  private themeService = inject(ThemeService)
  private languageService = inject(LanguageService)

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
