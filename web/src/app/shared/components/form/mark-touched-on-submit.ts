import { Directive, inject } from '@angular/core'
import { FormGroupDirective } from '@angular/forms'

/**
 * Applies itself to every `<form [formGroup]>` that imports it (via `FORM_IMPORTS`) and marks all
 * controls as touched on submit, so every invalid field shows its error at once. Spartan's own
 * "submitted" check only recognises template-driven `NgForm`.
 */
@Directive({
  // Matches every reactive form on purpose, so forms need no extra attribute.
  // eslint-disable-next-line @angular-eslint/directive-selector
  selector: 'form[formGroup]',
  host: { '(submit)': 'markAllAsTouched()' },
})
export class MarkTouchedOnSubmit {
  private formGroupDirective = inject(FormGroupDirective)

  protected markAllAsTouched(): void {
    this.formGroupDirective.form.markAllAsTouched()
  }
}
