import type { Database, Sqlite3Static } from '@sqlite.org/sqlite-wasm'

/** The wasm is copied here by `angular.json` and prefetched by the service worker. */
const WASM_DIR = '/sqlite/'

/**
 * Bumped with every schema change below; `PRAGMA user_version` says which steps a snapshot has.
 * 4a.1 only knows the device itself. Synced tables and the outbox come with 4a.2 and later
 * features (offline-sync → Data model → Device).
 */
const MIGRATIONS: readonly string[] = [
  `CREATE TABLE sync_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT`,
]

let sqlitePromise: Promise<Sqlite3Static> | null = null

/** Loads SQLite WASM once, on first use (it's a lazy chunk plus ~880 KB of wasm). */
const loadSqlite = async (): Promise<Sqlite3Static> => {
  sqlitePromise ??= import('@sqlite.org/sqlite-wasm').then(async ({ default: init }) => {
    // The typings omit the Emscripten module options; `locateFile` is how the wasm is found.
    const withOptions = init as unknown as (options: object) => Promise<Sqlite3Static>
    return withOptions({ locateFile: (file: string) => `${WASM_DIR}${file}` })
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

  /** A new empty database, or one restored from `snapshot`, migrated to the current schema. */
  static async open(snapshot?: Uint8Array<ArrayBuffer>): Promise<LocalDatabase> {
    const sqlite3 = await loadSqlite()
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

  exec(sql: string, bind?: readonly (string | number | null)[]): void {
    this.db.exec({ sql, bind: bind ? [...bind] : undefined })
  }

  selectValue(sql: string, bind?: readonly (string | number | null)[]): unknown {
    return this.db.selectValue(sql, bind ? [...bind] : undefined)
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
