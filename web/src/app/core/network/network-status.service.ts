import { DOCUMENT, inject, Service, signal } from '@angular/core'

/**
 * Whether the browser reports a network connection (`navigator.onLine` + events), and whether
 * the API answered the last time it was asked (`serverReachable`, kept by `SyncService`:
 * offline-sync rule 11). A network alone doesn't mean the API is up.
 */
@Service()
export class NetworkStatusService {
  private window = inject(DOCUMENT).defaultView

  isOnline = signal(this.window?.navigator.onLine ?? true)
  /** False while the network is up but the API isn't answering (rule 11). */
  serverReachable = signal(true)

  constructor() {
    this.window?.addEventListener('online', () => this.isOnline.set(true))
    this.window?.addEventListener('offline', () => this.isOnline.set(false))
  }
}
