import { computed, inject, Service, signal } from '@angular/core'
import { CATEGORY_TABLE } from '@/core/category'
import { deleteOp, fromSql, OfflineService, queueWrite, SyncService, uuidv7 } from '@/core/offline'
import type { LocalDatabase } from '@/core/offline'
import { ProfileService } from '@/core/profile'
import { EVENT_TABLE, TRANSACTION_TABLE, TransactionService } from '@/core/transaction'
import { WALLET_TABLE, WalletService } from '@/core/wallet'
import { EVENT_LIMITS } from './event.type'
import type {
  EventCategoryShare,
  EventItem,
  EventMoney,
  EventSheetState,
  EventValues,
  TripEvent,
} from './event.type'

/**
 * Events and trips on this device (docs/features/event.md). An event's totals are computed from
 * the transactions tagged to it; every write goes through the outbox. Only the events pages
 * inject it (not the shell).
 */
@Service()
export class EventService {
  private offlineService = inject(OfflineService)
  private syncService = inject(SyncService)
  private profileService = inject(ProfileService)
  private walletService = inject(WalletService)
  private transactionService = inject(TransactionService)

  canWrite = this.profileService.canWrite
  serverDown = this.profileService.serverDown

  /** The open event sheet (the events pages render it). */
  sheet = signal<EventSheetState | null>(null)

  /** The current profile's live events with their totals, by `startOn` desc. */
  items = computed<EventItem[]>(() => {
    const profileId = this.profileService.current()?.id
    const today = this.transactionService.today()
    if (!profileId) {
      return []
    }
    return this.read((db) => {
      const events = db
        .selectObjects(
          `SELECT * FROM ${EVENT_TABLE} WHERE profile_id = ? AND deleted_at IS NULL
            ORDER BY start_on DESC, created_at DESC, id DESC`,
          [profileId]
        )
        .map((row) => toEvent(fromSql(EVENT_TABLE, row)))
      // Event rule 4, in one query: every live tagged row, `excludeFromReport` ones too.
      const sums = db.selectObjects(
        `SELECT t.event_id AS event_id, w.currency_code AS code,
                sum(CASE WHEN c.type = 'income' THEN t.amount ELSE 0 END) AS income,
                sum(CASE WHEN c.type = 'income' THEN 0 ELSE t.amount END) AS expense,
                count(*) AS n, count(DISTINCT t.wallet_id) AS wallets
           FROM ${EVENT_TABLE} e
           JOIN ${TRANSACTION_TABLE} t ON t.event_id = e.id AND t.deleted_at IS NULL
           JOIN ${CATEGORY_TABLE} c ON c.id = t.category_id
           JOIN ${WALLET_TABLE} w ON w.id = t.wallet_id
          WHERE e.profile_id = ? AND e.deleted_at IS NULL
          GROUP BY t.event_id, w.currency_code`,
        [profileId]
      )
      const byEvent = new Map<string, { money: EventMoney[]; count: number; wallets: number }>()
      for (const row of sums) {
        const id = String(row['event_id'])
        const code = String(row['code'])
        const income = Number(row['income'])
        const expense = Number(row['expense'])
        const entry = byEvent.get(id) ?? { money: [], count: 0, wallets: 0 }
        entry.money.push({
          currencyCode: code,
          minorUnit: this.walletService.minorUnit(code),
          income,
          expense,
          net: income - expense,
        })
        entry.count += Number(row['n'])
        entry.wallets += Number(row['wallets'])
        byEvent.set(id, entry)
      }
      return events.map((event) => {
        const entry = byEvent.get(event.id)
        return {
          event,
          money: entry?.money ?? [],
          count: entry?.count ?? 0,
          walletCount: entry?.wallets ?? 0,
          current:
            !event.isClosed &&
            event.startOn <= today &&
            (event.endOn === null || today <= event.endOn),
        }
      })
    }, [])
  })
  openItems = computed(() => this.items().filter((item) => !item.event.isClosed))
  closedItems = computed(() => this.items().filter((item) => item.event.isClosed))
  /** Event rule 1: at most 50 open events per profile. */
  atLimit = computed(() => this.openItems().length >= EVENT_LIMITS.OPEN_PER_PROFILE)

  item(id: string): EventItem | null {
    return this.items().find((item) => item.event.id === id) ?? null
  }

  /** A live event of any profile on this device. */
  byId(id: string): TripEvent | null {
    return this.read((db) => {
      const row = find(db, id)
      return row?.deletedAt === null ? row : null
    }, null)
  }

  /** The event's expense by category (its page), the biggest first. */
  byCategory(id: string): EventCategoryShare[] {
    this.offlineService.changes()
    return this.read(
      (db) =>
        db
          .selectObjects(
            `SELECT c.id AS id, c.name AS name, c.icon AS icon, c.color AS color,
                    w.currency_code AS code, sum(t.amount) AS amount
               FROM ${TRANSACTION_TABLE} t
               JOIN ${CATEGORY_TABLE} c ON c.id = t.category_id
               JOIN ${WALLET_TABLE} w ON w.id = t.wallet_id
              WHERE t.event_id = ? AND t.deleted_at IS NULL AND c.type = 'expense'
              GROUP BY c.id, w.currency_code
              ORDER BY amount DESC, c.name`,
            [id]
          )
          .map((row) => ({
            categoryId: String(row['id']),
            name: typeof row['name'] === 'string' ? row['name'] : '',
            icon: typeof row['icon'] === 'string' ? row['icon'] : '',
            color: typeof row['color'] === 'string' ? row['color'] : '',
            currencyCode: String(row['code']),
            minorUnit: this.walletService.minorUnit(String(row['code'])),
            amount: Number(row['amount']),
          })),
      []
    )
  }

  /** Creates (`id` null) or updates an event of the current profile; a fix drops its op. */
  save(id: string | null, values: EventValues, fixOpId: string | null = null): string {
    const now = Date.now()
    const rowId = id ?? uuidv7(now)
    const refused = fixOpId ? this.refused(fixOpId) : null
    this.offlineService.write((db) => {
      const current = find(db, rowId)
      queueWrite(db, EVENT_TABLE, 'upsert', {
        ...refused,
        ...current,
        id: rowId,
        profileId:
          current?.profileId ??
          (typeof refused?.['profileId'] === 'string' ? refused['profileId'] : null) ??
          this.profileService.current()?.id ??
          '',
        name: values.name.trim(),
        icon: values.icon,
        color: values.color,
        startOn: values.startOn,
        endOn: values.endOn,
        isClosed: current?.isClosed ?? refused?.['isClosed'] === true,
        createdAt:
          current?.createdAt ??
          (typeof refused?.['createdAt'] === 'number' ? refused['createdAt'] : now),
        updatedAt: now,
        deletedAt: null,
      })
      if (fixOpId) {
        deleteOp(db, fixOpId)
      }
    })
    return rowId
  }

  /** Event rule 6: "จบทริป" / "เปิดอีกครั้ง"; false when reopening is over the limit. */
  setClosed(id: string, closed: boolean): boolean {
    if (!closed && this.atLimit()) {
      return false
    }
    const now = Date.now()
    this.offlineService.write((db) => {
      const current = find(db, id)
      if (current && current.isClosed !== closed) {
        queueWrite(db, EVENT_TABLE, 'upsert', { ...current, isClosed: closed, updatedAt: now })
      }
    })
    return true
  }

  /**
   * Event rule 7: only the tombstone. Its rows keep `eventId`, which no screen reads once the
   * event is gone (the server clears it when a row is pushed again), so an offline edit of one
   * of them on another device never loses to a delete it didn't know about.
   */
  remove(id: string): void {
    const now = Date.now()
    this.offlineService.write((db) => {
      const current = find(db, id)
      if (current) {
        queueWrite(db, EVENT_TABLE, 'delete', { ...current, updatedAt: now, deletedAt: now })
      }
    })
  }

  /** Live rows tagged to the event (the delete confirm). */
  rowCount(id: string): number {
    this.offlineService.changes()
    return this.read(
      (db) =>
        Number(
          db.selectValue(
            `SELECT count(*) FROM ${TRANSACTION_TABLE} WHERE event_id = ? AND deleted_at IS NULL`,
            [id]
          )
        ),
      0
    )
  }

  open(state: EventSheetState): void {
    this.sheet.set(state)
  }

  /** "Fix" from the sync sheet (`?fix=` on the events page). */
  openFix(opId: string): boolean {
    const op = this.syncService.rejectedOp(opId)
    if (op?.table !== EVENT_TABLE) {
      return false
    }
    this.open({ mode: 'fix', opId, id: op.rowId })
    return true
  }

  /** The refused values of a rejected event op. */
  refused(opId: string): Record<string, unknown> | null {
    const op = this.syncService.rejectedOp(opId)
    return op?.table === EVENT_TABLE ? { ...op.row, id: op.rowId } : null
  }

  private read<T>(work: (db: LocalDatabase) => T, fallback: T): T {
    this.offlineService.changes()
    return this.offlineService.isOpen() ? work(this.offlineService.db()) : fallback
  }
}

const find = (db: LocalDatabase, id: string): TripEvent | null => {
  const row = db.selectObjects(`SELECT * FROM ${EVENT_TABLE} WHERE id = ?`, [id]).at(0)
  return row ? toEvent(fromSql(EVENT_TABLE, row)) : null
}

export const toEvent = (row: Record<string, unknown>): TripEvent => ({
  id: String(row['id']),
  profileId: String(row['profileId']),
  name: typeof row['name'] === 'string' ? row['name'] : '',
  icon: typeof row['icon'] === 'string' ? row['icon'] : '',
  color: typeof row['color'] === 'string' ? row['color'] : '',
  startOn: typeof row['startOn'] === 'string' ? row['startOn'] : '',
  endOn: typeof row['endOn'] === 'string' ? row['endOn'] : null,
  isClosed: row['isClosed'] === true,
  createdAt: Number(row['createdAt']),
  updatedAt: Number(row['updatedAt']),
  deletedAt: typeof row['deletedAt'] === 'number' ? row['deletedAt'] : null,
  changeSeq: typeof row['changeSeq'] === 'number' ? row['changeSeq'] : null,
})
