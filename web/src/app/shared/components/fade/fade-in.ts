import { Directive, effect, ElementRef, inject, input } from '@angular/core'

/** The top of DESIGN.md §8's range: shorter, and a fade on a page of the same background is missed. */
const DURATION_MS = 250
/** CSS `ease-out`: an even fade, unlike a sharp decelerate that is opaque within ~60 ms. */
const EASE_OUT = 'cubic-bezier(0, 0, 0.58, 1)'
/** A small rise with the fade, so the change of page reads; dropped under reduced motion. */
const RISE_PX = 8

/**
 * Fades its element's content in each time `appFadeIn` (a key, e.g. the bottom tab) changes; the
 * first value plays nothing. For places with no order between them, such as the tabs, where a
 * slide would claim a direction (DESIGN.md §8). Under `prefers-reduced-motion` only the fade
 * plays.
 */
@Directive({ selector: '[appFadeIn]' })
export class FadeIn {
  /** What the content shows; a new value fades it in. */
  appFadeIn = input.required<string>()

  private element = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement
  private last: string | null = null
  private running: Animation | null = null

  constructor() {
    effect(() => {
      const key = this.appFadeIn()
      const last = this.last
      this.last = key
      if (last === null || key === last) {
        return
      }
      this.play()
    })
  }

  private play(): void {
    // `animate` / `matchMedia` may be missing (the test DOM, an old browser): no motion then.
    if (typeof this.element.animate !== 'function') {
      return
    }
    const view = this.element.ownerDocument.defaultView
    const reduced =
      typeof view?.matchMedia === 'function' &&
      view.matchMedia('(prefers-reduced-motion: reduce)').matches
    const from = reduced ? { opacity: 0 } : { opacity: 0, transform: `translateY(${RISE_PX}px)` }
    const to = reduced ? { opacity: 1 } : { opacity: 1, transform: 'translateY(0)' }
    this.running?.cancel()
    this.running = this.element.animate([from, to], { duration: DURATION_MS, easing: EASE_OUT })
  }
}
