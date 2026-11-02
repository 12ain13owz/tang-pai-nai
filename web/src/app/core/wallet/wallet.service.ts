import { computed, inject, Service, signal } from '@angular/core'
import { deleteOp, fromSql, OfflineService, queueWrite, SyncService, uuidv7 } from '@/core/offline'
import type { LocalDatabase } from '@/core/offline'
import { ProfileService } from '@/core/profile'
import { cleanHidden, findWallet, toWallet } from './hidden-categories'
import { DEFAULT_CURRENCY, WALLET_LIMITS, WALLET_TABLE } from './wallet.type'
import type {
  Currency,
  CurrencyTotal,
  UnarchiveRefusal,
  Wallet,
  WalletSheetState,
  WalletValues,
} from './wallet.type'

const ORDER = 'ORDER BY sort_order, created_at, id'

/**
 * The current profile's wallets on this device (docs/features/wallet.md). Reads come from the
 * local database; every write goes through the outbox like any own data.
 */
@Service()
export class WalletService {
  private offlineService = inject(OfflineService)
  private syncService = inject(SyncService)
  private profileService = inject(ProfileService)

  /** The current profile's live wallets in order (rule 10), archived ones included. */
  wallets = computed(() => {
    const profileId = this.profileService.current()?.id
    if (!profileId) {
      return []
    }
    return this.read(
      (db) =>
        db
          .selectObjects(
            `SELECT * FROM ${WALLET_TABLE} WHERE profile_id = ? AND deleted_at IS NULL ${ORDER}`,
            [profileId]
          )
          .map((row) => toWallet(fromSql(WALLET_TABLE, row))),
      []
    )
  })
  /** Wallets in use: the list, pickers, the total and the 20 (rules 3, 6). */
  openWallets = computed(() => this.wallets().filter((wallet) => !wallet.isArchived))
  archived = computed(() => this.wallets().filter((wallet) => wallet.isArchived))
  /** Rule 12: the first-wallet step shows while this is false. */
  hasWallet = computed(() => this.wallets().length > 0)
  atLimit = computed(() => this.openWallets().length >= WALLET_LIMITS.PER_PROFILE)
  canWrite = this.profileService.canWrite

  /** Wallets with an op still waiting to sync ("รอ sync"). */
  pendingIds = computed(
    () =>
      new Set(
        this.read(
          (db) =>
            db
              .selectObjects(`SELECT row_id FROM outbox WHERE tbl = ? AND status = 'pending'`, [
                WALLET_TABLE,
              ])
              .map((row) => String(row['row_id'])),
          []
        )
      )
  )

  /** Every pulled currency (inactive ones too, so an old wallet still formats). */
  currencies = computed(() =>
    this.read(
      (db) =>
        db.selectObjects('SELECT * FROM currencies ORDER BY sort_order, code').map((row) => {
          const currency = fromSql('currencies', row)
          return {
            code: String(currency['code']),
            minorUnit: Number(currency['minorUnit']),
            isActive: currency['isActive'] === true,
            sortOrder: Number(currency['sortOrder']),
          } satisfies Currency
        }),
      []
    )
  )
  activeCurrencies = computed(() => this.currencies().filter((currency) => currency.isActive))

  /** Rule 7: open wallets not excluded, one line per currency, in currency order. */
  totals = computed<CurrencyTotal[]>(() => {
    const sums = new Map<string, number>()
    for (const wallet of this.openWallets()) {
      if (!wallet.excludeFromTotal) {
        sums.set(wallet.currencyCode, (sums.get(wallet.currencyCode) ?? 0) + this.balance(wallet))
      }
    }
    const order = this.currencies().map((currency) => currency.code)
    return [...sums.entries()]
      .sort(([a], [b]) => order.indexOf(a) - order.indexOf(b) || a.localeCompare(b))
      .map(([currencyCode, amount]) => ({
        currencyCode,
        minorUnit: this.minorUnit(currencyCode),
        amount,
      }))
  })

  /** The open wallet sheet (layout/wallet-sheet), if any. */
  sheet = signal<WalletSheetState | null>(null)

  /** Computed, never stored: `initialBalance` until transactions arrive (#8). */
  balance(wallet: Wallet): number {
    return wallet.initialBalance
  }

  /** Digits after the decimal point; 2 for a code the device doesn't know. */
  minorUnit(code: string): number {
    return this.currencies().find((currency) => currency.code === code)?.minorUnit ?? 2
  }

  /** A new wallet's currency: THB when active, else the first active one (rule 4). */
  defaultCurrency(): string {
    const active = this.activeCurrencies()
    return (
      active.find((currency) => currency.code === DEFAULT_CURRENCY)?.code ??
      active.at(0)?.code ??
      DEFAULT_CURRENCY
    )
  }

  /** Rule 4: false once the wallet has transactions (#8); always true until then. */
  canChangeCurrency(_id: string | null): boolean {
    return true
  }

  open(state: WalletSheetState): void {
    this.sheet.set(state)
  }

  /** "Fix" from the sync sheet: the refused values of a rejected wallet op. */
  openFix(opId: string): void {
    const op = this.syncService.rejectedOp(opId)
    if (!op || op.table !== WALLET_TABLE) {
      return
    }
    const row = op.row
    const text = (key: string, fallback = '') =>
      typeof row[key] === 'string' ? row[key] : fallback
    // A refused wallet of a profile that is gone (rule 2) is saved into the current one.
    const profileId = text('profileId')
    const live = this.profileService.byId(profileId)
    this.open({
      mode: 'fix',
      opId,
      id: op.rowId,
      profileId: live ? profileId : (this.profileService.current()?.id ?? profileId),
      values: {
        name: text('name'),
        icon: text('icon'),
        color: text('color'),
        currencyCode: text('currencyCode', this.defaultCurrency()),
        initialBalance: typeof row['initialBalance'] === 'number' ? row['initialBalance'] : 0,
        excludeFromTotal: row['excludeFromTotal'] === true,
        hiddenCategoryIds: Array.isArray(row['hiddenCategoryIds'])
          ? row['hiddenCategoryIds'].filter((item): item is string => typeof item === 'string')
          : [],
      },
    })
  }

  /** A live wallet of any profile on this device. */
  byId(id: string): Wallet | null {
    this.offlineService.changes()
    if (!this.offlineService.isOpen()) {
      return null
    }
    const wallet = this.find(this.offlineService.db(), id)
    return wallet?.deletedAt === null ? wallet : null
  }

  /** Rule 3 as far as this device knows: among the profile's open wallets. */
  nameTaken(name: string, exceptId: string | null, profileId = this.currentProfileId()): boolean {
    const wanted = name.trim().toLowerCase()
    return this.openOf(profileId).some(
      (wallet) => wallet.id !== exceptId && wallet.name.toLowerCase() === wanted
    )
  }

  /**
   * Creates (`id` null) or updates a wallet in `profileId` (the current profile by default); a
   * fix also drops the rejected op.
   */
  save(
    id: string | null,
    values: WalletValues,
    fixOpId: string | null = null,
    profileId = this.currentProfileId()
  ): string {
    const now = Date.now()
    const rowId = id ?? uuidv7(now)
    this.offlineService.write((db) => {
      const current = this.find(db, rowId)
      const live = current?.deletedAt === null ? current : null
      queueWrite(db, WALLET_TABLE, 'upsert', {
        ...current,
        id: rowId,
        // Rule 2: a wallet never moves to another profile.
        profileId: live?.profileId ?? profileId,
        name: values.name.trim(),
        icon: values.icon,
        color: values.color,
        currencyCode: values.currencyCode,
        initialBalance: values.initialBalance,
        excludeFromTotal: values.excludeFromTotal,
        hiddenCategoryIds: cleanHidden(db, values.hiddenCategoryIds),
        isArchived: live?.isArchived ?? false,
        sortOrder: live?.sortOrder ?? this.nextSortOrder(db, profileId),
        createdAt: current?.createdAt ?? now,
        updatedAt: now,
        deletedAt: null,
      })
      if (fixOpId) {
        deleteOp(db, fixOpId)
      }
    })
    return rowId
  }

  /**
   * Rule 6: archive, or bring back from the archive. Coming back needs a free name and a place
   * among the 20 (rule 3); the refusal says which.
   */
  setArchived(id: string, archived: boolean): UnarchiveRefusal | null {
    const wallet = this.byId(id)
    if (!wallet || wallet.isArchived === archived) {
      return null
    }
    if (!archived) {
      if (this.nameTaken(wallet.name, id, wallet.profileId)) {
        return 'nameTaken'
      }
      if (this.openOf(wallet.profileId).length >= WALLET_LIMITS.PER_PROFILE) {
        return 'limit'
      }
    }
    const now = Date.now()
    this.offlineService.write((db) => {
      queueWrite(db, WALLET_TABLE, 'upsert', { ...wallet, isArchived: archived, updatedAt: now })
    })
    return null
  }

  /** Rule 6: a tombstone, after the sheet's confirm step. */
  remove(id: string): void {
    const now = Date.now()
    this.offlineService.write((db) => {
      const current = this.find(db, id)
      if (current) {
        queueWrite(db, WALLET_TABLE, 'delete', { ...current, updatedAt: now, deletedAt: now })
      }
    })
  }

  /** Rule 10: moves an open wallet to `to` (an index in that list); rewrites `sortOrder`. */
  moveTo(id: string, to: number): void {
    const open = [...this.openWallets()]
    const from = open.findIndex((wallet) => wallet.id === id)
    if (from < 0 || to < 0 || to >= open.length || from === to) {
      return
    }
    const [moved] = open.splice(from, 1)
    open.splice(to, 0, moved)
    // Archived wallets keep their places after the open ones.
    const ordered = [...open, ...this.archived()]
    const now = Date.now()
    this.offlineService.write((db) => {
      ordered.forEach((wallet, index) => {
        if (wallet.sortOrder !== index) {
          queueWrite(db, WALLET_TABLE, 'upsert', { ...wallet, sortOrder: index, updatedAt: now })
        }
      })
    })
  }

  private currentProfileId(): string {
    const profileId = this.profileService.current()?.id
    if (!profileId) {
      // The shell shows the create step instead of any wallet screen (profile rule 5).
      throw new Error('No current profile')
    }
    return profileId
  }

  /** A profile's open wallets (the current one's from the signal, others from the database). */
  openOf(profileId: string): Wallet[] {
    if (profileId === this.profileService.current()?.id) {
      return this.openWallets()
    }
    return this.read(
      (db) =>
        db
          .selectObjects(
            `SELECT * FROM ${WALLET_TABLE}
             WHERE profile_id = ? AND deleted_at IS NULL AND is_archived = 0`,
            [profileId]
          )
          .map((row) => toWallet(fromSql(WALLET_TABLE, row))),
      []
    )
  }

  /** A new wallet goes last in its profile (rule 10). */
  private nextSortOrder(db: LocalDatabase, profileId: string): number {
    const max = db.selectValue(
      `SELECT max(sort_order) FROM ${WALLET_TABLE} WHERE profile_id = ? AND deleted_at IS NULL`,
      [profileId]
    )
    return typeof max === 'number' ? max + 1 : 0
  }

  private find(db: LocalDatabase, id: string): Wallet | null {
    return findWallet(db, id)
  }

  private read<T>(work: (db: LocalDatabase) => T, fallback: T): T {
    this.offlineService.changes()
    return this.offlineService.isOpen() ? work(this.offlineService.db()) : fallback
  }
}
