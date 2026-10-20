import { Component, computed, DestroyRef, inject, signal } from '@angular/core'
import { takeUntilDestroyed } from '@angular/core/rxjs-interop'
import { NonNullableFormBuilder, Validators } from '@angular/forms'
import type { ValidatorFn } from '@angular/forms'
import { Router } from '@angular/router'
import { TranslocoPipe } from '@jsverse/transloco'
import { NgIcon, provideIcons } from '@ng-icons/core'
import { lucideArrowLeft } from '@ng-icons/lucide'
import { HlmButton } from '@spartan-ng/helm/button'
import { HlmSpinner } from '@spartan-ng/helm/spinner'
import { toApiError } from '@/core/api'
import {
  authErrorMessage,
  AuthService,
  AuthStore,
  formatThaiMobile,
  normalizeThaiMobile,
  thaiMobileValidator,
} from '@/core/auth'
import type { UiMessage } from '@/core/auth'
import { LanguageService } from '@/core/i18n'
import { NetworkStatusService } from '@/core/network'
import type { PhoneCodeFormGroup, PhoneNumberFormGroup } from '@/features/account/account-form.type'
import { ReauthStep } from '@/features/account/components/reauth-step'
import { ReauthFlow } from '@/features/account/reauth-flow'
import { FORM_IMPORTS, InputField, OtpField, withMessage } from '@/shared/components/form'

/** What waits for "confirm it's you" before it's sent again (auth spec rules 13 and 25). */
type PendingAction = { kind: 'send'; phone: string } | { kind: 'remove' }

const CODE_LENGTH = 6
const RESEND_COOLDOWN_MS = 60_000

/**
 * Add, change or remove the mobile number used for SMS sign-in (auth spec rule 25, 4.4b). A new
 * number gets an SMS code first and is saved only once that code is confirmed; the saved number
 * keeps working until then. Online only.
 */
@Component({
  selector: 'app-phone-page',
  imports: [
    FORM_IMPORTS,
    TranslocoPipe,
    NgIcon,
    InputField,
    OtpField,
    ReauthStep,
    HlmButton,
    HlmSpinner,
  ],
  providers: [provideIcons({ lucideArrowLeft }), ReauthFlow],
  template: `
    <div class="flex flex-col gap-6 p-4">
      <button hlmBtn variant="ghost" type="button" class="-ms-3 h-11 self-start" (click)="back()">
        <ng-icon name="lucideArrowLeft" aria-hidden="true" />
        {{ 'title.security' | transloco }}
      </button>

      <div class="flex flex-col gap-1">
        @if (savedPhone(); as phone) {
          <p class="text-sm text-muted-foreground">{{ 'phone.saved' | transloco }}</p>
          <p class="text-xl font-semibold tabular-nums">{{ phone }}</p>
        } @else {
          <p class="text-base font-medium">{{ 'phone.notAdded' | transloco }}</p>
        }
        <p class="text-sm text-muted-foreground">{{ 'phone.about' | transloco }}</p>
      </div>

      @if (!networkStatusService.isOnline()) {
        <p role="status" class="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {{ 'phone.offline' | transloco }}
        </p>
      } @else if (phoneEnabled() === false) {
        <p role="status" class="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {{ 'phone.unavailable' | transloco }}
        </p>
      }

      <p role="status" class="text-sm text-income empty:hidden">
        @if (done(); as key) {
          {{ key | transloco }}
        }
      </p>

      @if (reauth.pending(); as action) {
        <app-reauth-step
          [email]="email()"
          [hasPassword]="hasPassword()"
          [method]="reauth.method()"
          [codeSent]="reauth.codeSent()"
          [secondsLeft]="reauth.secondsLeft()"
          [isProcessing]="isProcessing() || reauth.isBusy()"
          [error]="reauth.error()"
          (passwordSubmitted)="run(action, $event)"
          (sendCode)="reauth.sendCode()"
          (codeSubmitted)="confirmWithCode(action, $event)"
          (methodChange)="reauth.switchMethod($event)"
          (cancelled)="reauth.close()"
        />
      } @else if (codeSentTo(); as phone) {
        <form [formGroup]="codeForm" class="flex flex-col gap-4" (ngSubmit)="confirm()">
          <p class="text-sm text-muted-foreground">
            {{ 'phone.codeSentTo' | transloco }}
            <span class="font-medium whitespace-nowrap text-foreground">{{ format(phone) }}</span>
          </p>
          <app-otp-field [control]="codeForm.controls.code" [label]="'auth.code' | transloco" />
          @if (error(); as message) {
            <p role="alert" class="-mt-2 text-center text-sm text-destructive">
              {{ message.key | transloco: message.params }}
            </p>
          }
          <button
            hlmBtn
            type="submit"
            class="h-11 w-full text-base"
            [disabled]="isProcessing() || !networkStatusService.isOnline()"
          >
            @if (isProcessing()) {
              <hlm-spinner [aria-label]="'account.confirming' | transloco" />
            }
            {{ 'phone.confirmNumber' | transloco }}
          </button>
          <p class="text-center text-sm text-muted-foreground">
            {{ 'phone.codeHint' | transloco }}
          </p>
        </form>
        <div class="flex flex-col items-center gap-1">
          <button
            hlmBtn
            variant="ghost"
            type="button"
            class="h-11"
            [disabled]="secondsLeft() > 0 || isProcessing() || !networkStatusService.isOnline()"
            (click)="run({ kind: 'send', phone })"
          >
            @if (secondsLeft() > 0) {
              {{ 'auth.resendIn' | transloco: { seconds: secondsLeft() } }}
            } @else {
              {{ 'auth.resend' | transloco }}
            }
          </button>
          <button
            hlmBtn
            variant="ghost"
            type="button"
            class="h-11"
            [disabled]="isProcessing()"
            (click)="useOtherNumber()"
          >
            {{ 'phone.useOtherNumber' | transloco }}
          </button>
        </div>
      } @else if (phoneEnabled()) {
        <form [formGroup]="numberForm" class="flex flex-col gap-4" (ngSubmit)="sendCode()">
          <app-input-field
            [control]="numberForm.controls.phone"
            [label]="(savedPhone() ? 'phone.changeNumber' : 'phone.newNumber') | transloco"
            type="tel"
            inputmode="tel"
            autocomplete="tel-national"
            placeholder="081-234-5678"
          />
          @if (error(); as message) {
            <p role="alert" class="-mt-2 text-sm text-destructive">
              {{ message.key | transloco: message.params }}
            </p>
          }
          <button
            hlmBtn
            type="submit"
            class="h-11 w-full text-base"
            [disabled]="isProcessing() || !networkStatusService.isOnline()"
          >
            @if (isProcessing()) {
              <hlm-spinner [aria-label]="'auth.sending' | transloco" />
            }
            {{ 'phone.sendCode' | transloco }}
          </button>
        </form>

        @if (savedPhone()) {
          <section class="flex flex-col gap-3 border-t border-border pt-6">
            @if (confirmingRemove()) {
              <p class="text-sm">{{ 'phone.removeConfirmText' | transloco }}</p>
              @if (removeError(); as message) {
                <p role="alert" class="text-sm text-destructive">
                  {{ message.key | transloco: message.params }}
                </p>
              }
              <button
                hlmBtn
                variant="destructive"
                type="button"
                class="h-11 w-full text-base"
                [disabled]="isProcessing() || !networkStatusService.isOnline()"
                (click)="run({ kind: 'remove' })"
              >
                @if (isProcessing()) {
                  <hlm-spinner [aria-label]="'account.removing' | transloco" />
                }
                {{ 'phone.removeConfirm' | transloco }}
              </button>
              <button
                hlmBtn
                variant="outline"
                type="button"
                class="h-11 w-full"
                [disabled]="isProcessing()"
                (click)="confirmingRemove.set(false)"
              >
                {{ 'account.cancel' | transloco }}
              </button>
            } @else {
              <button
                hlmBtn
                variant="outline"
                type="button"
                class="h-11 w-full text-destructive"
                [disabled]="isProcessing() || !networkStatusService.isOnline()"
                (click)="askRemove()"
              >
                {{ 'phone.remove' | transloco }}
              </button>
            }
          </section>
        }
      }
    </div>
  `,
})
export class PhonePage {
  private nnfb = inject(NonNullableFormBuilder)
  private router = inject(Router)
  private authService = inject(AuthService)
  private authStore = inject(AuthStore)
  private languageService = inject(LanguageService)
  protected networkStatusService = inject(NetworkStatusService)
  protected reauth = inject(ReauthFlow<PendingAction>)

  protected email = computed(() => this.authStore.user()?.email ?? '')
  protected hasPassword = computed(() => this.authStore.user()?.hasPassword ?? false)
  private phone = computed(() => this.authStore.user()?.phone ?? null)
  protected savedPhone = computed(() => {
    const phone = this.phone()
    return phone ? formatThaiMobile(phone) : null
  })
  /** `null` until the API has answered; adding a number needs SMS (rule 21). */
  protected phoneEnabled = signal<boolean | null>(null)

  isProcessing = signal(false)
  protected error = signal<UiMessage | null>(null)
  protected removeError = signal<UiMessage | null>(null)
  protected done = signal<string | null>(null)
  protected confirmingRemove = signal(false)
  /** The number (E.164) the last code went to; the code step shows while it's set. */
  protected codeSentTo = signal<string | null>(null)

  private resendAt = signal(0)
  private now = signal(Date.now())
  protected secondsLeft = computed(() =>
    Math.max(0, Math.ceil((this.resendAt() - this.now()) / 1000))
  )

  /** Typing the saved number again would only cost an SMS (rule 25). */
  private notSavedNumber: ValidatorFn = (control) => {
    const value: unknown = control.value
    const phone = typeof value === 'string' ? normalizeThaiMobile(value) : null
    return phone && phone === this.phone() ? { unchanged: 'phone.unchanged' } : null
  }

  numberForm: PhoneNumberFormGroup = this.nnfb.group({
    phone: [
      '',
      [
        withMessage(Validators.required, 'auth.phoneRequired'),
        thaiMobileValidator,
        this.notSavedNumber,
      ],
    ],
  })

  codeForm: PhoneCodeFormGroup = this.nnfb.group({
    code: ['', [Validators.required, Validators.pattern(/^\d{6}$/)]],
  })

  constructor() {
    const timer = setInterval(() => this.now.set(Date.now()), 1000)
    inject(DestroyRef).onDestroy(() => clearInterval(timer))

    // A server error describes the last submit; editing the form leaves only field messages.
    this.numberForm.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => this.error.set(null))
    // The last digit (typed, pasted or auto-filled from the SMS) submits.
    this.codeForm.valueChanges.pipe(takeUntilDestroyed()).subscribe(({ code }) => {
      this.error.set(null)
      if (code?.length === CODE_LENGTH) {
        void this.confirm()
      }
    })

    // Fresh profile (the number may have changed on another device); offline, memory stays.
    this.authService.loadMe().catch(() => undefined)
    void this.authService.providers().then((providers) => {
      this.phoneEnabled.set(providers.phone)
    })
  }

  protected format(phone: string): string {
    return formatThaiMobile(phone)
  }

  protected async sendCode(): Promise<void> {
    const phone = normalizeThaiMobile(this.numberForm.getRawValue().phone)
    if (this.numberForm.invalid || !phone || this.isProcessing()) {
      return
    }
    // Shown the Thai way, whatever was typed.
    this.numberForm.controls.phone.setValue(formatThaiMobile(phone), { emitEvent: false })
    await this.run({ kind: 'send', phone })
  }

  protected askRemove(): void {
    this.done.set(null)
    this.removeError.set(null)
    this.confirmingRemove.set(true)
  }

  protected async confirmWithCode(action: PendingAction, code: string): Promise<void> {
    if (await this.reauth.verifyCode(code)) {
      await this.run(action)
    }
  }

  protected useOtherNumber(): void {
    this.codeSentTo.set(null)
    this.error.set(null)
    this.codeForm.reset({ code: '' }, { emitEvent: false })
  }

  /** The SMS code saves the number (no recent auth: the code was sent only after it). */
  protected async confirm(): Promise<void> {
    if (this.codeForm.invalid || this.isProcessing()) {
      return
    }
    const hadPhone = this.phone() !== null
    this.isProcessing.set(true)
    this.error.set(null)
    try {
      await this.authService.confirmPhone(
        this.codeForm.getRawValue().code,
        this.languageService.language().id
      )
      this.codeSentTo.set(null)
      this.numberForm.reset({ phone: '' })
      this.done.set(hadPhone ? 'phone.changed' : 'phone.added')
    } catch (error) {
      const apiError = toApiError(error)
      this.error.set(authErrorMessage(apiError, 'phone.saveFailed'))
      // The code is used up (or the number taken): start again from the number.
      if (apiError.code === 'PHONE_IN_USE') {
        this.codeSentTo.set(null)
      }
    } finally {
      this.codeForm.reset({ code: '' }, { emitEvent: false })
      this.isProcessing.set(false)
    }
  }

  /** Sends the action; on `REAUTH_REQUIRED` keeps it pending until the user confirms. */
  protected async run(action: PendingAction, currentPassword?: string): Promise<void> {
    this.isProcessing.set(true)
    this.error.set(null)
    this.removeError.set(null)
    this.reauth.clearError()
    this.done.set(null)
    try {
      if (action.kind === 'send') {
        await this.authService.changePhone(action.phone, currentPassword)
        // The last code input may have marked the control touched as it left the page.
        this.codeForm.reset({ code: '' }, { emitEvent: false })
        this.codeSentTo.set(action.phone)
        this.now.set(Date.now())
        this.resendAt.set(this.now() + RESEND_COOLDOWN_MS)
      } else {
        await this.authService.removePhone(this.languageService.language().id, currentPassword)
        this.confirmingRemove.set(false)
        this.done.set('phone.removed')
      }
      this.reauth.close()
    } catch (error) {
      const apiError = toApiError(error)
      if (apiError.retryAfterSeconds) {
        this.resendAt.set(Date.now() + apiError.retryAfterSeconds * 1000)
      }
      if (!this.reauth.refused(action, apiError, this.hasPassword())) {
        const message = authErrorMessage(
          apiError,
          action.kind === 'send' ? 'auth.sendFailed' : 'phone.saveFailed'
        )
        if (action.kind === 'remove') {
          this.removeError.set(message)
        } else {
          this.error.set(message)
        }
      }
    } finally {
      this.isProcessing.set(false)
    }
  }

  protected async back(): Promise<void> {
    await this.router.navigate(['/account/security'])
  }
}
