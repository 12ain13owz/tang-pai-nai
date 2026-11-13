import { Directive, effect, ElementRef, inject, input } from '@angular/core'

/** How far the new content starts from its place, in px (DESIGN.md §8: small, no bounce). */
const SLIDE_PX = 48
const DURATION_MS = 220
const EASE_OUT = 'cubic-bezier(0.2, 0, 0, 1)'

/**
 * Slides its element's content in from the side its place in an ordered row moved to: a later
 * place (a period to the right) enters from the right, an earlier one from the left, like the
 * page of a carousel. `appSlide` is the content's place (an index, oldest first); the first
 * value and a negative one (not in the row) play nothing. Under `prefers-reduced-motion` the
 * content only fades in (DESIGN.md §8).
 *
 * The movement may reach past the screen's edge for a moment, so give an ancestor
 * `overflow-x-clip` (it clips without becoming a scroll container).
 */
@Directive({ selector: '[appSlide]' })
export class Slide {
  /** The content's place in its row, e.g. the chosen period tab's index. */
  appSlide = input.required<number>()

  private element = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement
  private last: number | null = null
  private running: Animation | null = null

  constructor() {
    effect(() => {
      const place = this.appSlide()
      const last = this.last
      this.last = place
      if (last === null || last < 0 || place < 0 || place === last) {
        return
      }
      this.play(place > last ? 1 : -1)
    })
  }

  private play(direction: 1 | -1): void {
    // `animate` / `matchMedia` may be missing (the test DOM, an old browser): no motion then.
    if (typeof this.element.animate !== 'function') {
      return
    }
    const view = this.element.ownerDocument.defaultView
    const reduced =
      typeof view?.matchMedia === 'function' &&
      view.matchMedia('(prefers-reduced-motion: reduce)').matches
    const from = reduced
      ? { opacity: 0 }
      : { opacity: 0, transform: `translateX(${direction * SLIDE_PX}px)` }
    const to = reduced ? { opacity: 1 } : { opacity: 1, transform: 'translateX(0)' }
    this.running?.cancel()
    this.running = this.element.animate([from, to], { duration: DURATION_MS, easing: EASE_OUT })
  }
}
