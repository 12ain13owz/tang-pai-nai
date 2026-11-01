import { Component, input, output } from '@angular/core'
import { NgIcon, provideIcons } from '@ng-icons/core'
import { lucideChevronLeft, lucideX } from '@ng-icons/lucide'
import { HlmButton } from '@spartan-ng/helm/button'
import { HlmDrawerImports } from '@spartan-ng/helm/drawer'

/**
 * The inside of every bottom sheet (DESIGN.md §6 Bottom sheet): a header with close (X) or back
 * (‹) on the left, the title in the centre and icon actions on the right (`[sheetActions]`), a
 * body that scrolls, and the main action pinned at the bottom (`[sheetFooter]`). Put it in a
 * `hlm-drawer-content class="mx-auto h-[92dvh] w-full max-w-[480px]
 * data-[vaul-drawer-direction=bottom]:max-h-[92dvh]"`: every sheet is the same near-full height,
 * so its main action always sits in the same place.
 */
@Component({
  selector: 'app-sheet-frame',
  imports: [NgIcon, HlmButton, HlmDrawerImports],
  providers: [provideIcons({ lucideChevronLeft, lucideX })],
  host: { class: 'flex min-h-0 flex-1 flex-col' },
  template: `
    <div class="grid min-h-13 grid-cols-[5.5rem_minmax(0,1fr)_5.5rem] items-center">
      <div class="justify-self-start">
        <button
          hlmBtn
          variant="ghost"
          size="icon"
          type="button"
          class="size-11"
          [attr.aria-label]="leadingLabel()"
          (click)="leading.emit()"
        >
          <ng-icon
            [name]="leadingIcon() === 'back' ? 'lucideChevronLeft' : 'lucideX'"
            size="22"
            aria-hidden="true"
          />
        </button>
      </div>
      <h2 hlmDrawerTitle class="truncate text-center text-lg font-semibold">{{ title() }}</h2>
      <div class="flex justify-self-end">
        <ng-content select="[sheetActions]" />
      </div>
    </div>
    <div class="-mx-4 min-h-0 flex-1 overflow-y-auto px-4 pt-3 pb-4">
      <ng-content />
    </div>
    <ng-content select="[sheetFooter]" />
  `,
})
export class SheetFrame {
  title = input.required<string>()
  /** X closes the sheet; ‹ goes back to the sheet's previous view. */
  leadingIcon = input<'close' | 'back'>('close')
  leadingLabel = input.required<string>()
  leading = output()
}
