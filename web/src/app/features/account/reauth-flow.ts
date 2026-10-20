import { computed, DestroyRef, inject, Injectable, signal } from '@angular/core'
import { toApiError } from '@/core/api'
import type { ApiError } from '@/core/api'
import { authErrorMessage, AuthService } from '@/core/auth'
import type { UiMessage } from '@/core/auth'
import { LanguageService } from '@/core/i18n'
import type { ReauthMethod } from '@/features/account/account-form.type'

const RESEND_COOLDOWN_MS = 60_000

/**
 * The state behind `app-reauth-step` (auth spec rule 13): which action waits for "confirm it's
 * you", how the user proves it, and the step-up code's resend timer. Provide it per page; the
 * page sends its own request and calls `refused()` with the error.
 */
@Injectable()
export class ReauthFlow<Action> {
  private authService = inject(AuthService)
  private languageService = inject(LanguageService)

  /** The action to send again once confirmed; `null` while no confirm step is shown. */
  readonly pending = signal<Action | null>(null)
  readonly method = signal<ReauthMethod>('code')
  readonly error = signal<UiMessage | null>(null)
  readonly codeSent = signal(false)
  /** A step-up code is being sent or checked. */
  readonly isBusy = signal(false)

  private resendAt = signal(0)
  private now = signal(Date.now())
  readonly secondsLeft = computed(() =>
    Math.max(0, Math.ceil((this.resendAt() - this.now()) / 1000))
  )

  constructor() {
    const timer = setInterval(() => this.now.set(Date.now()), 1000)
    inject(DestroyRef).onDestroy(() => clearInterval(timer))
  }

  /**
   * Call with a failed action's error. `true` means the confirm step took it: `REAUTH_REQUIRED`
   * (keep the action pending) or a wrong current password while confirming (show it there).
   */
  refused(action: Action, apiError: ApiError, hasPassword: boolean): boolean {
    if (apiError.code === 'REAUTH_REQUIRED') {
      if (!this.pending()) {
        this.method.set(hasPassword ? 'password' : 'code')
      }
      this.pending.set(action)
      return true
    }
    if (this.pending() && apiError.code === 'CURRENT_PASSWORD_INVALID') {
      this.error.set(authErrorMessage(apiError, 'account.reauthFailed'))
      return true
    }
    // Anything else ends the confirm step; the page shows the error.
    this.pending.set(null)
    return false
  }

  async sendCode(): Promise<void> {
    this.isBusy.set(true)
    this.error.set(null)
    try {
      await this.authService.startReauth(this.languageService.language().id)
      this.codeSent.set(true)
      this.now.set(Date.now())
      this.resendAt.set(this.now() + RESEND_COOLDOWN_MS)
    } catch (error) {
      const apiError = toApiError(error)
      if (apiError.retryAfterSeconds) {
        this.resendAt.set(Date.now() + apiError.retryAfterSeconds * 1000)
      }
      this.error.set(authErrorMessage(apiError, 'auth.sendFailed'))
    } finally {
      this.isBusy.set(false)
    }
  }

  /** `true` when the code was right: the page then sends the pending action again. */
  async verifyCode(code: string): Promise<boolean> {
    this.isBusy.set(true)
    this.error.set(null)
    try {
      await this.authService.verifyReauth(code)
      return true
    } catch (error) {
      this.error.set(authErrorMessage(toApiError(error), 'account.reauthFailed'))
      return false
    } finally {
      this.isBusy.set(false)
    }
  }

  switchMethod(method: ReauthMethod): void {
    this.method.set(method)
    this.error.set(null)
  }

  /** Before sending an action: a fresh attempt clears the last confirm error. */
  clearError(): void {
    this.error.set(null)
  }

  /** The action went through, or the user gave up. */
  close(): void {
    this.pending.set(null)
    this.error.set(null)
  }
}
