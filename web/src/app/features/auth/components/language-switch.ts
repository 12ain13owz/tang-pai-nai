import { Component, inject } from '@angular/core'
import { TranslocoPipe } from '@jsverse/transloco'
import { LANGUAGES, LanguageService } from '@/core/i18n'
import type { Language } from '@/core/i18n'

/**
 * ไทย | English, for screens before sign-in (the account page isn't reachable yet). Each language
 * names itself, so someone stuck in the wrong one can still find it.
 */
@Component({
  selector: 'app-language-switch',
  imports: [TranslocoPipe],
  template: `
    <div
      role="group"
      class="flex rounded-full bg-muted p-1 text-sm"
      [attr.aria-label]="'account.language' | transloco"
    >
      @for (language of languages; track language.id) {
        <button
          type="button"
          class="min-h-11 rounded-full px-3 text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none aria-pressed:bg-background aria-pressed:font-medium aria-pressed:text-foreground aria-pressed:shadow-sm"
          [attr.lang]="language.id"
          [attr.aria-pressed]="languageService.language().id === language.id"
          (click)="select(language.id)"
        >
          {{ language.label }}
        </button>
      }
    </div>
  `,
})
export class LanguageSwitch {
  protected languageService = inject(LanguageService)
  protected readonly languages = LANGUAGES

  protected select(id: Language): void {
    this.languageService.setLanguage(id).catch((error: unknown) => {
      console.error('Language switch failed', error)
    })
  }
}
