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
  // the server hasn't seen yet. `sync_probes` is dev only and goes away at #6.
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
