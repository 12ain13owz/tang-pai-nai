import { Component, computed, inject, signal } from '@angular/core'
import { toSignal } from '@angular/core/rxjs-interop'
import { NonNullableFormBuilder } from '@angular/forms'
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco'
import { NgIcon, provideIcons } from '@ng-icons/core'
import {
  lucideCircleCheck,
  lucideCompass,
  lucideDownload,
  lucideEllipsisVertical,
  lucideShare,
  lucideSquarePlus,
} from '@ng-icons/lucide'
import { HlmButton } from '@spartan-ng/helm/button'
import { LanguageService } from '@/core/i18n'
import { DeviceStorageService } from '@/core/pwa'
import type { InstallPlatform } from '@/core/pwa'
import { SegmentedField } from '@/shared/components/form'
import type { SelectOption } from '@/shared/types'

interface Step {
  /** A translation key. */
  text: string
  /** The icon the person looks for on their screen. */
  icon: string
}

const STEPS: Record<InstallPlatform, readonly Step[]> = {
  ios: [
    { text: 'install.ios1', icon: 'lucideCompass' },
    { text: 'install.ios2', icon: 'lucideShare' },
    { text: 'install.ios3', icon: 'lucideSquarePlus' },
    { text: 'install.ios4', icon: 'lucideCircleCheck' },
  ],
  android: [
    { text: 'install.android1', icon: 'lucideCompass' },
    { text: 'install.android2', icon: 'lucideEllipsisVertical' },
    { text: 'install.android3', icon: 'lucideDownload' },
    { text: 'install.android4', icon: 'lucideCircleCheck' },
  ],
}

/**
 * Account › ติดตั้งลงหน้าจอ (install.md): already installed, the one-tap install where the browser
 * offers it, and the steps for iPhone and Android.
 */
@Component({
  selector: 'app-install-page',
  imports: [TranslocoPipe, NgIcon, HlmButton, SegmentedField],
  providers: [
    provideIcons({
      lucideCircleCheck,
      lucideCompass,
      lucideDownload,
      lucideEllipsisVertical,
      lucideShare,
      lucideSquarePlus,
    }),
  ],
  template: `
    <div class="flex flex-col gap-5 p-4">
      @if (deviceStorageService.isInstalled() || deviceStorageService.justInstalled()) {
        <div class="flex items-start gap-3 rounded-xl bg-brand/10 px-4 py-3" role="status">
          <ng-icon name="lucideCircleCheck" size="22" class="shrink-0 text-brand" />
          <div class="flex flex-col gap-1">
            <p class="font-semibold">{{ 'install.doneHeading' | transloco }}</p>
            <p class="text-sm text-muted-foreground">
              {{
                (deviceStorageService.isInstalled() ? 'install.doneText' : 'install.justText')
                  | transloco
              }}
            </p>
          </div>
        </div>
      } @else {
        <p class="text-sm text-muted-foreground">{{ 'install.why' | transloco }}</p>
        @if (deviceStorageService.canPrompt()) {
          <button hlmBtn type="button" class="h-11 w-full text-base" (click)="install()">
            <ng-icon name="lucideDownload" size="20" aria-hidden="true" />
            {{ 'install.button' | transloco }}
          </button>
        }
        @if (dismissed()) {
          <p class="text-sm text-muted-foreground">{{ 'install.dismissed' | transloco }}</p>
        }
        <section class="flex flex-col gap-3" aria-labelledby="install-steps">
          <h2 id="install-steps" class="text-sm font-medium text-muted-foreground">
            {{ 'install.stepsHeading' | transloco }}
          </h2>
          <app-segmented-field
            [control]="platformControl"
            [label]="'install.platform' | transloco"
            [options]="platformOptions()"
          />
          <ol
            class="divide-y divide-border rounded-xl border border-border bg-card text-card-foreground"
          >
            @for (step of steps(); track step.text; let index = $index) {
              <li class="flex items-center gap-3 px-4 py-3">
                <span
                  class="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-semibold"
                  aria-hidden="true"
                  >{{ index + 1 }}</span
                >
                <span class="min-w-0 flex-1">{{ step.text | transloco }}</span>
                <span
                  class="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-brand"
                  aria-hidden="true"
                >
                  <ng-icon [name]="step.icon" size="20" />
                </span>
              </li>
            }
          </ol>
          <p class="text-sm text-muted-foreground">
            {{ 'install.' + platform() + 'Note' | transloco }}
          </p>
        </section>
      }
    </div>
  `,
})
export class InstallPage {
  private nnfb = inject(NonNullableFormBuilder)
  private transloco = inject(TranslocoService)
  private languageService = inject(LanguageService)
  protected deviceStorageService = inject(DeviceStorageService)

  // Starts on this phone's own steps (install.md rule 3).
  protected platformControl = this.nnfb.control<string>(this.deviceStorageService.platform)
  protected platform = toSignal(this.platformControl.valueChanges, {
    initialValue: this.platformControl.value,
  })
  protected steps = computed(() => STEPS[this.platform() === 'ios' ? 'ios' : 'android'])
  // Platform names are names: the same in both languages.
  protected platformOptions = computed<readonly SelectOption<InstallPlatform>[]>(() => {
    this.languageService.language()
    return [
      { value: 'ios', label: this.transloco.translate('install.ios') },
      { value: 'android', label: this.transloco.translate('install.android') },
    ]
  })
  /** The browser's dialog was closed without installing: the steps still work. */
  protected dismissed = signal(false)

  protected async install(): Promise<void> {
    const installed = await this.deviceStorageService.promptInstall()
    this.dismissed.set(!installed)
  }
}
