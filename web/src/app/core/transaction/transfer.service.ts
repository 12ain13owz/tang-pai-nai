import { DOCUMENT } from '@angular/common'
import { effect, inject, Service, signal, untracked } from '@angular/core'
import { deleteOp, fromSql, OfflineService, queueWrite, SyncService, uuidv7 } from '@/core/offline'
import type { LocalDatabase } from '@/core/offline'
import { ProfileService } from '@/core/profile'
import { WALLET_TABLE, WalletService } from '@/core/wallet'
import { toTransfer } from './transaction.service'
import { TRANSACTION_PREF_PREFIX, TRANSFER_TABLE } from './transaction.type'
import type { Transfer, TransferSheetState, TransferValues } from './transaction.type'

/**
 * Transfers between the current profile's wallets (docs/features/transfer.md): one row per
 * transfer, written through the outbox like a transaction. The Transactions tab reads them with
 * its transactions (`TransactionService.entries`), balances read them in `WalletService`.
 */
@Service()
export class TransferService {
  private offlineService = inject(OfflineService)
  private syncService = inject(SyncService)
  private profileService = inject(ProfileService)
  private walletService = inject(WalletService)
  private window = inject(DOCUMENT).defaultView

  canWrite = this.profileService.canWrite
  serverDown = this.profileService.serverDown

  /** The open transfer sheet (layout/transfer-sheet), if any. */
  sheet = signal<TransferSheetState | null>(null)

  constructor() {
    // Rule 8: a wallet deleted on a device that didn't know all its transfers leaves live ones
    // behind; whichever device sees that tombstones the ones it holds (as transaction rule 10).
    effect(() => {
      this.offlineService.changes()
      if (!this.canWrite()) {
        return
      }
      untracked(() => {
        if (this.orphans(this.offlineService.db()).length > 0) {
          const now = Date.now()
          this.offlineService.write((tx) => {
            for (const row of this.orphans(tx)) {
              queueWrite(tx, TRANSFER_TABLE, 'delete', { ...row, updatedAt: now, deletedAt: now })
            }
          })
        }
      })
    })
  }

  /** A live transfer of any profile on this device. */
  byId(id: string): Transfer | null {
    return this.read((db) => {
      const row = this.find(db, id)
      return row?.deletedAt === null ? row : null
    }, null)
  }

  /**
   * Creates (`id` null) or updates a transfer in the current profile (a fix: the op's profile);
   * a fix also drops the rejected op. Remembers the to wallet for the from wallet (Q7).
   */
  save(
    id: string | null,
    values: TransferValues,
    fixOpId: string | null = null,
    profileId = this.profileService.current()?.id ?? ''
  ): string {
    const now = Date.now()
    const rowId = id ?? uuidv7(now)
    this.offlineService.write((db) => {
      const current = this.find(db, rowId)
      queueWrite(db, TRANSFER_TABLE, 'upsert', {
        ...current,
        id: rowId,
        profileId: current?.profileId ?? profileId,
        fromWalletId: values.fromWalletId,
        toWalletId: values.toWalletId,
        amount: values.amount,
        occurredOn: values.occurredOn,
        note: values.note.trim(),
        createdAt: current?.createdAt ?? now,
        updatedAt: now,
        deletedAt: null,
      })
      if (fixOpId) {
        deleteOp(db, fixOpId)
      }
    })
    this.remember(`from:${profileId}`, values.fromWalletId)
    this.remember(`to:${values.fromWalletId}`, values.toWalletId)
    return rowId
  }

  /** Rule 7: both sides go at once as one tombstone; `restore` is the toast's undo. */
  remove(id: string): void {
    const now = Date.now()
    this.offlineService.write((db) => {
      const current = this.find(db, id)
      if (current) {
        queueWrite(db, TRANSFER_TABLE, 'delete', { ...current, updatedAt: now, deletedAt: now })
      }
    })
  }

  restore(id: string): void {
    const now = Date.now()
    this.offlineService.write((db) => {
      const current = this.find(db, id)
      if (current && current.deletedAt !== null) {
        queueWrite(db, TRANSFER_TABLE, 'upsert', { ...current, updatedAt: now, deletedAt: null })
      }
    })
  }

  /** The from wallet a new transfer starts on: the last one used, if still open. */
  defaultFromId(profileId = this.profileService.current()?.id ?? ''): string | null {
    const open = this.walletService.openOf(profileId)
    const last = this.recall(`from:${profileId}`)
    return open.find((wallet) => wallet.id === last)?.id ?? open.at(0)?.id ?? null
  }

  /** Q7: the to wallet last used from `fromId`, while it's still open and fits. */
  lastToId(fromId: string, profileId = this.profileService.current()?.id ?? ''): string | null {
    const from = this.walletService.byId(fromId)
    const last = this.recall(`to:${fromId}`)
    const to = this.walletService.openOf(profileId).find((wallet) => wallet.id === last)
    return to && from && to.id !== from.id && to.currencyCode === from.currencyCode ? to.id : null
  }

  open(state: TransferSheetState): void {
    this.sheet.set(state)
  }

  /** "Fix" from the sync sheet: the refused values of a rejected transfer op. */
  openFix(opId: string): void {
    const op = this.syncService.rejectedOp(opId)
    if (!op || op.table !== TRANSFER_TABLE) {
      return
    }
    const row = op.row
    const text = (key: string) => (typeof row[key] === 'string' ? row[key] : '')
    const profileId = text('profileId')
    this.open({
      mode: 'fix',
      opId,
      id: op.rowId,
      profileId: this.profileService.byId(profileId)
        ? profileId
        : (this.profileService.current()?.id ?? profileId),
      values: {
        fromWalletId: text('fromWalletId'),
        toWalletId: text('toWalletId'),
        amount: typeof row['amount'] === 'number' ? row['amount'] : 0,
        occurredOn: text('occurredOn'),
        note: text('note'),
      },
    })
  }

  /** Live transfers with a side in a wallet that is a tombstone here (rule 8). */
  private orphans(db: LocalDatabase): Transfer[] {
    return db
      .selectObjects(
        `SELECT r.* FROM ${TRANSFER_TABLE} r
         LEFT JOIN ${WALLET_TABLE} a ON a.id = r.from_wallet_id
         LEFT JOIN ${WALLET_TABLE} b ON b.id = r.to_wallet_id
         WHERE r.deleted_at IS NULL AND (a.deleted_at IS NOT NULL OR b.deleted_at IS NOT NULL)`
      )
      .map((row) => toTransfer(fromSql(TRANSFER_TABLE, row)))
  }

  private find(db: LocalDatabase, id: string): Transfer | null {
    const row = db.selectObjects(`SELECT * FROM ${TRANSFER_TABLE} WHERE id = ?`, [id]).at(0)
    return row ? toTransfer(fromSql(TRANSFER_TABLE, row)) : null
  }

  private read<T>(work: (db: LocalDatabase) => T, fallback: T): T {
    this.offlineService.changes()
    return this.offlineService.isOpen() ? work(this.offlineService.db()) : fallback
  }

  private recall(key: string): string | null {
    try {
      return this.storage()?.getItem(`${TRANSACTION_PREF_PREFIX}transfer:${key}`) ?? null
    } catch {
      return null
    }
  }

  private remember(key: string, value: string): void {
    try {
      this.storage()?.setItem(`${TRANSACTION_PREF_PREFIX}transfer:${key}`, value)
    } catch {
      // A full or blocked storage only loses the convenience.
    }
  }

  /** Lasting on a trusted device, for the tab's life on an untrusted one (like the profile). */
  private storage(): Storage | null {
    try {
      return this.offlineService.isTrusted()
        ? (this.window?.localStorage ?? null)
        : (this.window?.sessionStorage ?? null)
    } catch {
      return null
    }
  }
}
