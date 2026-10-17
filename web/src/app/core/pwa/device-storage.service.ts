import { DOCUMENT, inject, Service, signal } from '@angular/core'

/** iOS Safari reports home-screen apps through the non-standard `navigator.standalone`. */
interface IosNavigator extends Navigator {
  standalone?: boolean
}

/**
 * Persistent storage + "is the app installed" for this device. #4a reads both before it offers to
 * trust the device: an installed app with persisted storage is far less likely to have its local
 * database evicted by the browser.
 */
@Service()
export class DeviceStorageService {
  private window = inject(DOCUMENT).defaultView

  private standaloneQuery = this.window?.matchMedia('(display-mode: standalone)')

  /** Running as an installed app (home screen / desktop), not in a browser tab. */
  isInstalled = signal(this.readInstalled())
  /** `null` until the browser has answered. */
  isPersisted = signal<boolean | null>(null)

  constructor() {
    this.standaloneQuery?.addEventListener('change', () =>
      this.isInstalled.set(this.readInstalled())
    )
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

  private readInstalled(): boolean {
    const navigator: IosNavigator | undefined = this.window?.navigator
    return (this.standaloneQuery?.matches ?? false) || navigator?.standalone === true
  }
}
