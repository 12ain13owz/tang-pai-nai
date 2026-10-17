import { DOCUMENT, inject, Service, signal } from '@angular/core'

/**
 * Whether the on-screen keyboard is open, so the bottom tab bar can step aside. Both iOS Safari
 * and Chrome on Android shrink the *visual* viewport, not the layout viewport, when the keyboard
 * opens, so a large gap between the two means a keyboard.
 */
@Service()
export class KeyboardService {
  private window = inject(DOCUMENT).defaultView
  // Taller than browser chrome (URL bar) changes, shorter than any phone keyboard.
  private readonly MIN_KEYBOARD_HEIGHT = 150

  isOpen = signal(false)

  constructor() {
    const viewport = this.window?.visualViewport
    if (!this.window || !viewport) {
      return
    }
    const window = this.window
    const update = () =>
      this.isOpen.set(window.innerHeight - viewport.height > this.MIN_KEYBOARD_HEIGHT)
    viewport.addEventListener('resize', update)
    update()
  }
}
