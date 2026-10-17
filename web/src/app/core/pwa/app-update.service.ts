import { DOCUMENT, inject, Service, signal } from '@angular/core'
import { SwUpdate } from '@angular/service-worker'

/**
 * Tells the shell when a new deployed version is downloaded and ready, so it can offer a reload.
 * The service worker only caches the app shell (see `ngsw-config.json`), never API data.
 */
@Service()
export class AppUpdateService {
  private document = inject(DOCUMENT)
  private swUpdate = inject(SwUpdate)

  isUpdateReady = signal(false)

  constructor() {
    if (!this.swUpdate.isEnabled) {
      return
    }
    this.swUpdate.versionUpdates.subscribe((event) => {
      if (event.type === 'VERSION_READY') {
        this.isUpdateReady.set(true)
      }
    })
    // The cached version can't be served any more (e.g. files evicted): only a reload recovers.
    this.swUpdate.unrecoverable.subscribe(() => this.isUpdateReady.set(true))
    // An installed PWA can stay open for days: look for a new version whenever it comes back.
    this.document.addEventListener('visibilitychange', () => {
      if (this.document.visibilityState === 'visible') {
        this.checkForUpdate()
      }
    })
  }

  async reload(): Promise<void> {
    try {
      await this.swUpdate.activateUpdate()
    } finally {
      this.document.location.reload()
    }
  }

  private checkForUpdate(): void {
    this.swUpdate.checkForUpdate().catch((error: unknown) => {
      console.warn('Update check failed', error)
    })
  }
}
