import type { Database, Sqlite3Static } from '@sqlite.org/sqlite-wasm'

/** The wasm is copied here by `angular.json` and prefetched by the service worker. */
const WASM_DIR = '/sqlite/'

/** A value SQLite can bind or return. */
export type SqlValue = string | number | null

/**
 * Bumped with every schema change below; `PRAGMA user_version` says which steps a snapshot has.
 * Never edit a step that shipped: append a new one (offline-sync → Data model → Device).
 */
const MIGRATIONS: readonly string[] = [
  // 4a.1: the device itself.
  `CREATE TABLE sync_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT`,
  // 4a.2: the first synced tables, the outbox and conflict notices. `change_seq` is null on a row
  // the server hasn't seen yet. `sync_probes` was dev only (dropped in step 5).
  `CREATE TABLE currencies (
    code TEXT PRIMARY KEY,
    minor_unit INTEGER NOT NULL,
    is_active INTEGER NOT NULL,
    sort_order INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    change_seq INTEGER
  ) STRICT;
  CREATE TABLE sync_probes (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    amount INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER,
    change_seq INTEGER,
    updated_by TEXT
  ) STRICT;
  CREATE TABLE outbox (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    op_id TEXT NOT NULL UNIQUE,
    tbl TEXT NOT NULL,
    row_id TEXT NOT NULL,
    op TEXT NOT NULL,
    row TEXT NOT NULL,
    base_seq INTEGER,
    created_at INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    code TEXT,
    error TEXT
  ) STRICT;
  CREATE UNIQUE INDEX outbox_pending_row ON outbox (tbl, row_id) WHERE status = 'pending';
  CREATE TABLE sync_notices (
    id TEXT PRIMARY KEY,
    tbl TEXT NOT NULL,
    row_id TEXT NOT NULL,
    previous TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    seen_at INTEGER
  ) STRICT`,
  // #6.1: profiles (docs/features/profile.md).
  `CREATE TABLE profiles (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    icon TEXT NOT NULL,
    color TEXT NOT NULL,
    sort_order INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER,
    change_seq INTEGER,
    updated_by TEXT
  ) STRICT`,
  // #6.2: wallets (docs/features/wallet.md).
  `CREATE TABLE wallets (
    id TEXT PRIMARY KEY,
    profile_id TEXT NOT NULL,
    name TEXT NOT NULL,
    currency_code TEXT NOT NULL,
    initial_balance INTEGER NOT NULL,
    icon TEXT NOT NULL,
    color TEXT NOT NULL,
    exclude_from_total INTEGER NOT NULL,
    is_archived INTEGER NOT NULL,
    sort_order INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER,
    change_seq INTEGER,
    updated_by TEXT
  ) STRICT;
  CREATE INDEX wallets_profile ON wallets (profile_id)`,
  // #6.2: the dev-only sync_probes is gone from the server, with anything still about it.
  `DROP TABLE sync_probes;
  DELETE FROM outbox WHERE tbl = 'sync_probes';
  DELETE FROM sync_notices WHERE tbl = 'sync_probes'`,
  // #7.1: categories, one set per profile (docs/features/category.md).
  `CREATE TABLE categories (
    id TEXT PRIMARY KEY,
    profile_id TEXT NOT NULL,
    type TEXT NOT NULL,
    parent_id TEXT,
    name TEXT NOT NULL,
    icon TEXT NOT NULL,
    color TEXT NOT NULL,
    is_archived INTEGER NOT NULL,
    sort_order INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER,
    change_seq INTEGER,
    updated_by TEXT
  ) STRICT;
  CREATE INDEX categories_profile ON categories (profile_id)`,
  // #7.2: the categories a wallet doesn't use, a JSON array (category rule 13).
  `ALTER TABLE wallets ADD COLUMN hidden_category_ids TEXT NOT NULL DEFAULT '[]'`,
  // #8.1: transactions (docs/features/transaction.md). Indexes for the screens: a period of the
  // profile, a wallet's balance, "has transactions" of a wallet or category (Volume).
  `CREATE TABLE transactions (
    id TEXT PRIMARY KEY,
    profile_id TEXT NOT NULL,
    wallet_id TEXT NOT NULL,
    category_id TEXT NOT NULL,
    amount INTEGER NOT NULL,
    occurred_on TEXT NOT NULL,
    note TEXT NOT NULL,
    exclude_from_report INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER,
    change_seq INTEGER,
    updated_by TEXT
  ) STRICT;
  CREATE INDEX transactions_profile_day ON transactions (profile_id, occurred_on);
  CREATE INDEX transactions_wallet ON transactions (wallet_id);
  CREATE INDEX transactions_category ON transactions (category_id)`,
  // #9: transfers (docs/features/transfer.md), one row per transfer. Indexes: a period of the
  // profile (read with transactions), and each side for balances and "has transactions".
  `CREATE TABLE transfers (
    id TEXT PRIMARY KEY,
    profile_id TEXT NOT NULL,
    from_wallet_id TEXT NOT NULL,
    to_wallet_id TEXT NOT NULL,
    amount INTEGER NOT NULL,
    occurred_on TEXT NOT NULL,
    note TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER,
    change_seq INTEGER,
    updated_by TEXT
  ) STRICT;
  CREATE INDEX transfers_profile_day ON transfers (profile_id, occurred_on);
  CREATE INDEX transfers_from_wallet ON transfers (from_wallet_id);
  CREATE INDEX transfers_to_wallet ON transfers (to_wallet_id)`,
  // #7.3: the category a merged tombstone went into (category rule 15).
  `ALTER TABLE categories ADD COLUMN merged_into_id TEXT`,
  // #12: recurring rules (docs/features/recurring.md) and the rule an occurrence came from.
  // Indexes: the profile's rules, and the rules of a wallet (either side) or a category.
  `CREATE TABLE recurring_rules (
    id TEXT PRIMARY KEY,
    profile_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    wallet_id TEXT NOT NULL,
    category_id TEXT,
    to_wallet_id TEXT,
    amount INTEGER NOT NULL,
    note TEXT NOT NULL,
    exclude_from_report INTEGER NOT NULL,
    start_on TEXT NOT NULL,
    frequency TEXT NOT NULL,
    interval INTEGER NOT NULL,
    end_on TEXT,
    end_count INTEGER,
    confirm INTEGER NOT NULL,
    next_on TEXT,
    is_paused INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER,
    change_seq INTEGER,
    updated_by TEXT
  ) STRICT;
  CREATE INDEX recurring_rules_profile ON recurring_rules (profile_id);
  CREATE INDEX recurring_rules_wallet ON recurring_rules (wallet_id);
  CREATE INDEX recurring_rules_to_wallet ON recurring_rules (to_wallet_id);
  CREATE INDEX recurring_rules_category ON recurring_rules (category_id);
  ALTER TABLE transactions ADD COLUMN recurring_id TEXT;
  ALTER TABLE transfers ADD COLUMN recurring_id TEXT`,
  // #13: debts and their uncounted entries (docs/features/debt.md), the debt a counted
  // transaction or a recurring rule belongs to. Indexes: the profile's debts and entries (a
  // period), a debt's entries and linked rows, a wallet's entries (balances).
  `CREATE TABLE debts (
    id TEXT PRIMARY KEY,
    profile_id TEXT NOT NULL,
    direction TEXT NOT NULL,
    person TEXT NOT NULL,
    note TEXT NOT NULL,
    currency_code TEXT NOT NULL,
    count_as TEXT NOT NULL,
    category_id TEXT,
    due_on TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER,
    change_seq INTEGER,
    updated_by TEXT
  ) STRICT;
  CREATE INDEX debts_profile ON debts (profile_id);
  CREATE INDEX debts_category ON debts (category_id);
  CREATE TABLE debt_entries (
    id TEXT PRIMARY KEY,
    profile_id TEXT NOT NULL,
    debt_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    wallet_id TEXT,
    amount INTEGER NOT NULL,
    occurred_on TEXT NOT NULL,
    note TEXT NOT NULL,
    recurring_id TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER,
    change_seq INTEGER,
    updated_by TEXT
  ) STRICT;
  CREATE INDEX debt_entries_profile_day ON debt_entries (profile_id, occurred_on);
  CREATE INDEX debt_entries_debt ON debt_entries (debt_id);
  CREATE INDEX debt_entries_wallet ON debt_entries (wallet_id);
  ALTER TABLE transactions ADD COLUMN debt_id TEXT;
  CREATE INDEX transactions_debt ON transactions (debt_id) WHERE debt_id IS NOT NULL;
  ALTER TABLE recurring_rules ADD COLUMN debt_id TEXT;
  CREATE INDEX recurring_rules_debt ON recurring_rules (debt_id)`,
  // #14: events / trips (docs/features/event.md) and the event a transaction is tagged to.
  // Indexes: the profile's events, an event's rows (its page and totals).
  `CREATE TABLE events (
    id TEXT PRIMARY KEY,
    profile_id TEXT NOT NULL,
    name TEXT NOT NULL,
    icon TEXT NOT NULL,
    color TEXT NOT NULL,
    start_on TEXT NOT NULL,
    end_on TEXT,
    is_closed INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER,
    change_seq INTEGER,
    updated_by TEXT
  ) STRICT;
  CREATE INDEX events_profile ON events (profile_id);
  ALTER TABLE transactions ADD COLUMN event_id TEXT;
  CREATE INDEX transactions_event ON transactions (event_id) WHERE event_id IS NOT NULL`,
]

let sqlitePromise: Promise<Sqlite3Static> | null = null

/** Loads SQLite WASM once, on first use (it's a lazy chunk plus ~880 KB of wasm). */
const loadSqlite = async (wasmDir = WASM_DIR): Promise<Sqlite3Static> => {
  sqlitePromise ??= import('@sqlite.org/sqlite-wasm').then(async ({ default: init }) => {
    // The typings omit the Emscripten module options; `locateFile` is how the wasm is found.
    const withOptions = init as unknown as (options: object) => Promise<Sqlite3Static>
    return withOptions({ locateFile: (file: string) => `${wasmDir}${file}` })
  })
  return sqlitePromise.catch((error: unknown) => {
    sqlitePromise = null
    throw error
  })
}

/**
 * The device's database: SQLite in memory (offline-sync → Data model → Device). Persistence is
 * the caller's job: `export()` gives the bytes to encrypt, `open(bytes)` brings them back.
 */
export class LocalDatabase {
  private constructor(
    private sqlite3: Sqlite3Static,
    private db: Database
  ) {}

  /**
   * A new empty database, or one restored from `snapshot`, migrated to the current schema.
   * `wasmDir` is for specs, which read the wasm from `node_modules` instead of `/sqlite/`.
   */
  static async open(snapshot?: Uint8Array<ArrayBuffer>, wasmDir?: string): Promise<LocalDatabase> {
    const sqlite3 = await loadSqlite(wasmDir)
    const db = new sqlite3.oo1.DB(':memory:', 'c')
    if (snapshot) {
      const pointer = sqlite3.wasm.allocFromTypedArray(snapshot)
      const { capi } = sqlite3
      const rc = capi.sqlite3_deserialize(
        db.pointer as number,
        'main',
        pointer,
        snapshot.byteLength,
        snapshot.byteLength,
        capi.SQLITE_DESERIALIZE_FREEONCLOSE | capi.SQLITE_DESERIALIZE_RESIZEABLE
      )
      db.checkRc(rc)
    }
    const database = new LocalDatabase(sqlite3, db)
    database.migrate()
    return database
  }

  /** The whole database as bytes, for the encrypted snapshot. */
  export(): Uint8Array<ArrayBuffer> {
    return this.sqlite3.capi.sqlite3_js_db_export(this.db)
  }

  /** Runs `work` in one transaction (rule 8: a local write is all or nothing). */
  transaction<T>(work: (db: LocalDatabase) => T): T {
    return this.db.transaction(() => work(this))
  }

  exec(sql: string, bind?: readonly SqlValue[]): void {
    this.db.exec({ sql, bind: bind ? [...bind] : undefined })
  }

  selectValue(sql: string, bind?: readonly SqlValue[]): unknown {
    return this.db.selectValue(sql, bind ? [...bind] : undefined)
  }

  /** Every row as an object keyed by column name. */
  selectObjects(sql: string, bind?: readonly SqlValue[]): Record<string, SqlValue>[] {
    return this.db.selectObjects(sql, bind ? [...bind] : undefined) as Record<string, SqlValue>[]
  }

  close(): void {
    this.db.close()
  }

  private migrate(): void {
    const version = Number(this.db.selectValue('PRAGMA user_version'))
    if (version >= MIGRATIONS.length) {
      return
    }
    this.db.transaction(() => {
      for (const sql of MIGRATIONS.slice(version)) {
        this.db.exec(sql)
      }
      this.db.exec(`PRAGMA user_version = ${MIGRATIONS.length}`)
    })
  }
}
