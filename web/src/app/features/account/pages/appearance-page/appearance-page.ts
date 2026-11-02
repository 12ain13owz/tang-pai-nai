import { Component, computed, inject } from '@angular/core'
import { takeUntilDestroyed } from '@angular/core/rxjs-interop'
import { NonNullableFormBuilder } from '@angular/forms'
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco'
import { LANGUAGES, LanguageService } from '@/core/i18n'
import type { Language } from '@/core/i18n'
import { PALETTES, ThemeService } from '@/core/theme'
import type { PaletteId, ThemePreference } from '@/core/theme'
import { QuickAmountsService } from '@/core/transaction'
import { PalettePicker } from '@/features/account/pages/account-page/palette-picker'
import { SelectField, SwitchField } from '@/shared/components/form'
import type { SelectOption } from '@/shared/types'

/**
 * Account › การแสดงผล: language, mode, theme (DESIGN.md §3, §11) and the keypad's quick amounts
 * (transaction.md, 8.2), each applied at once.
 */
@Component({
  selector: 'app-appearance-page',
  imports: [TranslocoPipe, SelectField, SwitchField, PalettePicker],
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
      <div class="border-t border-border pt-4">
        <app-switch-field
          [control]="quickAmountsControl"
          [label]="'account.quickAmounts' | transloco"
          [hint]="'account.quickAmountsHint' | transloco"
        />
      </div>
    </div>
  `,
})
export class AppearancePage {
  private nnfb = inject(NonNullableFormBuilder)
  private transloco = inject(TranslocoService)
  private themeService = inject(ThemeService)
  private languageService = inject(LanguageService)
  private quickAmountsService = inject(QuickAmountsService)

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
  protected quickAmountsControl = this.nnfb.control(this.quickAmountsService.enabled())

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
    this.quickAmountsControl.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe((enabled) => this.quickAmountsService.setEnabled(enabled))
  }
}
