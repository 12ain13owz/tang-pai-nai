import { afterNextRender, Component, DOCUMENT, ElementRef, inject, viewChild } from '@angular/core'
import { RouterOutlet } from '@angular/router'
import { HlmToaster } from '@spartan-ng/helm/sonner'

@Component({
  imports: [RouterOutlet, HlmToaster],
  selector: 'app-root',
  template: `
    <router-outlet />
    <!-- Colours come from the theme tokens. Toasts sit at the top of the screen (owner's choice
         in 8.2, DESIGN.md §6): at the bottom they covered the keypad and a sheet's main button.
         Sonner pins them 16px from the top on phones; the notch's inset comes first. -->
    <hlm-toaster
      #toaster
      position="top-center"
      class="top-[calc(0.5rem+env(safe-area-inset-top))]!"
    />
  `,
})
export class App {
  private document = inject(DOCUMENT)
  private toaster = viewChild.required('toaster', { read: ElementRef })

  constructor() {
    // An open sheet (CDK overlay) hides the rest of <body> from screen readers and closes on a
    // tap anywhere in <body> outside it. A toast shown over a sheet ("บันทึกแล้วเพิ่มต่อ", undo)
    // must be neither, so the toaster lives beside <body>, as <html>'s last child (8.2).
    afterNextRender(() => {
      this.document.documentElement.appendChild(this.toaster().nativeElement as HTMLElement)
    })
  }
}
