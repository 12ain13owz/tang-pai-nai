import { Component, computed, inject, signal, viewChild } from '@angular/core'
import { ActivatedRoute, Router } from '@angular/router'
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

/** `on`: choose a PIN; `change`: the current one, then a new one; `off`: the current one. */
type PinMode = 'on' | 'change' | 'off'

/**
 * Account › Security › this device (offline-sync rules 2–4): the optional PIN of a trusted device.
 * Turn it on (choose one), change it, or turn it off (`?off=1`); the current PIN comes first and a
 * wrong one counts toward rule 3.
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
            <p class="text-sm text-muted-foreground">
              {{ (mode === 'off' ? 'pin.offHint' : 'pin.currentHint') | transloco }}
            </p>
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
      } @else if (mode !== 'off') {
        <app-pin-setup
          [isProcessing]="isProcessing()"
          [newHeading]="mode === 'change' ? 'pin.changeHeading' : 'pin.newHeading'"
          (chosen)="save($event)"
        />
      }

      <p role="status" class="flex min-h-5 items-center justify-center gap-2 text-sm">
        @if (isProcessing()) {
          <hlm-spinner [aria-label]="'pin.saving' | transloco" />
          <span class="text-muted-foreground">{{ 'pin.saving' | transloco }}</span>
        } @else if (failed()) {
          <span role="alert" class="text-destructive">{{ 'pin.failed' | transloco }}</span>
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
  private pad = viewChild(PinPad)
  private wantsOff = inject(ActivatedRoute).snapshot.queryParamMap.get('off') === '1'
  protected mode: PinMode = !this.offlineService.hasPin() ? 'on' : this.wantsOff ? 'off' : 'change'
  protected currentChecked = signal(false)
  protected needsCurrent = computed(() => this.mode !== 'on' && !this.currentChecked())
  protected isProcessing = signal(false)
  protected wrong = signal(false)
  protected failed = signal(false)
  protected showWarning = computed(
    () => (this.offlineService.meta()?.failedAttempts ?? 0) >= WARN_FROM_ATTEMPT
  )

  constructor() {
    // The PIN locks the local database; none here (browser storage refused, rule 1).
    if (!this.offlineService.isTrusted()) {
      void this.back()
    }
  }

  protected async save(pin: string): Promise<void> {
    this.isProcessing.set(true)
    this.failed.set(false)
    try {
      await this.offlineService.changePin(pin)
      toast.success(this.transloco.translate(this.mode === 'on' ? 'pin.turnedOn' : 'pin.changed'))
      await this.back()
    } catch (error) {
      console.error('Saving the PIN failed', error)
      this.failed.set(true)
      this.pinSetup()?.reset()
    } finally {
      this.isProcessing.set(false)
    }
  }

  /** The current PIN first (a wrong one counts toward rule 3's wipe); turning off ends there. */
  protected async checkCurrent(pin: string): Promise<void> {
    this.isProcessing.set(true)
    this.wrong.set(false)
    this.failed.set(false)
    try {
      const check = await this.offlineService.verifyPin(pin)
      if (check === 'wiped') {
        toast.error(this.transloco.translate('lock.wiped'))
        await this.router.navigateByUrl(SIGN_IN_URL, { replaceUrl: true })
      } else if (check === 'wrong') {
        this.wrong.set(true)
      } else if (this.mode === 'off') {
        await this.offlineService.removePin()
        toast.success(this.transloco.translate('pin.turnedOff'))
        await this.back()
      } else {
        this.currentChecked.set(true)
      }
    } catch (error) {
      console.error('Turning the PIN off failed', error)
      this.failed.set(true)
    } finally {
      this.isProcessing.set(false)
      this.pad()?.clear()
    }
  }

  protected async back(): Promise<void> {
    await this.router.navigateByUrl(SECURITY_URL)
  }
}
