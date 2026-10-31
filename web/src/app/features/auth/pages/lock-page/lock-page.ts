import { Component, computed, inject, signal, viewChild } from '@angular/core'
import { ActivatedRoute, Router } from '@angular/router'
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco'
import { NgIcon, provideIcons } from '@ng-icons/core'
import { lucideLock } from '@ng-icons/lucide'
import { toast } from '@spartan-ng/brain/sonner'
import { HlmButton } from '@spartan-ng/helm/button'
import { HlmSpinner } from '@spartan-ng/helm/spinner'
import { AuthService, safeReturnUrl, SIGN_IN_URL } from '@/core/auth'
import { OfflineService, WARN_FROM_ATTEMPT } from '@/core/offline'
import { PinPad } from '@/shared/components/pin'

/**
 * The lock screen of a trusted device (offline-sync rules 2–3): the PIN pad, the warning from the
 * 3rd wrong PIN, and signing out (which wipes this device) for a forgotten PIN.
 */
@Component({
  selector: 'app-lock-page',
  imports: [TranslocoPipe, NgIcon, HlmButton, HlmSpinner, PinPad],
  providers: [provideIcons({ lucideLock })],
  template: `
    <div class="flex flex-1 flex-col items-center gap-6">
      <div class="flex flex-col items-center gap-3 pt-4 text-center">
        <span
          class="flex size-14 items-center justify-center rounded-full bg-muted text-2xl text-muted-foreground"
          aria-hidden="true"
        >
          <ng-icon name="lucideLock" />
        </span>
        <h1 class="text-2xl font-semibold">{{ 'lock.heading' | transloco }}</h1>
        @if (name(); as name) {
          <p class="text-sm text-muted-foreground">
            {{ 'lock.hello' | transloco: { name } }}
          </p>
        }
      </div>

      <div class="flex min-h-10 flex-col items-center justify-center text-center text-sm">
        @if (isProcessing()) {
          <p role="status" class="flex items-center gap-2 text-muted-foreground">
            <hlm-spinner [aria-label]="'lock.unlocking' | transloco" />
            {{ 'lock.unlocking' | transloco }}
          </p>
        } @else {
          <div role="alert" class="flex flex-col items-center">
            @if (wrong()) {
              <p class="text-destructive">{{ 'lock.wrong' | transloco }}</p>
            }
            @if (showWarning()) {
              <p class="text-destructive">
                {{ 'lock.warning' | transloco: { count: offlineService.attemptsLeft() } }}
              </p>
            }
          </div>
        }
      </div>

      <app-pin-pad
        #pad
        [filledLabel]="'pin.filled' | transloco: { count: pad.length() }"
        [deleteLabel]="'pin.delete' | transloco"
        [disabled]="isProcessing() || confirmingSignOut()"
        (completed)="unlock($event)"
      />

      <div class="mt-auto flex w-full flex-col gap-3">
        @if (confirmingSignOut()) {
          <div
            class="flex flex-col gap-3 rounded-xl border border-border bg-card p-4 text-card-foreground"
          >
            <p class="text-sm">{{ 'lock.signOutConfirmText' | transloco }}</p>
            <button
              hlmBtn
              variant="destructive"
              type="button"
              class="h-11 w-full text-base"
              [disabled]="isSigningOut()"
              (click)="signOut()"
            >
              @if (isSigningOut()) {
                <hlm-spinner [aria-label]="'account.signingOut' | transloco" />
              }
              {{ 'lock.signOut' | transloco }}
            </button>
            <button
              hlmBtn
              variant="outline"
              type="button"
              class="h-11 w-full"
              [disabled]="isSigningOut()"
              (click)="confirmingSignOut.set(false)"
            >
              {{ 'account.cancel' | transloco }}
            </button>
          </div>
        } @else {
          <button
            hlmBtn
            variant="ghost"
            type="button"
            class="h-11 self-center"
            [disabled]="isProcessing()"
            (click)="confirmingSignOut.set(true)"
          >
            {{ 'lock.forgot' | transloco }}
          </button>
        }
      </div>
    </div>
  `,
})
export class LockPage {
  private router = inject(Router)
  private transloco = inject(TranslocoService)
  private authService = inject(AuthService)
  protected offlineService = inject(OfflineService)
  private returnUrl = safeReturnUrl(inject(ActivatedRoute).snapshot.queryParamMap.get('returnUrl'))

  private pad = viewChild.required(PinPad)
  protected name = computed(() => this.offlineService.meta()?.displayName ?? null)
  protected isProcessing = signal(false)
  protected wrong = signal(false)
  protected confirmingSignOut = signal(false)
  protected isSigningOut = signal(false)
  /** Rule 3: from the 3rd wrong PIN in a row, also after a reload. */
  protected showWarning = computed(
    () => (this.offlineService.meta()?.failedAttempts ?? 0) >= WARN_FROM_ATTEMPT
  )

  protected async unlock(pin: string): Promise<void> {
    this.isProcessing.set(true)
    this.wrong.set(false)
    try {
      const check = await this.offlineService.unlock(pin)
      if (check === 'ok') {
        await this.router.navigateByUrl(this.returnUrl, { replaceUrl: true })
        return
      }
      if (check === 'wiped') {
        toast.error(this.transloco.translate('lock.wiped'))
        await this.router.navigateByUrl(SIGN_IN_URL, { replaceUrl: true })
        return
      }
      this.wrong.set(true)
    } catch (error) {
      console.error('Unlocking failed', error)
      this.wrong.set(true)
    } finally {
      this.isProcessing.set(false)
      this.pad().clear()
    }
  }

  /** A forgotten PIN: this device forgets everything and signs out (rules 3 and 7). */
  protected async signOut(): Promise<void> {
    this.isSigningOut.set(true)
    try {
      await this.offlineService.wipe()
      await this.authService.signOutOrLater().catch(() => undefined)
      await this.router.navigateByUrl(SIGN_IN_URL, { replaceUrl: true })
    } finally {
      this.isSigningOut.set(false)
    }
  }
}
