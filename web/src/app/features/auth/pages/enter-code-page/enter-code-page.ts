import { Component, computed, DestroyRef, inject, signal } from '@angular/core'
import { takeUntilDestroyed } from '@angular/core/rxjs-interop'
import { NonNullableFormBuilder, Validators } from '@angular/forms'
import { Router } from '@angular/router'
import { TranslocoPipe } from '@jsverse/transloco'
import { NgIcon, provideIcons } from '@ng-icons/core'
import { lucideArrowLeft } from '@ng-icons/lucide'
import { HlmButton } from '@spartan-ng/helm/button'
import { HlmSpinner } from '@spartan-ng/helm/spinner'
import { toApiError } from '@/core/api'
import { AuthService, safeReturnUrl, authErrorMessage } from '@/core/auth'
import type { UiMessage } from '@/core/auth'
import { LanguageService } from '@/core/i18n'
import { AuthFlowStore } from '@/features/auth/auth-flow.store'
import type { CodeFormGroup } from '@/features/auth/auth-form.type'
import { FORM_IMPORTS, OtpField } from '@/shared/components/form'

const CODE_LENGTH = 6

@Component({
  selector: 'app-enter-code-page',
  imports: [FORM_IMPORTS, TranslocoPipe, NgIcon, OtpField, HlmButton, HlmSpinner],
  providers: [provideIcons({ lucideArrowLeft })],
  template: `
    <div class="flex flex-1 flex-col gap-6">
      <button hlmBtn variant="ghost" type="button" class="-ms-3 h-11 self-start" (click)="back()">
        <ng-icon name="lucideArrowLeft" aria-hidden="true" />
        {{ 'auth.changeEmail' | transloco }}
      </button>

      <div class="flex flex-col gap-2">
        <h1 class="text-2xl font-semibold">{{ 'auth.codeHeading' | transloco }}</h1>
        <p class="text-sm text-muted-foreground">
          {{ 'auth.codeSentTo' | transloco }}
          <span class="font-medium wrap-anywhere text-foreground">{{ email() }}</span>
        </p>
      </div>

      <form [formGroup]="form" class="flex flex-col gap-4" (ngSubmit)="onSubmit()">
        <app-otp-field [control]="form.controls.code" [label]="'auth.code' | transloco" />
        @if (error(); as message) {
          <p role="alert" class="text-center text-sm text-destructive">
            {{ message.key | transloco: message.params }}
          </p>
        }
        <button hlmBtn type="submit" class="h-11 w-full text-base" [disabled]="isProcessing()">
          @if (isProcessing()) {
            <hlm-spinner [aria-label]="'auth.signingIn' | transloco" />
          }
          {{ 'auth.signIn' | transloco }}
        </button>
      </form>

      <p class="text-center text-sm text-muted-foreground">{{ 'auth.linkHint' | transloco }}</p>

      <div class="mt-auto flex flex-col items-center gap-1">
        <button
          hlmBtn
          variant="ghost"
          type="button"
          class="h-11"
          [disabled]="secondsLeft() > 0 || isResending()"
          (click)="resend()"
        >
          @if (secondsLeft() > 0) {
            {{ 'auth.resendIn' | transloco: { seconds: secondsLeft() } }}
          } @else {
            {{ 'auth.resend' | transloco }}
          }
        </button>
        <p role="status" class="min-h-5 text-sm text-muted-foreground">
          @if (resent()) {
            {{ 'auth.resent' | transloco }}
          }
        </p>
      </div>
    </div>
  `,
})
export class EnterCodePage {
  private nnfb = inject(NonNullableFormBuilder)
  private router = inject(Router)
  private authService = inject(AuthService)
  private authFlowStore = inject(AuthFlowStore)
  private languageService = inject(LanguageService)

  protected email = computed(() => this.authFlowStore.pending().email)
  private now = signal(Date.now())
  protected secondsLeft = computed(() =>
    Math.max(0, Math.ceil((this.authFlowStore.pending().resendAt - this.now()) / 1000))
  )

  isProcessing = signal(false)
  protected isResending = signal(false)
  protected resent = signal(false)
  protected error = signal<UiMessage | null>(null)

  form: CodeFormGroup = this.nnfb.group({
    code: ['', [Validators.required, Validators.pattern(/^\d{6}$/)]],
  })

  constructor() {
    const timer = setInterval(() => this.now.set(Date.now()), 1000)
    inject(DestroyRef).onDestroy(() => clearInterval(timer))

    // The last digit (typed, pasted or auto-filled from the mail suggestion) submits. The form's
    // own valueChanges, not the control's: the form's validity is only updated after the control
    // emits.
    this.form.valueChanges.pipe(takeUntilDestroyed()).subscribe(({ code }) => {
      if (code?.length === CODE_LENGTH) {
        void this.onSubmit()
      }
    })
  }

  protected async onSubmit(): Promise<void> {
    if (this.form.invalid || this.isProcessing()) {
      return
    }
    this.isProcessing.set(true)
    this.error.set(null)
    this.resent.set(false)
    try {
      await this.authService.verifyCode(this.email(), this.form.getRawValue().code)
      const returnUrl = safeReturnUrl(this.authFlowStore.pending().returnUrl)
      this.authFlowStore.clear()
      await this.router.navigateByUrl(returnUrl, { replaceUrl: true })
    } catch (error) {
      this.error.set(authErrorMessage(toApiError(error), 'auth.verifyFailed'))
      this.form.controls.code.reset('', { emitEvent: false })
    } finally {
      this.isProcessing.set(false)
    }
  }

  protected async resend(): Promise<void> {
    this.isResending.set(true)
    this.error.set(null)
    this.resent.set(false)
    try {
      await this.authService.startEmail(this.email(), this.languageService.language().id)
      this.authFlowStore.resent()
      this.form.controls.code.reset('', { emitEvent: false })
      this.resent.set(true)
    } catch (error) {
      const apiError = toApiError(error)
      if (apiError.retryAfterSeconds) {
        this.authFlowStore.waitUntil(Date.now() + apiError.retryAfterSeconds * 1000)
      }
      this.error.set(authErrorMessage(apiError, 'auth.sendFailed'))
    } finally {
      this.isResending.set(false)
    }
  }

  protected async back(): Promise<void> {
    await this.router.navigate(['/auth/sign-in'], {
      queryParams: { returnUrl: this.authFlowStore.pending().returnUrl },
    })
  }
}
