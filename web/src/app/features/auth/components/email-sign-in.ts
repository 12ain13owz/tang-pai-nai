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
import { LanguageService } from '@/core/i18n'
import { NetworkStatusService } from '@/core/network'
import { AuthFlowStore } from '@/features/auth/auth-flow.store'
import type { EmailFormGroup } from '@/features/auth/auth-form.type'
import { FORM_IMPORTS, InputField, withMessage } from '@/shared/components/form'

/** The sign-in page's email tab: a code and a link by mail (a new email gets an account). */
@Component({
  selector: 'app-email-sign-in',
  imports: [FORM_IMPORTS, TranslocoPipe, InputField, HlmButton, HlmSpinner],
  template: `
    <form [formGroup]="form" class="flex flex-col gap-4" (ngSubmit)="onSubmit()">
      <app-input-field
        [control]="form.controls.email"
        [label]="'auth.email' | transloco"
        type="email"
        inputmode="email"
        autocomplete="email"
        placeholder="name@example.com"
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
        {{ 'auth.sendCode' | transloco }}
      </button>
    </form>
  `,
})
export class EmailSignIn implements OnInit {
  private nnfb = inject(NonNullableFormBuilder)
  private router = inject(Router)
  private authService = inject(AuthService)
  private authFlowStore = inject(AuthFlowStore)
  private languageService = inject(LanguageService)
  protected networkStatusService = inject(NetworkStatusService)

  returnUrl = input.required<string>()
  /** Shared with the password tab, so the address needn't be typed twice. */
  email = model.required<string>()

  isProcessing = signal(false)
  protected error = signal<UiMessage | null>(null)

  form: EmailFormGroup = this.nnfb.group({
    email: ['', [withMessage(Validators.required, 'auth.emailRequired'), Validators.email]],
  })

  constructor() {
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
    const email = this.form.getRawValue().email.trim().toLowerCase()
    this.isProcessing.set(true)
    this.error.set(null)
    try {
      await this.authService.startEmail(email, this.languageService.language().id)
      this.authFlowStore.start(email, this.returnUrl())
      await this.router.navigate(['/auth/code'])
    } catch (error) {
      const apiError = toApiError(error)
      // Already sent within the last minute: the code on its way is still good.
      if (apiError.status === 429 && this.authFlowStore.pending().email === email) {
        await this.router.navigate(['/auth/code'])
        return
      }
      this.error.set(authErrorMessage(apiError, 'auth.sendFailed'))
    } finally {
      this.isProcessing.set(false)
    }
  }
}
