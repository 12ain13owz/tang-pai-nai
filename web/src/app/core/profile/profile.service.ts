import { computed, DOCUMENT, effect, inject, Service, signal, untracked } from '@angular/core'
import { TranslocoService } from '@jsverse/transloco'
import { toast } from '@spartan-ng/brain/sonner'
import { AuthStore } from '@/core/auth'
import { LanguageService } from '@/core/i18n'
import { NetworkStatusService } from '@/core/network'
import {
  deleteOp,
  findOp,
  fromSql,
  listOps,
  OfflineService,
  queueWrite,
  SyncService,
  uuidv7,
} from '@/core/offline'
import type { LocalDatabase, OutboxOp } from '@/core/offline'
import { defaultCategoryRows } from './default-categories'
import {
  DEFAULT_CATEGORY_TABLE,
  PROFILE_CHILD_TABLES,
  PROFILE_KEY_PREFIX,
  PROFILE_LIMITS,
  PROFILE_TABLE,
} from './profile.type'
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
  private languageService = inject(LanguageService)

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
  /** Whether the switch sheet (layout/profile-switch-sheet) is open: the header and Account › หมวดหมู่ open it. */
  switchSheet = signal(false)

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
    // Wallet rule 11: a profile deleted on a device that didn't know all its wallets leaves live
    // ones behind; whichever device sees that tombstones the ones it holds.
    effect(() => {
      this.offlineService.changes()
      if (!this.canWrite()) {
        return
      }
      untracked(() => {
        const db = this.offlineService.db()
        if (PROFILE_CHILD_TABLES.some((table) => this.orphans(db, table).length > 0)) {
          this.offlineService.write((tx) => this.tombstoneChildren(tx, null, Date.now()))
        }
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
      // Category rule 8: a profile made here comes with the default set, in the same write.
      // A fixed refused create gets its refused child rows back instead (category rule 12).
      if (!current && !fixOpId) {
        const language = this.languageService.language().id
        for (const row of defaultCategoryRows(rowId, language, now, () => uuidv7())) {
          queueWrite(db, DEFAULT_CATEGORY_TABLE, 'upsert', row)
        }
      }
      if (fixOpId) {
        // Category rule 12: the refused create's child rows go again, after the profile.
        for (const child of this.refusedChildrenIn(db, fixOpId)) {
          queueWrite(db, child.table, 'upsert', {
            ...child.row,
            id: child.rowId,
            profileId: rowId,
            updatedAt: now,
            deletedAt: null,
          })
          deleteOp(db, child.opId)
        }
        deleteOp(db, fixOpId)
      }
    })
    if (isNew) {
      this.select(rowId)
    }
    return rowId
  }

  /** Rule 8: a tombstone, with its wallets' (and from #8 their transactions') in one write. */
  remove(id: string): void {
    const now = Date.now()
    if (this.current()?.id === id) {
      this.deletingHere.add(id)
    }
    this.offlineService.write((db) => {
      const current = this.find(db, id)
      if (current) {
        this.tombstoneChildren(db, id, now)
        queueWrite(db, PROFILE_TABLE, 'delete', { ...current, updatedAt: now, deletedAt: now })
      }
    })
  }

  /**
   * Category rule 12: the rejected creates of rows of `PROFILE_CHILD_TABLES` that went with a
   * rejected profile op (the profile was refused, so they were too). The sync sheet shows them
   * under the profile; fixing the profile sends them again, discarding it drops them.
   */
  refusedChildren(profileOpId: string): OutboxOp[] {
    this.offlineService.changes()
    return this.offlineService.isOpen()
      ? this.refusedChildrenIn(this.offlineService.db(), profileOpId)
      : []
  }

  /** Discards a rejected profile op with its refused child rows (category rule 12). */
  discardRefused(profileOpId: string): void {
    this.offlineService.write((db) => {
      for (const child of this.refusedChildrenIn(db, profileOpId)) {
        deleteOp(db, child.opId)
      }
      deleteOp(db, profileOpId)
    })
  }

  /** How many live wallets go with the profile (the delete confirm, rule 8). */
  walletCount(id: string): number {
    this.offlineService.changes()
    if (!this.offlineService.isOpen()) {
      return 0
    }
    return Number(
      this.offlineService
        .db()
        .selectValue(`SELECT count(*) FROM wallets WHERE profile_id = ? AND deleted_at IS NULL`, [
          id,
        ])
    )
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

  /**
   * Tombstones the live child rows of `profileId`, or (null) of every deleted profile on the
   * device (wallet rule 11).
   */
  private tombstoneChildren(db: LocalDatabase, profileId: string | null, now: number): void {
    for (const table of PROFILE_CHILD_TABLES) {
      const rows =
        profileId === null
          ? this.orphans(db, table)
          : db
              .selectObjects(`SELECT * FROM ${table} WHERE profile_id = ? AND deleted_at IS NULL`, [
                profileId,
              ])
              .map((row) => fromSql(table, row))
      for (const row of rows) {
        queueWrite(db, table, 'delete', {
          ...row,
          id: String(row['id']),
          updatedAt: now,
          deletedAt: now,
        })
      }
    }
  }

  private refusedChildrenIn(db: LocalDatabase, profileOpId: string): OutboxOp[] {
    const op = findOp(db, profileOpId)
    if (!op || op.table !== PROFILE_TABLE || op.status !== 'rejected' || op.op !== 'upsert') {
      return []
    }
    // Only a refused create: the server has no such profile, so the device has no row left.
    if (this.find(db, op.rowId)) {
      return []
    }
    const tables: readonly string[] = PROFILE_CHILD_TABLES
    return listOps(db, 'rejected').filter(
      (child) =>
        tables.includes(child.table) && child.op === 'upsert' && child.row['profileId'] === op.rowId
    )
  }

  /** Live rows of `table` whose profile is a tombstone here. */
  private orphans(db: LocalDatabase, table: string): Record<string, unknown>[] {
    return db
      .selectObjects(
        `SELECT c.* FROM ${table} c JOIN ${PROFILE_TABLE} p ON p.id = c.profile_id
         WHERE c.deleted_at IS NULL AND p.deleted_at IS NOT NULL`
      )
      .map((row) => fromSql(table, row))
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
