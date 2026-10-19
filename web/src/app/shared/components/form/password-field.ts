import { Component, input, signal, viewChild } from '@angular/core'
import { ReactiveFormsModule } from '@angular/forms'
import type { FormControl } from '@angular/forms'
import { TranslocoPipe } from '@jsverse/transloco'
import { NgIcon, provideIcons } from '@ng-icons/core'
import { lucideEye, lucideEyeOff } from '@ng-icons/lucide'
import { BrnField } from '@spartan-ng/brain/field'
import { HlmFieldImports } from '@spartan-ng/helm/field'
import { HlmInput } from '@spartan-ng/helm/input'
import { fieldErrorMessage } from './field-error'

@Component({
  selector: 'app-password-field',
  imports: [TranslocoPipe, ReactiveFormsModule, HlmFieldImports, HlmInput, NgIcon],
  providers: [provideIcons({ lucideEye, lucideEyeOff })],
  template: `
    <div hlmField>
      <label hlmFieldLabel>{{ label() }}</label>
      <div class="relative">
        <input
          hlmInput
          class="pe-11"
          [formControl]="control()"
          [type]="visible() ? 'text' : 'password'"
          [attr.autocomplete]="autocomplete()"
        />
        <button
          type="button"
          class="absolute inset-y-0 end-0 flex w-11 items-center justify-center text-muted-foreground"
          [attr.aria-label]="(visible() ? 'form.hidePassword' : 'form.showPassword') | transloco"
          [attr.aria-pressed]="visible()"
          (click)="toggleVisible()"
        >
          <ng-icon [name]="visible() ? 'lucideEyeOff' : 'lucideEye'" size="18" aria-hidden="true" />
        </button>
      </div>
      @if (hint()) {
        <p hlmFieldDescription class="-mt-2">{{ hint() }}</p>
      }
      <hlm-field-error class="-mt-2">{{ error() }}</hlm-field-error>
    </div>
  `,
})
export class PasswordField {
  control = input.required<FormControl<string>>()
  label = input.required<string>()
  hint = input('')
  autocomplete = input<'current-password' | 'new-password'>('current-password')

  protected visible = signal(false)

  private field = viewChild.required(BrnField)
  protected error = fieldErrorMessage(this.field)

  protected toggleVisible(): void {
    this.visible.update((visible) => !visible)
  }
}
