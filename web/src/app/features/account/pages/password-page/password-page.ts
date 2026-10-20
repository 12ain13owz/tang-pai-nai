import { Component, computed, inject, signal } from '@angular/core'
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
import { authErrorMessage, AuthService, AuthStore, passwordPolicyValidator } from '@/core/auth'
import type { UiMessage } from '@/core/auth'
import { LanguageService } from '@/core/i18n'
import { NetworkStatusService } from '@/core/network'
import type { NewPasswordFormGroup } from '@/features/account/account-form.type'
import { ReauthStep } from '@/features/account/components/reauth-step'
import { ReauthFlow } from '@/features/account/reauth-flow'
import { FORM_IMPORTS, PasswordField, withMessage } from '@/shared/components/form'

/** What waits for "confirm it's you" before it's sent again. */
type PendingAction = { kind: 'set'; newPassword: string } | { kind: 'remove' }

const matchesNewPassword: ValidatorFn = (control) => {
  const newPassword: unknown = control.parent?.get('newPassword')?.value
  return control.value && control.value !== newPassword
    ? { passwordMismatch: 'account.passwordMismatch' }
    : null
}

/**
 * Set, change or remove the optional password (auth spec rules 11 and 13). A `403
 * REAUTH_REQUIRED` swaps the form for the confirm step, then the same action is sent again.
 */
@Component({
  selector: 'app-password-page',
  imports: [FORM_IMPORTS, TranslocoPipe, NgIcon, PasswordField, ReauthStep, HlmButton, HlmSpinner],
  providers: [provideIcons({ lucideArrowLeft }), ReauthFlow],
  template: `
    <div class="flex flex-col gap-6 p-4">
      <button hlmBtn variant="ghost" type="button" class="-ms-3 h-11 self-start" (click)="back()">
        <ng-icon name="lucideArrowLeft" aria-hidden="true" />
        {{ 'title.account' | transloco }}
      </button>

      <div class="flex flex-col gap-1">
        <p class="text-base font-medium">
          {{ (hasPassword() ? 'account.passwordIsSet' : 'account.passwordNotSet') | transloco }}
        </p>
        <p class="text-sm text-muted-foreground">{{ 'account.passwordOptional' | transloco }}</p>
      </div>

      @if (!networkStatusService.isOnline()) {
        <p role="status" class="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {{ 'account.passwordOffline' | transloco }}
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
          (passwordSubmitted)="confirmWithPassword(action, $event)"
          (sendCode)="reauth.sendCode()"
          (codeSubmitted)="confirmWithCode(action, $event)"
          (methodChange)="reauth.switchMethod($event)"
          (cancelled)="reauth.close()"
        />
      } @else {
        <form [formGroup]="form" class="flex flex-col gap-4" (ngSubmit)="onSubmit()">
          <app-password-field
            [control]="form.controls.newPassword"
            [label]="(hasPassword() ? 'account.newPassword' : 'account.choosePassword') | transloco"
            [hint]="'account.passwordRules' | transloco"
            autocomplete="new-password"
          />
          <app-password-field
            [control]="form.controls.confirmPassword"
            [label]="'account.confirmPassword' | transloco"
            autocomplete="new-password"
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
              <hlm-spinner [aria-label]="'account.saving' | transloco" />
            }
            {{ (hasPassword() ? 'account.changePassword' : 'account.setPassword') | transloco }}
          </button>
          @if (hasPassword()) {
            <p class="text-center text-sm text-muted-foreground">
              {{ 'account.changeSignsOutOthers' | transloco }}
            </p>
          }
        </form>

        @if (hasPassword()) {
          <section class="flex flex-col gap-3 border-t border-border pt-6">
            @if (confirmingRemove()) {
              <p class="text-sm">{{ 'account.removeConfirmText' | transloco }}</p>
              <button
                hlmBtn
                variant="destructive"
                type="button"
                class="h-11 w-full text-base"
                [disabled]="isProcessing() || !networkStatusService.isOnline()"
                (click)="remove()"
              >
                @if (isProcessing()) {
                  <hlm-spinner [aria-label]="'account.removing' | transloco" />
                }
                {{ 'account.removeConfirm' | transloco }}
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
                (click)="confirmingRemove.set(true)"
              >
                {{ 'account.removePassword' | transloco }}
              </button>
            }
          </section>
        }
      }
    </div>
  `,
})
export class PasswordPage {
  private nnfb = inject(NonNullableFormBuilder)
  private router = inject(Router)
  private authService = inject(AuthService)
  private authStore = inject(AuthStore)
  private languageService = inject(LanguageService)
  protected networkStatusService = inject(NetworkStatusService)
  protected reauth = inject(ReauthFlow<PendingAction>)

  protected email = computed(() => this.authStore.user()?.email ?? '')
  protected hasPassword = computed(() => this.authStore.user()?.hasPassword ?? false)

  isProcessing = signal(false)
  protected error = signal<UiMessage | null>(null)
  protected done = signal<string | null>(null)
  protected confirmingRemove = signal(false)

  form: NewPasswordFormGroup = this.nnfb.group({
    newPassword: [
      '',
      [
        withMessage(Validators.required, 'auth.passwordRequired'),
        passwordPolicyValidator(() => this.email()),
      ],
    ],
    confirmPassword: [
      '',
      [withMessage(Validators.required, 'auth.passwordRequired'), matchesNewPassword],
    ],
  })

  constructor() {
    this.form.controls.newPassword.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.form.controls.confirmPassword.updateValueAndValidity())
    // A server error describes the last submit; editing the form leaves only field messages.
    this.form.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => this.error.set(null))
  }

  protected async onSubmit(): Promise<void> {
    if (this.form.invalid || this.isProcessing()) {
      return
    }
    await this.run({ kind: 'set', newPassword: this.form.getRawValue().newPassword })
  }

  protected async remove(): Promise<void> {
    await this.run({ kind: 'remove' })
  }

  protected async confirmWithPassword(action: PendingAction, currentPassword: string) {
    await this.run(action, currentPassword)
  }

  protected async confirmWithCode(action: PendingAction, code: string): Promise<void> {
    if (await this.reauth.verifyCode(code)) {
      await this.run(action)
    }
  }

  protected async back(): Promise<void> {
    await this.router.navigate(['/account'])
  }

  /** Sends the action; on `REAUTH_REQUIRED` keeps it pending until the user confirms. */
  private async run(action: PendingAction, currentPassword?: string): Promise<void> {
    this.isProcessing.set(true)
    this.error.set(null)
    this.reauth.clearError()
    this.done.set(null)
    const lang = this.languageService.language().id
    try {
      if (action.kind === 'set') {
        const hadPassword = this.hasPassword()
        await this.authService.setPassword(action.newPassword, lang, currentPassword)
        this.form.reset({ newPassword: '', confirmPassword: '' })
        this.done.set(hadPassword ? 'account.passwordChanged' : 'account.passwordSaved')
      } else {
        await this.authService.removePassword(lang, currentPassword)
        this.done.set('account.passwordRemoved')
      }
      this.reauth.close()
      this.confirmingRemove.set(false)
    } catch (error) {
      this.handleError(action, toApiError(error))
    } finally {
      this.isProcessing.set(false)
    }
  }

  private handleError(action: PendingAction, apiError: ReturnType<typeof toApiError>): void {
    if (!this.reauth.refused(action, apiError, this.hasPassword())) {
      this.error.set(authErrorMessage(apiError, 'account.passwordSaveFailed'))
    }
  }
}
