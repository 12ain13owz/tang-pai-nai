import { Component, computed, inject, signal, viewChild } from '@angular/core'
import { Router } from '@angular/router'
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco'
import { NgIcon, provideIcons } from '@ng-icons/core'
import { lucideArrowLeft } from '@ng-icons/lucide'
import { toast } from '@spartan-ng/brain/sonner'
import { HlmButton } from '@spartan-ng/helm/button'
import { HlmSpinner } from '@spartan-ng/helm/spinner'
import { SIGN_IN_URL } from '@/core/auth'
import { OfflineService, WARN_FROM_ATTEMPT } from '@/core/offline'
import { PinPad, PinSetup } from '@/shared/components/pin'

const SECURITY_URL = '/account/security'

/**
 * Account › Security › this device (offline-sync rules 1 and 4): turn offline on (choose a PIN)
 * or change the PIN (the current one first; a wrong one counts toward rule 3).
 */
@Component({
  selector: 'app-pin-page',
  imports: [TranslocoPipe, NgIcon, HlmButton, HlmSpinner, PinPad, PinSetup],
  providers: [provideIcons({ lucideArrowLeft })],
  template: `
    <div class="flex flex-col gap-4 p-4">
      <button
        hlmBtn
        variant="ghost"
        type="button"
        class="-ms-3 h-11 self-start"
        [disabled]="isProcessing()"
        (click)="back()"
      >
        <ng-icon name="lucideArrowLeft" aria-hidden="true" />
        {{ 'title.security' | transloco }}
      </button>

      @if (needsCurrent()) {
        <div class="flex flex-col items-center gap-6">
          <div class="flex flex-col items-center gap-2 text-center">
            <h2 class="text-xl font-semibold">{{ 'pin.currentHeading' | transloco }}</h2>
            <p class="text-sm text-muted-foreground">{{ 'pin.currentHint' | transloco }}</p>
          </div>
          <div role="alert" class="flex min-h-5 flex-col items-center text-center text-sm">
            @if (wrong()) {
              <p class="text-destructive">{{ 'lock.wrong' | transloco }}</p>
            }
            @if (showWarning()) {
              <p class="text-destructive">
                {{ 'lock.warning' | transloco: { count: offlineService.attemptsLeft() } }}
              </p>
            }
          </div>
          <app-pin-pad
            #pad
            [filledLabel]="'pin.filled' | transloco: { count: pad.length() }"
            [deleteLabel]="'pin.delete' | transloco"
            [disabled]="isProcessing()"
            (completed)="checkCurrent($event)"
          />
        </div>
      } @else {
        <app-pin-setup
          [isProcessing]="isProcessing()"
          [newHeading]="isChange ? 'pin.changeHeading' : 'pin.newHeading'"
          (chosen)="save($event)"
        />
      }

      <p role="status" class="flex min-h-5 items-center justify-center gap-2 text-sm">
        @if (isProcessing()) {
          <hlm-spinner [aria-label]="'trust.saving' | transloco" />
          <span class="text-muted-foreground">{{ 'trust.saving' | transloco }}</span>
        } @else if (failed()) {
          <span role="alert" class="text-destructive">{{ 'trust.failed' | transloco }}</span>
        }
      </p>
    </div>
  `,
})
export class PinPage {
  private router = inject(Router)
  private transloco = inject(TranslocoService)
  protected offlineService = inject(OfflineService)

  private pinSetup = viewChild(PinSetup)
  /** Trusted already: this changes the PIN; otherwise it turns offline on. */
  protected isChange = this.offlineService.isTrusted()
  private pad = viewChild(PinPad)
  protected currentChecked = signal(false)
  protected needsCurrent = computed(() => this.isChange && !this.currentChecked())
  protected isProcessing = signal(false)
  protected wrong = signal(false)
  protected failed = signal(false)
  protected showWarning = computed(
    () => (this.offlineService.meta()?.failedAttempts ?? 0) >= WARN_FROM_ATTEMPT
  )

  protected async save(pin: string): Promise<void> {
    this.isProcessing.set(true)
    this.failed.set(false)
    try {
      if (!this.isChange) {
        await this.offlineService.enable(pin)
        toast.success(this.transloco.translate('pin.offlineOn'))
        await this.router.navigateByUrl(SECURITY_URL)
        return
      }
      await this.offlineService.changePin(pin)
      toast.success(this.transloco.translate('pin.changed'))
      await this.router.navigateByUrl(SECURITY_URL)
    } catch (error) {
      console.error('Saving the PIN failed', error)
      this.failed.set(true)
      this.pinSetup()?.reset()
    } finally {
      this.isProcessing.set(false)
    }
  }

  /** The current PIN first (a wrong one counts toward rule 3's wipe). */
  protected async checkCurrent(pin: string): Promise<void> {
    this.isProcessing.set(true)
    this.wrong.set(false)
    try {
      const check = await this.offlineService.verifyPin(pin)
      if (check === 'ok') {
        this.currentChecked.set(true)
      } else if (check === 'wiped') {
        toast.error(this.transloco.translate('lock.wiped'))
        await this.router.navigateByUrl(SIGN_IN_URL, { replaceUrl: true })
      } else {
        this.wrong.set(true)
      }
    } finally {
      this.isProcessing.set(false)
      this.pad()?.clear()
    }
  }

  protected async back(): Promise<void> {
    await this.router.navigateByUrl(SECURITY_URL)
  }
}
