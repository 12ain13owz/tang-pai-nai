import { Component, inject, signal } from '@angular/core'
import { takeUntilDestroyed } from '@angular/core/rxjs-interop'
import { NonNullableFormBuilder, Validators } from '@angular/forms'
import { ActivatedRoute, Router } from '@angular/router'
import { TranslocoPipe } from '@jsverse/transloco'
import { NgIcon, provideIcons } from '@ng-icons/core'
import { lucideArrowLeft } from '@ng-icons/lucide'
import { HlmButton } from '@spartan-ng/helm/button'
import { HlmSpinner } from '@spartan-ng/helm/spinner'
import { toApiError } from '@/core/api'
import { authErrorMessage, AuthService, safeReturnUrl } from '@/core/auth'
import type { UiMessage } from '@/core/auth'
import { NetworkStatusService } from '@/core/network'
import { AuthFlowStore } from '@/features/auth/auth-flow.store'
import type { PasswordSignInFormGroup } from '@/features/auth/auth-form.type'
import { FORM_IMPORTS, InputField, PasswordField, withMessage } from '@/shared/components/form'

/** Email + password (auth spec rule 12), for users who set a password. */
@Component({
  selector: 'app-password-sign-in-page',
  imports: [FORM_IMPORTS, TranslocoPipe, NgIcon, InputField, PasswordField, HlmButton, HlmSpinner],
  providers: [provideIcons({ lucideArrowLeft })],
  template: `
    <div class="flex flex-1 flex-col gap-6">
      <button hlmBtn variant="ghost" type="button" class="-ms-3 h-11 self-start" (click)="back()">
        <ng-icon name="lucideArrowLeft" aria-hidden="true" />
        {{ 'auth.useEmailCode' | transloco }}
      </button>

      <div class="flex flex-col gap-2">
        <h1 class="text-2xl font-semibold">{{ 'auth.passwordHeading' | transloco }}</h1>
        <p class="text-sm text-muted-foreground">{{ 'auth.passwordText' | transloco }}</p>
      </div>

      @if (!networkStatusService.isOnline()) {
        <p role="status" class="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {{ 'auth.offline' | transloco }}
        </p>
      }

      <form [formGroup]="form" class="flex flex-col gap-4" (ngSubmit)="onSubmit()">
        <app-input-field
          [control]="form.controls.email"
          [label]="'auth.email' | transloco"
          type="email"
          inputmode="email"
          autocomplete="username"
          placeholder="name@example.com"
        />
        <app-password-field
          [control]="form.controls.password"
          [label]="'auth.password' | transloco"
          autocomplete="current-password"
        />
        @if (error(); as message) {
          <p role="alert" class="text-sm text-destructive">
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
            <hlm-spinner [aria-label]="'auth.signingIn' | transloco" />
          }
          {{ 'auth.signIn' | transloco }}
        </button>
      </form>

      <p class="text-center text-sm text-muted-foreground">
        {{ 'auth.forgotPasswordHint' | transloco }}
      </p>
    </div>
  `,
})
export class PasswordSignInPage {
  private nnfb = inject(NonNullableFormBuilder)
  private router = inject(Router)
  private route = inject(ActivatedRoute)
  private authService = inject(AuthService)
  private authFlowStore = inject(AuthFlowStore)
  protected networkStatusService = inject(NetworkStatusService)

  private returnUrl = safeReturnUrl(this.route.snapshot.queryParamMap.get('returnUrl'))

  isProcessing = signal(false)
  protected error = signal<UiMessage | null>(null)

  form: PasswordSignInFormGroup = this.nnfb.group({
    email: [
      this.route.snapshot.queryParamMap.get('email') ?? this.authFlowStore.pending().email,
      [withMessage(Validators.required, 'auth.emailRequired'), Validators.email],
    ],
    // Only "not empty" here: the policy applies when a password is set, not at sign-in.
    password: ['', withMessage(Validators.required, 'auth.passwordRequired')],
  })

  constructor() {
    // A server error describes the last submit; editing the form leaves only field messages.
    this.form.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => this.error.set(null))
  }

  protected async onSubmit(): Promise<void> {
    if (this.form.invalid || this.isProcessing()) {
      return
    }
    const { email, password } = this.form.getRawValue()
    this.isProcessing.set(true)
    this.error.set(null)
    try {
      await this.authService.signInWithPassword(email.trim().toLowerCase(), password)
      this.authFlowStore.clear()
      await this.router.navigateByUrl(this.returnUrl, { replaceUrl: true })
    } catch (error) {
      // The field keeps what was typed, so only the server's message shows (not "required" too).
      this.error.set(authErrorMessage(toApiError(error), 'auth.verifyFailed'))
    } finally {
      this.isProcessing.set(false)
    }
  }

  protected async back(): Promise<void> {
    await this.router.navigate(['/auth/sign-in'], { queryParams: { returnUrl: this.returnUrl } })
  }
}
