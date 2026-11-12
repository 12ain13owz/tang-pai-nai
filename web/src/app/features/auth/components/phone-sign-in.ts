import { Component, inject, input, signal } from '@angular/core'
import { takeUntilDestroyed } from '@angular/core/rxjs-interop'
import { NonNullableFormBuilder, Validators } from '@angular/forms'
import { Router } from '@angular/router'
import { TranslocoPipe } from '@jsverse/transloco'
import { HlmButton } from '@spartan-ng/helm/button'
import { HlmSpinner } from '@spartan-ng/helm/spinner'
import { toApiError } from '@/core/api'
import {
  authErrorMessage,
  AuthService,
  formatThaiMobile,
  normalizeThaiMobile,
  thaiMobileValidator,
} from '@/core/auth'
import type { UiMessage } from '@/core/auth'
import { NetworkStatusService } from '@/core/network'
import { AuthFlowStore } from '@/features/auth/auth-flow.store'
import type { PhoneFormGroup } from '@/features/auth/auth-form.type'
import { FORM_IMPORTS, InputField, withMessage } from '@/shared/components/form'

/**
 * The sign-in page's phone tab (auth spec rules 21–24, 4.4b): only a number already verified in
 * Account › Security works, and the API answers the same for any number. The code goes on the
 * shared enter-code screen.
 */
@Component({
  selector: 'app-phone-sign-in',
  imports: [FORM_IMPORTS, TranslocoPipe, InputField, HlmButton, HlmSpinner],
  template: `
    <form [formGroup]="form" class="flex flex-col gap-4" (ngSubmit)="onSubmit()">
      <app-input-field
        [control]="form.controls.phone"
        [label]="'auth.phone' | transloco"
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
        {{ 'auth.sendCode' | transloco }}
      </button>
    </form>
  `,
})
export class PhoneSignIn {
  private nnfb = inject(NonNullableFormBuilder)
  private router = inject(Router)
  private authService = inject(AuthService)
  private authFlowStore = inject(AuthFlowStore)
  protected networkStatusService = inject(NetworkStatusService)

  returnUrl = input.required<string>()

  isProcessing = signal(false)
  protected error = signal<UiMessage | null>(null)

  form: PhoneFormGroup = this.nnfb.group({
    phone: [
      this.authFlowStore.pending().phone
        ? formatThaiMobile(this.authFlowStore.pending().phone)
        : '',
      [withMessage(Validators.required, 'auth.phoneRequired'), thaiMobileValidator],
    ],
  })

  constructor() {
    // A server error describes the last submit; editing the form leaves only field messages.
    this.form.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => this.error.set(null))
  }

  protected async onSubmit(): Promise<void> {
    const phone = normalizeThaiMobile(this.form.getRawValue().phone)
    if (this.form.invalid || !phone || this.isProcessing()) {
      return
    }
    // Shown the Thai way, whatever was typed.
    this.form.controls.phone.setValue(formatThaiMobile(phone), { emitEvent: false })
    this.isProcessing.set(true)
    this.error.set(null)
    try {
      await this.authService.startPhone(phone)
      this.authFlowStore.startPhone(phone, this.returnUrl())
      await this.router.navigate(['/auth/code'])
    } catch (error) {
      const apiError = toApiError(error)
      // Already sent within the last minute: the code on its way is still good.
      if (apiError.status === 429 && this.authFlowStore.pending().phone === phone) {
        await this.router.navigate(['/auth/code'])
        return
      }
      this.error.set(authErrorMessage(apiError, 'auth.sendFailed'))
    } finally {
      this.isProcessing.set(false)
    }
  }
}
