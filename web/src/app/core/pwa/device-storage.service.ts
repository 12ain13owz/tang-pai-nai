import { DOCUMENT, inject, Service, signal } from '@angular/core'

/** iOS Safari reports home-screen apps through the non-standard `navigator.standalone`. */
interface IosNavigator extends Navigator {
  standalone?: boolean
}

/** Chrome's install offer (not in the DOM typings): `prompt()` shows the browser's own dialog. */
interface InstallPromptEvent extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

/** Which install steps fit this device (install.md rule 3); iPadOS counts as iPhone. */
export type InstallPlatform = 'ios' | 'android'

/**
 * Persistent storage + "is the app installed" for this device. #4a reads both before it offers to
 * trust the device: an installed app with persisted storage is far less likely to have its local
 * database evicted by the browser. Also the one-tap install where the browser offers it
 * (install.md): `App` injects this service so `beforeinstallprompt` is caught at start.
 */
@Service()
export class DeviceStorageService {
  private window = inject(DOCUMENT).defaultView

  private standaloneQuery = this.window?.matchMedia('(display-mode: standalone)')

  /** Running as an installed app (home screen / desktop), not in a browser tab. */
  isInstalled = signal(this.readInstalled())
  /** `null` until the browser has answered. */
  isPersisted = signal<boolean | null>(null)
  /** The browser offered a one-tap install (install.md rule 2); used once. */
  canPrompt = signal(false)
  /** Installed from this tab just now (`appinstalled`): open it from the icon. */
  justInstalled = signal(false)
  platform: InstallPlatform = this.readPlatform()

  private installPrompt: InstallPromptEvent | null = null

  constructor() {
    this.standaloneQuery?.addEventListener('change', () =>
      this.isInstalled.set(this.readInstalled())
    )
    this.window?.addEventListener('beforeinstallprompt', (event) => {
      // Keep it for the "ติดตั้งแอป" button instead of the browser's own mini bar.
      event.preventDefault()
      this.installPrompt = event as InstallPromptEvent
      this.canPrompt.set(true)
    })
    this.window?.addEventListener('appinstalled', () => {
      this.installPrompt = null
      this.canPrompt.set(false)
      this.justInstalled.set(true)
    })
    this.window?.navigator.storage.persisted().then(
      (persisted) => this.isPersisted.set(persisted),
      () => this.isPersisted.set(null)
    )
  }

  /**
   * Asks the browser not to evict this origin's storage. Chrome decides silently (installed apps
   * are usually granted), Firefox may prompt, Safari grants it to home-screen apps.
   */
  async persist(): Promise<boolean> {
    const storage = this.window?.navigator.storage
    if (!storage) {
      return false
    }
    const persisted = await storage.persist()
    this.isPersisted.set(persisted)
    return persisted
  }

  /** Shows the browser's install dialog; true when the person installed. */
  async promptInstall(): Promise<boolean> {
    const event = this.installPrompt
    if (!event) {
      return false
    }
    // A prompt event works once.
    this.installPrompt = null
    this.canPrompt.set(false)
    await event.prompt()
    const { outcome } = await event.userChoice
    return outcome === 'accepted'
  }

  private readPlatform(): InstallPlatform {
    const navigator = this.window?.navigator
    const agent = navigator?.userAgent ?? ''
    // iPadOS asks for desktop pages and calls itself a Mac, but has a touch screen.
    const ios =
      /iPhone|iPad|iPod/.test(agent) ||
      (/Macintosh/.test(agent) && (navigator?.maxTouchPoints ?? 0) > 1)
    return ios ? 'ios' : 'android'
  }

  private readInstalled(): boolean {
    const navigator: IosNavigator | undefined = this.window?.navigator
    return (this.standaloneQuery?.matches ?? false) || navigator?.standalone === true
  }
}
