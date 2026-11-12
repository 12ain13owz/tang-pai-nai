import { Component, inject, input, model, signal } from '@angular/core'
import type { OnInit } from '@angular/core'
import { takeUntilDestroyed } from '@angular/core/rxjs-interop'
import { NonNullableFormBuilder, Validators } from '@angular/forms'
import { Router } from '@angular/router'
import { TranslocoPipe } from '@jsverse/transloco'
import { HlmButton } from '@spartan-ng/helm/button'
import { HlmSpinner } from '@spartan-ng/helm/spinner'
import { toApiError } from '@/core/api'
import { authErrorMessage, AuthService } from '@/core/auth'
import type { UiMessage } from '@/core/auth'
import { NetworkStatusService } from '@/core/network'
import { AuthFlowStore } from '@/features/auth/auth-flow.store'
import type { PasswordSignInFormGroup } from '@/features/auth/auth-form.type'
import { FORM_IMPORTS, InputField, PasswordField, withMessage } from '@/shared/components/form'

/** The sign-in page's password tab (auth spec rule 12), for users who set a password. */
@Component({
  selector: 'app-password-sign-in',
  imports: [FORM_IMPORTS, TranslocoPipe, InputField, PasswordField, HlmButton, HlmSpinner],
  template: `
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
          <hlm-spinner [aria-label]="'auth.signingIn' | transloco" />
        }
        {{ 'auth.signIn' | transloco }}
      </button>
    </form>
  `,
})
export class PasswordSignIn implements OnInit {
  private nnfb = inject(NonNullableFormBuilder)
  private router = inject(Router)
  private authService = inject(AuthService)
  private authFlowStore = inject(AuthFlowStore)
  protected networkStatusService = inject(NetworkStatusService)

  returnUrl = input.required<string>()
  /** Shared with the email tab, so the address needn't be typed twice. */
  email = model.required<string>()

  isProcessing = signal(false)
  protected error = signal<UiMessage | null>(null)

  form: PasswordSignInFormGroup = this.nnfb.group({
    email: ['', [withMessage(Validators.required, 'auth.emailRequired'), Validators.email]],
    // Only "not empty" here: the policy applies when a password is set, not at sign-in.
    password: ['', withMessage(Validators.required, 'auth.passwordRequired')],
  })

  constructor() {
    // A server error describes the last submit; editing the form leaves only field messages.
    this.form.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => this.error.set(null))
    this.form.controls.email.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe((value) => this.email.set(value))
  }

  ngOnInit(): void {
    this.form.controls.email.setValue(this.email(), { emitEvent: false })
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
      await this.router.navigateByUrl(this.returnUrl(), { replaceUrl: true })
    } catch (error) {
      // The field keeps what was typed, so only the server's message shows (not "required" too).
      this.error.set(authErrorMessage(toApiError(error), 'auth.verifyFailed'))
    } finally {
      this.isProcessing.set(false)
    }
  }
}
