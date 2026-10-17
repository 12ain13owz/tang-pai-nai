import { Component, input } from '@angular/core'

/** Centred "nothing here yet" block. Project an icon in front of the text. */
@Component({
  selector: 'app-empty-state',
  template: `
    <div class="flex flex-col items-center gap-3 px-6 py-16 text-center">
      <div
        class="flex size-16 items-center justify-center rounded-full bg-muted text-3xl text-muted-foreground"
        aria-hidden="true"
      >
        <ng-content />
      </div>
      <p class="text-base font-medium">{{ heading() }}</p>
      @if (description()) {
        <p class="max-w-xs text-sm text-muted-foreground">{{ description() }}</p>
      }
    </div>
  `,
})
export class EmptyState {
  heading = input.required<string>()
  description = input('')
}
