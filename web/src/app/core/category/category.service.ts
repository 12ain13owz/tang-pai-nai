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
import {
  cleanHidden,
  RECURRING_TABLE,
  toWallet,
  tombstoneRules,
  TRANSACTION_TABLE,
  WALLET_TABLE,
} from '@/core/wallet'
import { followMerges, hasMergeLeftovers, moveTransactions } from './category-merge'
import { CATEGORY_LIMITS, CATEGORY_TABLE } from './category.type'
import type {
  Category,
  CategoryMergeMode,
  CategoryMergePlan,
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
  serverDown = this.profileService.serverDown

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
    // behind; whichever device sees that tombstones the ones it holds (or, for a merged parent,
    // merges them into its target, rule 15).
    effect(() => {
      this.offlineService.changes()
      if (!this.canWrite()) {
        return
      }
      untracked(() => {
        const db = this.offlineService.db()
        if (hasMergeLeftovers(db) || this.orphans(db).length > 0) {
          const now = Date.now()
          this.offlineService.write((tx) => {
            // Rule 15 first: children of a merged parent follow it instead of going.
            followMerges(tx, now)
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
    return this.toTree(this.categories(), type, archived)
  }

  /** `tree()` of any profile on this device (a wallet being fixed may be another profile's). */
  treeOf(profileId: string, type: CategoryType): CategoryNode[] {
    const categories =
      profileId === this.profileService.current()?.id
        ? this.categories()
        : this.ofProfile(profileId)
    return this.toTree(categories, type, false)
  }

  private toTree(categories: Category[], type: CategoryType, archived: boolean): CategoryNode[] {
    const all = categories.filter((category) => category.type === type)
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
   * `hiddenIn` (the form's "ใช้ในกระเป๋า", rule 13): the profile's open wallets that list this
   * category's own id; the ones that change are written in the same write. Null leaves them.
   */
  save(
    id: string | null,
    values: CategoryValues,
    fixOpId: string | null = null,
    profileId = this.currentProfileId(),
    hiddenIn: readonly string[] | null = null
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
      if (hiddenIn) {
        this.writeHiddenIn(db, owner, rowId, hiddenIn, now)
      }
      if (fixOpId) {
        deleteOp(db, fixOpId)
      }
    })
    return rowId
  }

  /** The profile's open wallets that list the category's own id (rule 13). */
  hiddenIn(categoryId: string, profileId: string): string[] {
    return this.read(
      (db) =>
        this.openWallets(db, profileId)
          .filter((wallet) => wallet.hiddenCategoryIds.includes(categoryId))
          .map((wallet) => wallet.id),
      []
    )
  }

  private writeHiddenIn(
    db: LocalDatabase,
    profileId: string,
    categoryId: string,
    hiddenIn: readonly string[],
    now: number
  ): void {
    for (const wallet of this.openWallets(db, profileId)) {
      const listed = wallet.hiddenCategoryIds.includes(categoryId)
      const wanted = hiddenIn.includes(wallet.id)
      if (listed === wanted) {
        continue
      }
      const ids = wanted
        ? [...wallet.hiddenCategoryIds, categoryId]
        : wallet.hiddenCategoryIds.filter((other) => other !== categoryId)
      queueWrite(db, WALLET_TABLE, 'upsert', {
        ...wallet,
        hiddenCategoryIds: cleanHidden(db, ids),
        updatedAt: now,
      })
    }
  }

  private openWallets(db: LocalDatabase, profileId: string) {
    return db
      .selectObjects(
        `SELECT * FROM ${WALLET_TABLE}
         WHERE profile_id = ? AND deleted_at IS NULL AND is_archived = 0`,
        [profileId]
      )
      .map((row) => toWallet(fromSql(WALLET_TABLE, row)))
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

  /** Rules 4 and 6: whether the category has live transactions (type fixed, archive only). */
  hasTransactions(id: string | null): boolean {
    if (id === null) {
      return false
    }
    return this.read(
      (db) =>
        db.selectValue(
          `SELECT EXISTS (SELECT 1 FROM ${TRANSACTION_TABLE} WHERE category_id = ? AND deleted_at IS NULL)`,
          [id]
        ) === 1,
      false
    )
  }

  /** Live recurring rules on the category: they fix its type (recurring rules 14–15). */
  ruleCount(id: string | null): number {
    if (id === null) {
      return 0
    }
    return this.read(
      (db) =>
        Number(
          db.selectValue(
            `SELECT count(*) FROM ${RECURRING_TABLE} WHERE category_id = ? AND deleted_at IS NULL`,
            [id]
          )
        ),
      0
    )
  }

  /** Rule 6: a tombstone, after the sheet's confirm view; only without live children or transactions. */
  remove(id: string): void {
    if (this.childrenOf(id).length > 0 || this.hasTransactions(id)) {
      return
    }
    const now = Date.now()
    this.offlineService.write((db) => {
      const current = this.find(db, id)
      if (current) {
        queueWrite(db, CATEGORY_TABLE, 'delete', { ...current, updatedAt: now, deletedAt: now })
        // Recurring rule 14: its rules go with it, in the same write.
        tombstoneRules(db, 'category_id = ?', [id], now)
      }
    })
  }

  /** Rule 6's line and rule 15's confirm: how many live transactions a category holds. */
  transactionCount(id: string | null): number {
    if (id === null) {
      return 0
    }
    return this.read(
      (db) =>
        Number(
          db.selectValue(
            `SELECT count(*) FROM ${TRANSACTION_TABLE} WHERE category_id = ? AND deleted_at IS NULL`,
            [id]
          )
        ),
      0
    )
  }

  /**
   * Rule 15: the categories `id` may merge into, as a tree: every open category of its profile
   * and type, except itself and its own children. A sub-category's own parent comes first.
   */
  mergeTargets(id: string): CategoryNode[] {
    const source = this.byId(id)
    if (!source) {
      return []
    }
    const nodes = this.toTree(this.ofProfile(source.profileId), source.type, false)
      .filter((node) => node.category.id !== source.id)
      .map((node) => ({
        ...node,
        children: node.children.filter((child) => child.id !== source.id),
      }))
    const own = nodes.findIndex((node) => node.category.id === source.parentId)
    return own > 0 ? [nodes[own], ...nodes.filter((_, index) => index !== own)] : nodes
  }

  /** Rule 15: what merging `sourceId` into `targetId` would do; null when it can't. */
  mergePlan(sourceId: string, targetId: string, mode: CategoryMergeMode): CategoryMergePlan | null {
    return this.read((db) => {
      const steps = this.mergeSteps(db, sourceId, targetId, mode)
      if (!steps) {
        return null
      }
      const count = (id: string) =>
        Number(
          db.selectValue(
            `SELECT count(*) FROM ${TRANSACTION_TABLE} WHERE category_id = ? AND deleted_at IS NULL`,
            [id]
          )
        )
      const mergedIntoTarget = steps.merges.filter((merge) => merge.into === targetId)
      return {
        transactions: [sourceId, ...mergedIntoTarget.map((merge) => merge.child.id)]
          .map(count)
          .reduce((sum, value) => sum + value, 0),
        moved: steps.moves.length + (mode === 'move' ? steps.merges.length : 0),
        clashes: mode === 'move' ? steps.merges.length : 0,
        merged: mode === 'all' ? steps.merges.length : 0,
        parentId: steps.parentId,
      }
    }, null)
  }

  /**
   * Rule 15: merges `sourceId` into `targetId` in one local write, with no undo (the sheet asks
   * first). Children move under the target (or its parent) or merge in; transactions move (a
   * row with a pending op gets its op rewritten, the others change here only: the server makes
   * the same move when the tombstone lands); merged ids leave the wallets' lists; the merged
   * categories become tombstones with `mergedIntoId`, pushed last. Whether it merged.
   */
  merge(sourceId: string, targetId: string, mode: CategoryMergeMode): boolean {
    if (!this.canWrite()) {
      return false
    }
    const now = Date.now()
    let merged = false
    this.offlineService.write((db) => {
      const steps = this.mergeSteps(db, sourceId, targetId, mode)
      if (!steps) {
        return
      }
      let sortOrder = this.nextSortOrder(
        db,
        steps.source.profileId,
        steps.source.type,
        steps.parentId
      )
      for (const child of steps.moves) {
        queueWrite(db, CATEGORY_TABLE, 'upsert', {
          ...child,
          parentId: steps.parentId,
          sortOrder: sortOrder++,
          updatedAt: now,
        })
        moveOpLast(db, CATEGORY_TABLE, child.id)
      }
      const gone = [...steps.merges.map((merge) => merge.child.id), sourceId]
      this.dropHidden(db, steps.source.profileId, gone, now)
      for (const { child, into } of [...steps.merges, { child: steps.source, into: targetId }]) {
        moveTransactions(db, child.id, into, now)
        queueWrite(db, CATEGORY_TABLE, 'upsert', {
          ...child,
          mergedIntoId: into,
          updatedAt: now,
          deletedAt: now,
        })
        moveOpLast(db, CATEGORY_TABLE, child.id)
      }
      merged = true
    })
    return merged
  }

  /** Rule 15's checks and plan: which children move under `parentId`, which merge where. */
  private mergeSteps(
    db: LocalDatabase,
    sourceId: string,
    targetId: string,
    mode: CategoryMergeMode
  ): {
    source: Category
    parentId: string
    moves: Category[]
    merges: { child: Category; into: string }[]
  } | null {
    const source = this.find(db, sourceId)
    const target = this.find(db, targetId)
    if (
      !source ||
      !target ||
      source.deletedAt !== null ||
      target.deletedAt !== null ||
      target.isArchived ||
      source.id === target.id ||
      target.parentId === source.id ||
      source.profileId !== target.profileId ||
      source.type !== target.type
    ) {
      return null
    }
    const parentId = target.parentId ?? target.id
    const children = this.liveChildren(db, source.id)
    if (mode === 'all') {
      return {
        source,
        parentId,
        moves: [],
        merges: children.map((child) => ({ child, into: target.id })),
      }
    }
    // An open child whose name is taken there merges into that one instead (rule 2).
    const taken = new Map(
      this.liveChildren(db, parentId)
        .filter((child) => !child.isArchived)
        .map((child) => [child.name.toLowerCase(), child.id])
    )
    const moves: Category[] = []
    const merges: { child: Category; into: string }[] = []
    for (const child of children) {
      const clash = child.isArchived ? undefined : taken.get(child.name.toLowerCase())
      if (clash) {
        merges.push({ child, into: clash })
      } else {
        moves.push(child)
        if (!child.isArchived) {
          taken.set(child.name.toLowerCase(), child.id)
        }
      }
    }
    return { source, parentId, moves, merges }
  }

  private liveChildren(db: LocalDatabase, parentId: string): Category[] {
    return db
      .selectObjects(
        `SELECT * FROM ${CATEGORY_TABLE} WHERE parent_id = ? AND deleted_at IS NULL ${ORDER}`,
        [parentId]
      )
      .map((row) => fromSql(CATEGORY_TABLE, row) as unknown as Category)
  }

  /** Rule 15: merged ids leave every live wallet's `hiddenCategoryIds` of the profile. */
  private dropHidden(db: LocalDatabase, profileId: string, ids: string[], now: number): void {
    const wallets = db
      .selectObjects(`SELECT * FROM ${WALLET_TABLE} WHERE profile_id = ? AND deleted_at IS NULL`, [
        profileId,
      ])
      .map((row) => toWallet(fromSql(WALLET_TABLE, row)))
    for (const wallet of wallets) {
      const kept = wallet.hiddenCategoryIds.filter((id) => !ids.includes(id))
      if (kept.length !== wallet.hiddenCategoryIds.length) {
        queueWrite(db, WALLET_TABLE, 'upsert', {
          ...wallet,
          hiddenCategoryIds: kept,
          updatedAt: now,
        })
      }
    }
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
