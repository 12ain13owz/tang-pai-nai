import { computed, effect, inject, Service, signal, untracked } from '@angular/core'
import {
  deleteOp,
  fromSql,
  moveOpLast,
  OfflineService,
  queueWrite,
  SyncService,
  uuidv7,
} from '@/core/offline'
import type { LocalDatabase } from '@/core/offline'
import { ProfileService } from '@/core/profile'
import { CATEGORY_LIMITS, CATEGORY_TABLE } from './category.type'
import type {
  Category,
  CategoryNode,
  CategorySheetState,
  CategoryType,
  CategoryUnarchiveRefusal,
  CategoryValues,
} from './category.type'

const ORDER = 'ORDER BY sort_order, created_at, id'

/**
 * The current profile's categories on this device (docs/features/category.md). Reads come from
 * the local database; every write goes through the outbox like any own data.
 */
@Service()
export class CategoryService {
  private offlineService = inject(OfflineService)
  private syncService = inject(SyncService)
  private profileService = inject(ProfileService)

  /** The current profile's live categories in order (rule 10), archived ones included. */
  categories = computed(() => {
    const profileId = this.profileService.current()?.id
    return profileId ? this.ofProfile(profileId) : []
  })
  /** Open categories (rule 11 counts them). */
  openCategories = computed(() => this.categories().filter((category) => !category.isArchived))
  atLimit = computed(() => this.openCategories().length >= CATEGORY_LIMITS.PER_PROFILE)
  canWrite = this.profileService.canWrite

  /** Categories with an op still waiting to sync ("รอ sync"). */
  pendingIds = computed(
    () =>
      new Set(
        this.read(
          (db) =>
            db
              .selectObjects(`SELECT row_id FROM outbox WHERE tbl = ? AND status = 'pending'`, [
                CATEGORY_TABLE,
              ])
              .map((row) => String(row['row_id'])),
          []
        )
      )
  )

  /** The open category sheet (layout/category-sheet), if any. */
  sheet = signal<CategorySheetState | null>(null)

  constructor() {
    // Rule 6: a parent deleted on a device that didn't know all its children leaves live ones
    // behind; whichever device sees that tombstones the ones it holds.
    effect(() => {
      this.offlineService.changes()
      if (!this.canWrite()) {
        return
      }
      untracked(() => {
        const db = this.offlineService.db()
        if (this.orphans(db).length > 0) {
          const now = Date.now()
          this.offlineService.write((tx) => {
            for (const row of this.orphans(tx)) {
              queueWrite(tx, CATEGORY_TABLE, 'delete', { ...row, updatedAt: now, deletedAt: now })
            }
          })
        }
      })
    })
  }

  /** The open (or archived) tree of one type: parents with their children, in order. */
  tree(type: CategoryType, archived = false): CategoryNode[] {
    const all = this.categories().filter((category) => category.type === type)
    return all
      .filter((category) => category.parentId === null && category.isArchived === archived)
      .map((category) => ({
        category,
        children: all.filter(
          (child) => child.parentId === category.id && child.isArchived === archived
        ),
      }))
  }

  /** Archived children of open parents: shown in the archived group on their own. */
  archivedChildren(type: CategoryType): Category[] {
    const byId = new Map(this.categories().map((category) => [category.id, category]))
    return this.categories().filter(
      (category) =>
        category.type === type &&
        category.isArchived &&
        category.parentId !== null &&
        byId.get(category.parentId)?.isArchived === false
    )
  }

  /** How many open categories of each type (the tab labels). */
  openCount(type: CategoryType): number {
    return this.openCategories().filter((category) => category.type === type).length
  }

  /** Open top-level categories of `type`: the parents a category can go under (rule 3). */
  parents(type: CategoryType, exceptId: string | null = null): Category[] {
    return this.openCategories().filter(
      (category) => category.type === type && category.parentId === null && category.id !== exceptId
    )
  }

  /** Live children of a category, archived ones included. */
  childrenOf(id: string): Category[] {
    return this.categories().filter((category) => category.parentId === id)
  }

  byId(id: string): Category | null {
    this.offlineService.changes()
    if (!this.offlineService.isOpen()) {
      return null
    }
    const category = this.find(this.offlineService.db(), id)
    return category?.deletedAt === null ? category : null
  }

  /** Rule 2 as far as this device knows: among the open siblings. */
  nameTaken(
    name: string,
    type: CategoryType,
    parentId: string | null,
    exceptId: string | null,
    profileId = this.currentProfileId()
  ): boolean {
    const wanted = name.trim().toLowerCase()
    return this.ofProfile(profileId).some(
      (category) =>
        !category.isArchived &&
        category.id !== exceptId &&
        category.type === type &&
        category.parentId === parentId &&
        category.name.toLowerCase() === wanted
    )
  }

  open(state: CategorySheetState): void {
    this.sheet.set(state)
  }

  /** "Fix" from the sync sheet: the refused values of a rejected category op. */
  openFix(opId: string): void {
    const op = this.syncService.rejectedOp(opId)
    if (!op || op.table !== CATEGORY_TABLE) {
      return
    }
    const row = op.row
    const text = (key: string) => (typeof row[key] === 'string' ? row[key] : '')
    const profileId = text('profileId')
    const parentId = text('parentId')
    // A refused category of a profile that is gone is saved into the current one, and a parent
    // that is gone or archived here is dropped (rules 1, 3).
    const live = this.profileService.byId(profileId)
    const parent = parentId ? this.byId(parentId) : null
    this.open({
      mode: 'fix',
      opId,
      id: op.rowId,
      profileId: live ? profileId : (this.profileService.current()?.id ?? profileId),
      values: {
        name: text('name'),
        icon: text('icon'),
        color: text('color'),
        type: row['type'] === 'income' ? 'income' : 'expense',
        parentId: live && parent && !parent.isArchived ? parentId : null,
      },
    })
  }

  /**
   * Creates (`id` null) or updates a category in `profileId` (the current profile by default); a
   * fix also drops the rejected op. A category that changes siblings goes last among the new ones.
   */
  save(
    id: string | null,
    values: CategoryValues,
    fixOpId: string | null = null,
    profileId = this.currentProfileId()
  ): string {
    const now = Date.now()
    const rowId = id ?? uuidv7(now)
    this.offlineService.write((db) => {
      const current = this.find(db, rowId)
      const live = current?.deletedAt === null ? current : null
      const owner = live?.profileId ?? profileId
      const sameSiblings =
        live !== null && live.type === values.type && live.parentId === values.parentId
      queueWrite(db, CATEGORY_TABLE, 'upsert', {
        ...current,
        id: rowId,
        // Rule 1: a category never moves to another profile.
        profileId: owner,
        type: values.type,
        parentId: values.parentId,
        name: values.name.trim(),
        icon: values.icon,
        color: values.color,
        isArchived: live?.isArchived ?? false,
        sortOrder: sameSiblings
          ? live.sortOrder
          : this.nextSortOrder(db, owner, values.type, values.parentId),
        createdAt: current?.createdAt ?? now,
        updatedAt: now,
        deletedAt: null,
      })
      // Pushed after its parent, which may have been made after it (rule 3).
      if (values.parentId !== null) {
        moveOpLast(db, CATEGORY_TABLE, rowId)
      }
      if (fixOpId) {
        deleteOp(db, fixOpId)
      }
    })
    return rowId
  }

  /**
   * Rule 7: archive (a parent takes its open children along), or bring back (a parent brings its
   * children whose names are free). Coming back needs a free name, a place among the 200 and an
   * open parent; the refusal says which.
   */
  setArchived(id: string, archived: boolean): CategoryUnarchiveRefusal | null {
    const category = this.byId(id)
    if (!category || category.isArchived === archived) {
      return null
    }
    const children = this.childrenOf(id).filter((child) => child.isArchived !== archived)
    if (!archived) {
      const refusal = this.unarchiveRefusal(category)
      if (refusal) {
        return refusal
      }
    }
    const now = Date.now()
    this.offlineService.write((db) => {
      queueWrite(db, CATEGORY_TABLE, 'upsert', {
        ...category,
        isArchived: archived,
        updatedAt: now,
      })
      let open = this.openCategories().length + 1
      for (const child of children) {
        const back = !archived
        if (
          back &&
          (open >= CATEGORY_LIMITS.PER_PROFILE ||
            this.nameTaken(child.name, child.type, child.parentId, child.id, child.profileId))
        ) {
          continue
        }
        queueWrite(db, CATEGORY_TABLE, 'upsert', { ...child, isArchived: archived, updatedAt: now })
        if (back) {
          // After the parent's own unarchive (rule 7).
          moveOpLast(db, CATEGORY_TABLE, child.id)
          open++
        }
      }
    })
    return null
  }

  /** Rule 6: a tombstone, after the sheet's confirm view; only without live children. */
  remove(id: string): void {
    if (this.childrenOf(id).length > 0) {
      return
    }
    const now = Date.now()
    this.offlineService.write((db) => {
      const current = this.find(db, id)
      if (current) {
        queueWrite(db, CATEGORY_TABLE, 'delete', { ...current, updatedAt: now, deletedAt: now })
      }
    })
  }

  /** Rule 10: moves an open category to `to` among its open siblings; rewrites `sortOrder`. */
  moveTo(id: string, to: number): void {
    const category = this.byId(id)
    if (!category) {
      return
    }
    const siblings = this.categories().filter(
      (other) => other.type === category.type && other.parentId === category.parentId
    )
    const open = siblings.filter((other) => !other.isArchived)
    const from = open.findIndex((other) => other.id === id)
    if (from < 0 || to < 0 || to >= open.length || from === to) {
      return
    }
    const [moved] = open.splice(from, 1)
    open.splice(to, 0, moved)
    // Archived siblings keep their places after the open ones.
    const ordered = [...open, ...siblings.filter((other) => other.isArchived)]
    const now = Date.now()
    this.offlineService.write((db) => {
      ordered.forEach((other, index) => {
        if (other.sortOrder !== index) {
          queueWrite(db, CATEGORY_TABLE, 'upsert', { ...other, sortOrder: index, updatedAt: now })
        }
      })
    })
  }

  private unarchiveRefusal(category: Category): CategoryUnarchiveRefusal | null {
    if (category.parentId !== null && this.byId(category.parentId)?.isArchived !== false) {
      return 'parentArchived'
    }
    if (
      this.nameTaken(
        category.name,
        category.type,
        category.parentId,
        category.id,
        category.profileId
      )
    ) {
      return 'nameTaken'
    }
    if (this.openCategories().length >= CATEGORY_LIMITS.PER_PROFILE) {
      return 'limit'
    }
    return null
  }

  private currentProfileId(): string {
    const profileId = this.profileService.current()?.id
    if (!profileId) {
      // The shell shows the create step before any category screen (profile rule 5).
      throw new Error('No current profile')
    }
    return profileId
  }

  /** A profile's live categories in order. */
  private ofProfile(profileId: string): Category[] {
    return this.read(
      (db) =>
        db
          .selectObjects(
            `SELECT * FROM ${CATEGORY_TABLE} WHERE profile_id = ? AND deleted_at IS NULL ${ORDER}`,
            [profileId]
          )
          .map((row) => fromSql(CATEGORY_TABLE, row) as unknown as Category),
      []
    )
  }

  /** A new category goes last among its siblings (rule 10). */
  private nextSortOrder(
    db: LocalDatabase,
    profileId: string,
    type: CategoryType,
    parentId: string | null
  ): number {
    const max = db.selectValue(
      `SELECT max(sort_order) FROM ${CATEGORY_TABLE}
       WHERE profile_id = ? AND type = ? AND parent_id IS ? AND deleted_at IS NULL`,
      [profileId, type, parentId]
    )
    return typeof max === 'number' ? max + 1 : 0
  }

  /** Live children whose parent is a tombstone here (rule 6). */
  private orphans(db: LocalDatabase): Category[] {
    return db
      .selectObjects(
        `SELECT c.* FROM ${CATEGORY_TABLE} c JOIN ${CATEGORY_TABLE} p ON p.id = c.parent_id
         WHERE c.deleted_at IS NULL AND p.deleted_at IS NOT NULL`
      )
      .map((row) => fromSql(CATEGORY_TABLE, row) as unknown as Category)
  }

  private find(db: LocalDatabase, id: string): Category | null {
    const row = db.selectObjects(`SELECT * FROM ${CATEGORY_TABLE} WHERE id = ?`, [id]).at(0)
    return row ? (fromSql(CATEGORY_TABLE, row) as unknown as Category) : null
  }

  private read<T>(work: (db: LocalDatabase) => T, fallback: T): T {
    this.offlineService.changes()
    return this.offlineService.isOpen() ? work(this.offlineService.db()) : fallback
  }
}
