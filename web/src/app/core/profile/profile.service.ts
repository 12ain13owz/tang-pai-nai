import { computed, DOCUMENT, effect, inject, Service, signal, untracked } from '@angular/core'
import { TranslocoService } from '@jsverse/transloco'
import { toast } from '@spartan-ng/brain/sonner'
import { AuthStore } from '@/core/auth'
import { NetworkStatusService } from '@/core/network'
import { deleteOp, fromSql, OfflineService, queueWrite, SyncService, uuidv7 } from '@/core/offline'
import type { LocalDatabase } from '@/core/offline'
import { PROFILE_KEY_PREFIX, PROFILE_LIMITS, PROFILE_TABLE } from './profile.type'
import type { Profile, ProfileSheetState, ProfileValues } from './profile.type'

const ORDER = 'ORDER BY sort_order, created_at, id'

/**
 * The user's profiles on this device and the current one (docs/features/profile.md). Reads come
 * from the local database; every write goes through the outbox like any own data.
 */
@Service()
export class ProfileService {
  private window = inject(DOCUMENT).defaultView
  private transloco = inject(TranslocoService)
  private authStore = inject(AuthStore)
  private networkStatusService = inject(NetworkStatusService)
  private offlineService = inject(OfflineService)
  private syncService = inject(SyncService)

  /** Live profiles in order (rule 7). */
  profiles = computed(() =>
    this.read(
      (db) =>
        db
          .selectObjects(`SELECT * FROM ${PROFILE_TABLE} WHERE deleted_at IS NULL ${ORDER}`)
          .map((row) => fromSql(PROFILE_TABLE, row) as unknown as Profile),
      []
    )
  )
  /** Profiles with an op still waiting to sync ("รอ sync"). */
  pendingIds = computed(
    () =>
      new Set(
        this.read(
          (db) =>
            db
              .selectObjects(`SELECT row_id FROM outbox WHERE tbl = ? AND status = 'pending'`, [
                PROFILE_TABLE,
              ])
              .map((row) => String(row['row_id'])),
          []
        )
      )
  )
  /** The device's current profile: the stored one while live, else the first (rule 6). */
  current = computed(() => {
    const profiles = this.profiles()
    return profiles.find((profile) => profile.id === this.storedId()) ?? profiles.at(0) ?? null
  })
  /**
   * Whether the device knows its profiles: false only while a new device waits for its first
   * pull, so the create step doesn't flash before the user's profiles arrive.
   */
  ready = computed(
    () =>
      this.offlineService.isOpen() &&
      (this.profiles().length > 0 ||
        this.syncService.lastSyncedAt() !== null ||
        this.roundEnded() ||
        !this.syncService.canSync())
  )
  /** Rule 10: an untrusted device writes only online (offline-sync rule 1). */
  canWrite = computed(
    () =>
      this.offlineService.isOpen() &&
      (this.offlineService.isTrusted() || this.networkStatusService.isOnline())
  )
  atLimit = computed(() => this.profiles().length >= PROFILE_LIMITS.PER_USER)
  /** The open profile sheet (layout/profile-sheet), if any. */
  sheet = signal<ProfileSheetState | null>(null)

  private storedId = signal<string | null>(null)
  private roundEnded = signal(false)
  private deletingHere = new Set<string>()

  private userId = computed(
    () => this.authStore.user()?.id ?? this.offlineService.meta()?.userId ?? null
  )

  constructor() {
    effect(() => {
      const userId = this.userId()
      const trusted = this.offlineService.isTrusted()
      untracked(() =>
        this.storedId.set(userId ? this.storage(trusted).getItem(this.key(userId)) : null)
      )
    })
    let wasSyncing = false
    effect(() => {
      const syncing = this.syncService.isSyncing()
      if (wasSyncing && !syncing) {
        this.roundEnded.set(true)
      }
      wasSyncing = syncing
    })
    // Rule 9: the current profile was deleted on another device.
    effect(() => {
      const storedId = this.storedId()
      this.offlineService.changes()
      if (!storedId || !this.offlineService.isOpen()) {
        return
      }
      untracked(() => {
        const row = this.find(this.offlineService.db(), storedId)
        if (!row || row.deletedAt === null) {
          return
        }
        if (!this.deletingHere.delete(storedId)) {
          toast(this.transloco.translate('profiles.deletedElsewhere', { name: row.name }))
        }
        this.select(this.current()?.id ?? null)
      })
    })
  }

  open(state: ProfileSheetState): void {
    this.sheet.set(state)
  }

  /** "Fix" from the sync sheet: the refused values of a rejected profile op. */
  openFix(opId: string): void {
    const op = this.syncService.rejectedOp(opId)
    if (!op || op.table !== PROFILE_TABLE) {
      return
    }
    const text = (key: string) => (typeof op.row[key] === 'string' ? op.row[key] : '')
    this.open({
      mode: 'fix',
      opId,
      id: op.rowId,
      values: { name: text('name'), icon: text('icon'), color: text('color') },
    })
  }

  byId(id: string): Profile | null {
    return this.profiles().find((profile) => profile.id === id) ?? null
  }

  select(id: string | null): void {
    const userId = this.userId()
    this.storedId.set(id)
    if (!userId) {
      return
    }
    const storage = this.storage(this.offlineService.isTrusted())
    if (id) {
      storage.setItem(this.key(userId), id)
    } else {
      storage.removeItem(this.key(userId))
    }
  }

  /** Rule 2 as far as this device knows. */
  nameTaken(name: string, exceptId: string | null): boolean {
    const wanted = name.trim().toLowerCase()
    return this.profiles().some(
      (profile) => profile.id !== exceptId && profile.name.toLowerCase() === wanted
    )
  }

  /** Creates (`id` null) or updates a profile; a fix also drops the rejected op. */
  save(id: string | null, values: ProfileValues, fixOpId: string | null = null): string {
    const now = Date.now()
    const rowId = id ?? uuidv7(now)
    const last = this.profiles().at(-1)
    // A new row (also a "fix" of a refused create, whose local row went away) becomes current.
    const isNew = this.byId(rowId) === null
    this.offlineService.write((db) => {
      const current = this.find(db, rowId)
      const live = current?.deletedAt === null ? current : null
      queueWrite(db, PROFILE_TABLE, 'upsert', {
        ...current,
        id: rowId,
        name: values.name.trim(),
        icon: values.icon,
        color: values.color,
        sortOrder: live?.sortOrder ?? (last ? last.sortOrder + 1 : 0),
        createdAt: current?.createdAt ?? now,
        updatedAt: now,
        deletedAt: null,
      })
      if (fixOpId) {
        deleteOp(db, fixOpId)
      }
    })
    if (isNew) {
      this.select(rowId)
    }
    return rowId
  }

  /** Rule 8: a tombstone (from #6.2 with the profile's wallets and transactions). */
  remove(id: string): void {
    const now = Date.now()
    if (this.current()?.id === id) {
      this.deletingHere.add(id)
    }
    this.offlineService.write((db) => {
      const current = this.find(db, id)
      if (current) {
        queueWrite(db, PROFILE_TABLE, 'delete', { ...current, updatedAt: now, deletedAt: now })
      }
    })
  }

  /** Rule 7: moves a profile to `to` (an index in the list); rewrites `sortOrder` where it changed. */
  moveTo(id: string, to: number): void {
    const profiles = [...this.profiles()]
    const from = profiles.findIndex((profile) => profile.id === id)
    if (from < 0 || to < 0 || to >= profiles.length || from === to) {
      return
    }
    const [moved] = profiles.splice(from, 1)
    profiles.splice(to, 0, moved)
    const now = Date.now()
    this.offlineService.write((db) => {
      profiles.forEach((profile, index) => {
        if (profile.sortOrder !== index) {
          queueWrite(db, PROFILE_TABLE, 'upsert', { ...profile, sortOrder: index, updatedAt: now })
        }
      })
    })
  }

  private find(db: LocalDatabase, id: string): Profile | null {
    const row = db.selectObjects(`SELECT * FROM ${PROFILE_TABLE} WHERE id = ?`, [id]).at(0)
    return row ? (fromSql(PROFILE_TABLE, row) as unknown as Profile) : null
  }

  private key(userId: string): string {
    return `${PROFILE_KEY_PREFIX}${userId}`
  }

  /** Rule 6: lasting on a trusted device, for the tab's life on an untrusted one. */
  private storage(trusted: boolean): Storage {
    const window = this.window
    if (!window) {
      return new MemoryStorage()
    }
    return trusted ? window.localStorage : window.sessionStorage
  }

  private read<T>(work: (db: LocalDatabase) => T, fallback: T): T {
    this.offlineService.changes()
    return this.offlineService.isOpen() ? work(this.offlineService.db()) : fallback
  }
}

/** Stand-in when there's no window (never in the browser). */
class MemoryStorage implements Storage {
  private items = new Map<string, string>()
  get length(): number {
    return this.items.size
  }
  clear(): void {
    this.items.clear()
  }
  getItem(key: string): string | null {
    return this.items.get(key) ?? null
  }
  key(index: number): string | null {
    return [...this.items.keys()][index] ?? null
  }
  removeItem(key: string): void {
    this.items.delete(key)
  }
  setItem(key: string, value: string): void {
    this.items.set(key, value)
  }
}
