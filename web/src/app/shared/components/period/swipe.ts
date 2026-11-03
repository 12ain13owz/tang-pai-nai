import { Directive, output } from '@angular/core'

/**
 * A sideways swipe by touch or pen (not a mouse drag): `swiped` gives +1 for a swipe to the
 * left (the next period) and −1 for one to the right (the previous one). A mostly vertical move
 * is a scroll and is ignored.
 */
@Directive({
  selector: '[appSwipe]',
  host: {
    '(pointerdown)': 'start($event)',
    '(pointerup)': 'end($event)',
  },
})
export class Swipe {
  swiped = output<1 | -1>()

  private from: { x: number; y: number } | null = null

  protected start(event: PointerEvent): void {
    this.from = event.pointerType === 'mouse' ? null : { x: event.clientX, y: event.clientY }
  }

  protected end(event: PointerEvent): void {
    const from = this.from
    this.from = null
    if (!from) {
      return
    }
    const dx = event.clientX - from.x
    const dy = event.clientY - from.y
    if (Math.abs(dx) < 60 || Math.abs(dy) > 40) {
      return
    }
    this.swiped.emit(dx < 0 ? 1 : -1)
  }
}
