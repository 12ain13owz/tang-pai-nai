import { Component, computed, DOCUMENT, inject, signal, viewChild } from '@angular/core'
import { toSignal } from '@angular/core/rxjs-interop'
import { NonNullableFormBuilder } from '@angular/forms'
import { ActivatedRoute, Router } from '@angular/router'
import { TranslocoPipe } from '@jsverse/transloco'
import { NgIcon, provideIcons } from '@ng-icons/core'
import { lucideArrowLeft, lucideShieldCheck } from '@ng-icons/lucide'
import { HlmButton } from '@spartan-ng/helm/button'
import { HlmSpinner } from '@spartan-ng/helm/spinner'
import { AuthStore, safeReturnUrl } from '@/core/auth'
import { OfflineService } from '@/core/offline'
import { DeviceStorageService } from '@/core/pwa'
import { FORM_IMPORTS, SwitchField } from '@/shared/components/form'
import { PinSetup } from '@/shared/components/pin'

/** iPhone and iPad, including iPadOS that reports itself as a Mac. */
const isIos = (navigator: Navigator | undefined): boolean =>
  !!navigator &&
  (/iPhone|iPad|iPod/.test(navigator.userAgent) ||
    (navigator.userAgent.includes('Mac') && navigator.maxTouchPoints > 1))

/**
 * The trust step right after a sign-in on an untrusted device (offline-sync rule 1): use offline
 * on this device or not, then (if yes) choose the PIN.
 */
@Component({
  selector: 'app-trust-page',
  imports: [FORM_IMPORTS, TranslocoPipe, NgIcon, HlmButton, HlmSpinner, SwitchField, PinSetup],
  providers: [provideIcons({ lucideArrowLeft, lucideShieldCheck })],
  template: `
    @if (step() === 'choose') {
      <div class="flex flex-1 flex-col gap-6">
        <div class="flex flex-col gap-2">
          <h1 class="text-2xl font-semibold">{{ 'trust.heading' | transloco }}</h1>
          <p class="text-sm text-muted-foreground">{{ 'trust.intro' | transloco }}</p>
        </div>

        <form [formGroup]="form" class="flex flex-col gap-4" (ngSubmit)="next()">
          <div class="rounded-xl border border-border bg-card px-4 py-3 text-card-foreground">
            <app-switch-field
              [control]="form.controls.offline"
              [label]="'trust.switch' | transloco"
              [hint]="(offline() ? 'trust.onHint' : 'trust.offHint') | transloco"
            />
          </div>

          @if (offline() && showIosNote()) {
            <p class="rounded-xl bg-muted px-4 py-3 text-sm">{{ 'trust.iosNote' | transloco }}</p>
          }

          <button hlmBtn type="submit" class="mt-2 h-11 w-full text-base">
            {{ 'trust.continue' | transloco }}
          </button>
        </form>
      </div>
    } @else {
      <div class="flex flex-1 flex-col gap-4">
        <button
          hlmBtn
          variant="ghost"
          type="button"
          class="-ms-3 h-11 self-start"
          [disabled]="isProcessing()"
          (click)="step.set('choose')"
        >
          <ng-icon name="lucideArrowLeft" aria-hidden="true" />
          {{ 'trust.back' | transloco }}
        </button>
        <app-pin-setup [isProcessing]="isProcessing()" (chosen)="trust($event)" />
        <p role="status" class="flex min-h-5 items-center justify-center gap-2 text-sm">
          @if (isProcessing()) {
            <hlm-spinner [aria-label]="'trust.saving' | transloco" />
            <span class="text-muted-foreground">{{ 'trust.saving' | transloco }}</span>
          } @else if (failed()) {
            <span role="alert" class="text-destructive">{{ 'trust.failed' | transloco }}</span>
          }
        </p>
      </div>
    }
  `,
})
export class TrustPage {
  private nnfb = inject(NonNullableFormBuilder)
  private router = inject(Router)
  private authStore = inject(AuthStore)
  private offlineService = inject(OfflineService)
  private deviceStorageService = inject(DeviceStorageService)
  private navigator = inject(DOCUMENT).defaultView?.navigator
  private returnUrl = safeReturnUrl(inject(ActivatedRoute).snapshot.queryParamMap.get('returnUrl'))

  private pinSetup = viewChild(PinSetup)
  protected step = signal<'choose' | 'pin'>('choose')
  protected isProcessing = signal(false)
  protected failed = signal(false)

  // Rule 1: on by default in the installed app, off in a browser tab.
  form = this.nnfb.group({ offline: [this.deviceStorageService.isInstalled()] })
  protected offline = toSignal(this.form.controls.offline.valueChanges, {
    initialValue: this.form.controls.offline.value,
  })
  // Rule 5: on iOS only the home-screen app keeps its data.
  protected showIosNote = computed(
    () => isIos(this.navigator) && !this.deviceStorageService.isInstalled()
  )

  protected async next(): Promise<void> {
    if (this.form.controls.offline.value) {
      this.failed.set(false)
      this.step.set('pin')
      return
    }
    await this.done()
  }

  protected async trust(pin: string): Promise<void> {
    this.isProcessing.set(true)
    this.failed.set(false)
    try {
      await this.offlineService.enable(pin)
      await this.done()
    } catch (error) {
      console.error('Trusting this device failed', error)
      this.failed.set(true)
      this.pinSetup()?.reset()
    } finally {
      this.isProcessing.set(false)
    }
  }

  private async done(): Promise<void> {
    this.authStore.freshSignIn.set(false)
    await this.router.navigateByUrl(this.returnUrl, { replaceUrl: true })
  }
}
