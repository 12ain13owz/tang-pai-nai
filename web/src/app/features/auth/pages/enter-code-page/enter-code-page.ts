import { Component, computed, DestroyRef, inject, signal } from '@angular/core'
import { takeUntilDestroyed } from '@angular/core/rxjs-interop'
import { NonNullableFormBuilder, Validators } from '@angular/forms'
import { Router } from '@angular/router'
import { TranslocoPipe } from '@jsverse/transloco'
import { NgIcon, provideIcons } from '@ng-icons/core'
import { lucideArrowLeft, lucideMail } from '@ng-icons/lucide'
import { HlmButton } from '@spartan-ng/helm/button'
import { HlmSpinner } from '@spartan-ng/helm/spinner'
import { toApiError } from '@/core/api'
import { AuthService, formatThaiMobile, safeReturnUrl, authErrorMessage } from '@/core/auth'
import type { UiMessage } from '@/core/auth'
import { LanguageService } from '@/core/i18n'
import { AuthFlowStore } from '@/features/auth/auth-flow.store'
import type { CodeFormGroup } from '@/features/auth/auth-form.type'
import { FORM_IMPORTS, OtpField, withMessage } from '@/shared/components/form'

const CODE_LENGTH = 6

@Component({
  selector: 'app-enter-code-page',
  imports: [FORM_IMPORTS, TranslocoPipe, NgIcon, OtpField, HlmButton, HlmSpinner],
  providers: [provideIcons({ lucideArrowLeft, lucideMail })],
  template: `
    <div class="flex flex-1 flex-col gap-6">
      <button hlmBtn variant="ghost" type="button" class="-ms-3 h-11 self-start" (click)="back()">
        <ng-icon name="lucideArrowLeft" aria-hidden="true" />
        {{ (phone() ? 'auth.changePhone' : 'auth.changeEmail') | transloco }}
      </button>

      <!-- The heading is for screen readers only: the line below and the six slots say it all. -->
      <h1 class="sr-only">
        {{ (phone() ? 'auth.smsCodeHeading' : 'auth.codeHeading') | transloco }}
      </h1>
      <p class="text-center text-base text-muted-foreground">
        {{ (phone() ? 'auth.smsCodeSentTo' : 'auth.codeSentTo') | transloco }}
        <span class="font-medium wrap-anywhere whitespace-nowrap text-foreground">
          {{ phone() ? formattedPhone() : email() }}
        </span>
      </p>

      <form [formGroup]="form" class="flex flex-col gap-4" (ngSubmit)="onSubmit()">
        <app-otp-field
          [control]="form.controls.code"
          [label]="'auth.code' | transloco"
          [hideLabel]="true"
        />
        @if (error(); as message) {
          <p role="alert" class="-mt-2 text-center text-sm text-destructive">
            {{ message.key | transloco: message.params }}
          </p>
        }
        <!-- As wide as the six 48px slots above it (w-72), so the two line up. -->
        <button
          hlmBtn
          type="submit"
          class="h-11 w-72 self-center text-base"
          [disabled]="isProcessing()"
        >
          @if (isProcessing()) {
            <hlm-spinner [aria-label]="'auth.signingIn' | transloco" />
          }
          {{ 'auth.signIn' | transloco }}
        </button>
      </form>

      @if (phone()) {
        <!-- The API answers every number the same (rule 22), so this names the rule, never the
             number: someone whose number isn't on an account learns what to do instead. -->
        <div class="flex flex-col gap-3 rounded-xl bg-muted px-4 py-3">
          <p class="text-sm text-muted-foreground">{{ 'auth.smsHint' | transloco }}</p>
          <button
            hlmBtn
            variant="outline"
            type="button"
            class="h-11 w-full text-base"
            (click)="useEmail()"
          >
            <ng-icon name="lucideMail" aria-hidden="true" />
            {{ 'auth.useEmailInstead' | transloco }}
          </button>
        </div>
      }

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
            {{ (phone() ? 'auth.smsResent' : 'auth.resent') | transloco }}
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
  /** Set when the code went by SMS (4.4b) instead of email. */
  protected phone = computed(() => this.authFlowStore.pending().phone)
  protected formattedPhone = computed(() => formatThaiMobile(this.phone()))
  private now = signal(Date.now())
  protected secondsLeft = computed(() =>
    Math.max(0, Math.ceil((this.authFlowStore.pending().resendAt - this.now()) / 1000))
  )

  isProcessing = signal(false)
  protected isResending = signal(false)
  protected resent = signal(false)
  protected error = signal<UiMessage | null>(null)

  // One message for an empty and an unfinished code alike.
  form: CodeFormGroup = this.nnfb.group({
    code: [
      '',
      [
        withMessage(Validators.required, 'auth.codeIncomplete'),
        withMessage(Validators.pattern(/^\d{6}$/), 'auth.codeIncomplete'),
      ],
    ],
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
      const { code } = this.form.getRawValue()
      if (this.phone()) {
        await this.authService.verifyPhone(this.phone(), code)
      } else {
        await this.authService.verifyCode(this.email(), code)
      }
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
      if (this.phone()) {
        await this.authService.startPhone(this.phone())
      } else {
        await this.authService.startEmail(this.email(), this.languageService.language().id)
      }
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

  /** The sign-in page's email tab, keeping where the user was headed. */
  protected async useEmail(): Promise<void> {
    const { returnUrl } = this.authFlowStore.pending()
    await this.router.navigate(['/auth/sign-in'], {
      queryParams: { returnUrl: returnUrl === '/' ? null : returnUrl },
    })
  }

  protected async back(): Promise<void> {
    const { returnUrl } = this.authFlowStore.pending()
    await this.router.navigate(['/auth/sign-in'], {
      queryParams: {
        returnUrl: returnUrl === '/' ? null : returnUrl,
        with: this.phone() ? 'phone' : null,
      },
    })
  }
}
