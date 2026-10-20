import { computed, DOCUMENT, effect, inject, Service, signal, untracked } from '@angular/core'
import { Router } from '@angular/router'
import { AuthService, AuthStore, SIGN_IN_URL } from '@/core/auth'
import { DeviceStorageService } from '@/core/pwa'
import { LocalDatabase } from './local-database'
import { createDataKey, seal, unseal, unwrapDataKey, wrapDataKey } from './vault-crypto'
import { vaultStorage } from './vault-storage'
import type { VaultMeta } from './vault-storage'

/**
 * - `unknown`: the vault hasn't been read yet
 * - `none`: an untrusted device (no local data is stored, rule 1)
 * - `locked` / `unlocked`: a trusted device, before / after the PIN (rule 2)
 * - `elsewhere`: another tab runs the app (rule 2, one tab at a time)
 */
export type OfflineState = 'unknown' | 'none' | 'locked' | 'unlocked' | 'elsewhere'

/** `wiped`: that was the 5th wrong PIN in a row, so the local data is gone (rule 3). */
export type PinCheck = 'ok' | 'wrong' | 'wiped'

export const LOCK_URL = '/auth/lock'
export const OTHER_TAB_URL = '/auth/tab'

/** Wrong PINs in a row before the local data is wiped (rule 3). */
export const MAX_PIN_ATTEMPTS = 5
/** The warning shows from this wrong attempt on (rule 3). */
export const WARN_FROM_ATTEMPT = 3
/** Background or idle time before the app locks again (rule 2). */
export const LOCK_AFTER_MS = 5 * 60_000

const TAB_LOCK = 'tpn-local-db'
const TAB_CHANNEL = 'tpn-local-db'
const IDLE_CHECK_MS = 15_000

/**
 * The trusted device (docs/features/offline-sync.md rules 1–7): its encrypted local database,
 * the PIN that unlocks it, auto-lock, one tab at a time, and the wipes.
 */
@Service()
export class OfflineService {
  private window = inject(DOCUMENT).defaultView
  private router = inject(Router)
  private authStore = inject(AuthStore)
  private authService = inject(AuthService)
  private deviceStorageService = inject(DeviceStorageService)

  state = signal<OfflineState>('unknown')
  /** The clear-text part of the vault, `null` on an untrusted device. */
  meta = signal<VaultMeta | null>(null)
  isTrusted = computed(() => this.meta() !== null)
  attemptsLeft = computed(() => MAX_PIN_ATTEMPTS - (this.meta()?.failedAttempts ?? 0))

  private reading: Promise<VaultMeta | null> | null = null
  private dataKey: CryptoKey | null = null
  private database: LocalDatabase | null = null
  private saving: Promise<void> | null = null
  /** Bumped by every `save()`; the loop saves again until no call came in meanwhile. */
  private saveRequests = 0
  private releaseTab: (() => void) | null = null
  private channel = this.window?.BroadcastChannel ? new BroadcastChannel(TAB_CHANNEL) : null
  private lastActivity = Date.now()
  private hiddenAt: number | null = null

  constructor() {
    // Revoked (signed out elsewhere, disabled user): wipe, it's a security action (rule 7).
    effect(() => {
      if (this.authStore.endedBy() === 'revoked' && this.meta()) {
        untracked(() => void this.wipeAndSignIn())
      }
    })
    this.channel?.addEventListener('message', (event: MessageEvent) => {
      if (event.data === 'takeover') {
        void this.handOver()
      }
    })
    this.watchActivity()
  }

  /** Reads the vault's meta once; `null` means an untrusted device. */
  async ready(): Promise<VaultMeta | null> {
    this.reading ??= vaultStorage
      .readMeta()
      .catch(() => null)
      .then((meta) => {
        this.meta.set(meta)
        if (this.state() === 'unknown') {
          this.state.set(meta ? 'locked' : 'none')
        }
        return meta
      })
    return this.reading
  }

  /** The unlocked database. Only call it while `state()` is `unlocked`. */
  db(): LocalDatabase {
    if (!this.database) {
      throw new Error('The local database is locked')
    }
    return this.database
  }

  /** A local write (rule 8): one SQLite transaction, then the snapshot is saved. */
  write<T>(work: (db: LocalDatabase) => T): T {
    const result = this.db().transaction(work)
    void this.save()
    return result
  }

  /**
   * Rule 1: trust this device for the signed-in user. Creates the data key, wraps it with `pin`,
   * and saves an empty encrypted database; the app stays unlocked.
   */
  async enable(pin: string): Promise<void> {
    const user = this.authStore.user()
    if (!user) {
      throw new Error('Trusting a device needs a signed-in user')
    }
    await this.claimTab()
    const dataKey = await createDataKey()
    const database = await LocalDatabase.open()
    database.transaction((db) => {
      db.exec('INSERT INTO sync_meta (key, value) VALUES (?, ?), (?, ?)', [
        'deviceId',
        crypto.randomUUID(),
        'userId',
        user.id,
      ])
    })
    const meta: VaultMeta = {
      userId: user.id,
      displayName: user.displayName,
      key: await wrapDataKey(dataKey, pin),
      failedAttempts: 0,
    }
    await vaultStorage.create(meta, await seal(dataKey, database.export()))
    this.dataKey = dataKey
    this.database = database
    this.meta.set(meta)
    this.reading = Promise.resolve(meta)
    this.unlocked()
    // Rule 5: ask the browser not to evict it. Its answer doesn't change anything here.
    await this.deviceStorageService.persist().catch(() => false)
  }

  /** Rule 2: the PIN unwraps the data key and decrypts the snapshot into memory. */
  async unlock(pin: string): Promise<PinCheck> {
    const result = await this.checkPin(pin)
    if (result.check !== 'ok') {
      return result.check
    }
    const snapshot = await vaultStorage.readSnapshot()
    this.database = await LocalDatabase.open(
      snapshot ? await unseal(result.dataKey, snapshot) : undefined
    )
    this.dataKey = result.dataKey
    this.unlocked()
    this.recheckSession()
    return 'ok'
  }

  /** Checks the PIN of the unlocked device (before changing it); a wrong one counts (rule 3). */
  async verifyPin(pin: string): Promise<PinCheck> {
    return (await this.checkPin(pin)).check
  }

  /** Rule 4: the unlocked data key, wrapped by the new PIN (with a new salt). */
  async changePin(newPin: string): Promise<void> {
    const meta = this.meta()
    if (!meta || !this.dataKey) {
      throw new Error('Changing the PIN needs an unlocked device')
    }
    await this.storeMeta({ ...meta, key: await wrapDataKey(this.dataKey, newPin) })
  }

  /** Rule 2: saves, then forgets the key and the decrypted database. */
  async lock(): Promise<void> {
    if (this.state() !== 'unlocked') {
      return
    }
    await this.save()
    this.closeDatabase()
    this.state.set('locked')
  }

  /** Rules 3 and 7, and "turn offline off": deletes everything this device stored. */
  async wipe(): Promise<void> {
    this.closeDatabase()
    await vaultStorage.wipe()
    this.meta.set(null)
    this.reading = Promise.resolve(null)
    this.state.set('none')
    this.releaseTab?.()
    this.releaseTab = null
  }

  /** Rule 7, a different user signed in: their data must never meet the previous user's. */
  belongsToSomeoneElse(): boolean {
    const meta = this.meta()
    const user = this.authStore.user()
    return meta !== null && user !== null && meta.userId !== user.id
  }

  /**
   * Rule 2, one tab at a time: holds the `tpn-local-db` Web Lock while this tab runs the app.
   * `false` when another tab has it.
   */
  async claimTab(): Promise<boolean> {
    const locks = this.window?.navigator.locks
    if (this.releaseTab || !locks) {
      return true
    }
    return new Promise((resolve) => {
      void locks.request(TAB_LOCK, { ifAvailable: true }, async (lock) => {
        if (!lock) {
          this.state.set('elsewhere')
          resolve(false)
          return
        }
        resolve(true)
        await new Promise<void>((release) => {
          this.releaseTab = release
        })
      })
    })
  }

  /** "Use here": the other tab saves, locks and lets go, then this tab holds the lock. */
  async takeOver(): Promise<void> {
    const locks = this.window?.navigator.locks
    if (!locks) {
      return
    }
    const acquired = new Promise<void>((resolve) => {
      void locks.request(TAB_LOCK, async () => {
        resolve()
        await new Promise<void>((release) => {
          this.releaseTab = release
        })
      })
    })
    this.channel?.postMessage('takeover')
    await acquired
    this.state.set(this.meta() ? 'locked' : 'none')
  }

  /** Online again (or just unlocked): retry a refresh that couldn't reach the API. */
  recheckSession(): void {
    if (this.authStore.status() === 'unreachable' && (this.window?.navigator.onLine ?? true)) {
      this.authService.refresh().catch(() => undefined)
    }
  }

  /** Saves the snapshot; calls during a save are coalesced into one more save (rule 8). */
  async save(): Promise<void> {
    this.saveRequests++
    if (this.saving) {
      return this.saving
    }
    this.saving = this.saveLoop().finally(() => {
      this.saving = null
    })
    return this.saving
  }

  private async saveLoop(): Promise<void> {
    for (;;) {
      const requests = this.saveRequests
      if (!this.database || !this.dataKey) {
        return
      }
      await vaultStorage.writeSnapshot(await seal(this.dataKey, this.database.export()))
      if (this.saveRequests === requests) {
        return
      }
    }
  }

  private async checkPin(
    pin: string
  ): Promise<{ check: 'ok'; dataKey: CryptoKey } | { check: 'wrong' | 'wiped' }> {
    const meta = this.meta() ?? (await this.ready())
    if (!meta) {
      return { check: 'wiped' }
    }
    const dataKey = await unwrapDataKey(meta.key, pin)
    if (dataKey) {
      if (meta.failedAttempts > 0) {
        await this.storeMeta({ ...meta, failedAttempts: 0 })
      }
      return { check: 'ok', dataKey }
    }
    const failedAttempts = meta.failedAttempts + 1
    if (failedAttempts >= MAX_PIN_ATTEMPTS) {
      await this.wipe()
      // Rule 3: the session goes too, so a wiped device can't simply walk back in online.
      await this.authService.signOutOrLater().catch(() => undefined)
      return { check: 'wiped' }
    }
    await this.storeMeta({ ...meta, failedAttempts })
    return { check: 'wrong' }
  }

  private async storeMeta(meta: VaultMeta): Promise<void> {
    await vaultStorage.writeMeta(meta)
    this.meta.set(meta)
  }

  private unlocked(): void {
    this.state.set('unlocked')
    this.authStore.keepsLocalSession.set(true)
    this.lastActivity = Date.now()
  }

  private closeDatabase(): void {
    this.database?.close()
    this.database = null
    this.dataKey = null
    this.authStore.keepsLocalSession.set(false)
  }

  private async wipeAndSignIn(): Promise<void> {
    await this.wipe()
    await this.router.navigateByUrl(SIGN_IN_URL, { replaceUrl: true })
  }

  /** Another tab asked to take over: save, lock, let go of the tab lock. */
  private async handOver(): Promise<void> {
    if (!this.releaseTab) {
      return
    }
    await this.lock()
    this.releaseTab()
    this.releaseTab = null
    this.state.set('elsewhere')
    await this.router.navigate([OTHER_TAB_URL], { queryParams: { returnUrl: this.returnUrl() } })
  }

  /** Rule 2: locks after 5 minutes in the background or without a tap or key press. */
  private watchActivity(): void {
    const window = this.window
    if (!window) {
      return
    }
    const touch = () => {
      this.lastActivity = Date.now()
    }
    window.document.addEventListener('pointerdown', touch, { capture: true, passive: true })
    window.document.addEventListener('keydown', touch, { capture: true, passive: true })
    window.document.addEventListener('visibilitychange', () => {
      if (window.document.visibilityState === 'hidden') {
        this.hiddenAt = Date.now()
        void this.save()
        return
      }
      const away = this.hiddenAt === null ? 0 : Date.now() - this.hiddenAt
      this.hiddenAt = null
      if (away >= LOCK_AFTER_MS) {
        void this.lockAndShow()
      } else {
        touch()
      }
    })
    window.addEventListener('pagehide', () => void this.save())
    window.addEventListener('online', () => this.recheckSession())
    window.setInterval(() => {
      if (this.hiddenAt === null && Date.now() - this.lastActivity >= LOCK_AFTER_MS) {
        void this.lockAndShow()
      }
    }, IDLE_CHECK_MS)
  }

  private async lockAndShow(): Promise<void> {
    if (this.state() !== 'unlocked') {
      return
    }
    const returnUrl = this.returnUrl()
    await this.lock()
    await this.router.navigate([LOCK_URL], { queryParams: { returnUrl } })
  }

  private returnUrl(): string | undefined {
    const url = this.router.url
    return url === '/' || url.startsWith('/auth/') ? undefined : url
  }
}
