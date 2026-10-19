import { NgTemplateOutlet } from '@angular/common'
import { Component, inject, input, linkedSignal, output } from '@angular/core'
import { takeUntilDestroyed } from '@angular/core/rxjs-interop'
import { NonNullableFormBuilder, Validators } from '@angular/forms'
import { TranslocoPipe } from '@jsverse/transloco'
import { HlmButton } from '@spartan-ng/helm/button'
import { HlmSpinner } from '@spartan-ng/helm/spinner'
import type { UiMessage } from '@/core/auth'
import type {
  CurrentPasswordFormGroup,
  ReauthCodeFormGroup,
  ReauthMethod,
} from '@/features/account/account-form.type'
import { FORM_IMPORTS, OtpField, PasswordField, withMessage } from '@/shared/components/form'

const CODE_LENGTH = 6

/**
 * "Confirm it's you" (auth spec rule 13), shown in place when the API answers `REAUTH_REQUIRED`:
 * the current password, or a code mailed to the user's own email. Presentational: the page sends
 * the requests and passes their state back in.
 */
@Component({
  selector: 'app-reauth-step',
  imports: [
    FORM_IMPORTS,
    NgTemplateOutlet,
    TranslocoPipe,
    PasswordField,
    OtpField,
    HlmButton,
    HlmSpinner,
  ],
  template: `
    <section
      class="flex flex-col gap-4 rounded-xl border border-border bg-card p-4 text-card-foreground"
      aria-labelledby="reauth-heading"
    >
      <div class="flex flex-col gap-1">
        <h2 id="reauth-heading" class="text-base font-semibold">
          {{ 'account.reauthHeading' | transloco }}
        </h2>
        <p class="text-sm text-muted-foreground">
          @if (method() === 'password') {
            {{ 'account.reauthPasswordText' | transloco }}
          } @else if (codeSent()) {
            {{ 'account.reauthCodeSentTo' | transloco }}
            <span class="font-medium wrap-anywhere text-foreground">{{ email() }}</span>
          } @else {
            {{ 'account.reauthCodeText' | transloco }}
            <span class="font-medium wrap-anywhere text-foreground">{{ email() }}</span>
          }
        </p>
      </div>

      @if (method() === 'password') {
        <form [formGroup]="passwordForm" class="flex flex-col gap-4" (ngSubmit)="submitPassword()">
          <app-password-field
            [control]="passwordForm.controls.currentPassword"
            [label]="'account.currentPassword' | transloco"
            autocomplete="current-password"
          />
          <ng-container [ngTemplateOutlet]="errorLine" />
          <button hlmBtn type="submit" class="h-11 w-full text-base" [disabled]="isProcessing()">
            @if (isProcessing()) {
              <hlm-spinner [aria-label]="'account.confirming' | transloco" />
            }
            {{ 'account.confirm' | transloco }}
          </button>
        </form>
        <button
          hlmBtn
          variant="ghost"
          type="button"
          class="h-11"
          [disabled]="isProcessing()"
          (click)="methodChange.emit('code')"
        >
          {{ 'account.reauthUseCode' | transloco }}
        </button>
      } @else if (codeSent()) {
        <form [formGroup]="codeForm" class="flex flex-col gap-4" (ngSubmit)="submitCode()">
          <app-otp-field [control]="codeForm.controls.code" [label]="'auth.code' | transloco" />
          <ng-container [ngTemplateOutlet]="errorLine" />
          <button hlmBtn type="submit" class="h-11 w-full text-base" [disabled]="isProcessing()">
            @if (isProcessing()) {
              <hlm-spinner [aria-label]="'account.confirming' | transloco" />
            }
            {{ 'account.confirm' | transloco }}
          </button>
        </form>
        <button
          hlmBtn
          variant="ghost"
          type="button"
          class="h-11"
          [disabled]="secondsLeft() > 0 || isProcessing()"
          (click)="sendCode.emit()"
        >
          @if (secondsLeft() > 0) {
            {{ 'auth.resendIn' | transloco: { seconds: secondsLeft() } }}
          } @else {
            {{ 'auth.resend' | transloco }}
          }
        </button>
      } @else {
        <ng-container [ngTemplateOutlet]="errorLine" />
        <button
          hlmBtn
          type="button"
          class="h-11 w-full text-base"
          [disabled]="isProcessing()"
          (click)="sendCode.emit()"
        >
          @if (isProcessing()) {
            <hlm-spinner [aria-label]="'auth.sending' | transloco" />
          }
          {{ 'account.reauthSendCode' | transloco }}
        </button>
      }

      @if (method() === 'code' && hasPassword()) {
        <button
          hlmBtn
          variant="ghost"
          type="button"
          class="h-11"
          [disabled]="isProcessing()"
          (click)="methodChange.emit('password')"
        >
          {{ 'account.reauthUsePassword' | transloco }}
        </button>
      }
      <button
        hlmBtn
        variant="outline"
        type="button"
        class="h-11"
        [disabled]="isProcessing()"
        (click)="cancelled.emit()"
      >
        {{ 'account.cancel' | transloco }}
      </button>
    </section>

    <ng-template #errorLine>
      @if (shownError(); as message) {
        <p role="alert" class="text-sm text-destructive">
          {{ message.key | transloco: message.params }}
        </p>
      }
    </ng-template>
  `,
})
export class ReauthStep {
  private nnfb = inject(NonNullableFormBuilder)

  email = input.required<string>()
  hasPassword = input.required<boolean>()
  method = input.required<ReauthMethod>()
  codeSent = input(false)
  secondsLeft = input(0)
  isProcessing = input(false)
  error = input<UiMessage | null>(null)
  /**
   * The last server answer, until the user edits the field: from then on only the field's own
   * message (if any) shows, never both at once.
   */
  protected shownError = linkedSignal(() => this.error())

  passwordSubmitted = output<string>()
  codeSubmitted = output<string>()
  sendCode = output()
  methodChange = output<ReauthMethod>()
  cancelled = output()

  passwordForm: CurrentPasswordFormGroup = this.nnfb.group({
    currentPassword: ['', withMessage(Validators.required, 'auth.passwordRequired')],
  })

  codeForm: ReauthCodeFormGroup = this.nnfb.group({
    code: ['', [Validators.required, Validators.pattern(/^\d{6}$/)]],
  })

  constructor() {
    this.passwordForm.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.shownError.set(null))
    // The last digit (typed, pasted or auto-filled) submits, as on the sign-in code screen.
    this.codeForm.valueChanges.pipe(takeUntilDestroyed()).subscribe(({ code }) => {
      this.shownError.set(null)
      if (code?.length === CODE_LENGTH) {
        this.submitCode()
      }
    })
  }

  protected submitPassword(): void {
    if (this.passwordForm.invalid || this.isProcessing()) {
      return
    }
    this.passwordSubmitted.emit(this.passwordForm.getRawValue().currentPassword)
  }

  protected submitCode(): void {
    if (this.codeForm.invalid || this.isProcessing()) {
      return
    }
    this.codeSubmitted.emit(this.codeForm.getRawValue().code)
    this.codeForm.reset({ code: '' }, { emitEvent: false })
  }
}
