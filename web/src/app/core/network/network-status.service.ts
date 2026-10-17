import { DOCUMENT, inject, Service, signal } from '@angular/core'

/**
 * Whether the browser reports a network connection (`navigator.onLine` + events). It only means
 * "has a network", not "the API is reachable". #4a turns this into the sync status.
 */
@Service()
export class NetworkStatusService {
  private window = inject(DOCUMENT).defaultView

  isOnline = signal(this.window?.navigator.onLine ?? true)

  constructor() {
    this.window?.addEventListener('online', () => this.isOnline.set(true))
    this.window?.addEventListener('offline', () => this.isOnline.set(false))
  }
}
