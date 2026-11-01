import { openTestDatabase } from './testing-db'

describe('LocalDatabase', () => {
  it('creates every table of the current schema', async () => {
    const db = await openTestDatabase()
    const tables = db
      .selectObjects(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`)
      .map((row) => row['name'])
    expect(tables).toEqual(
      expect.arrayContaining([
        'categories',
        'currencies',
        'outbox',
        'profiles',
        'sync_meta',
        'sync_notices',
        'wallets',
      ])
    )
    expect(tables).not.toContain('sync_probes')
    expect(db.selectValue('PRAGMA user_version')).toBe(7)
    db.close()
  })

  it('brings a 4a.1 snapshot (schema step 1) up to date and keeps its data', async () => {
    const old = await openTestDatabase()
    old.exec(
      'DROP TABLE currencies; DROP TABLE outbox; DROP TABLE sync_notices; DROP TABLE profiles; DROP TABLE wallets; DROP TABLE categories'
    )
    old.exec('PRAGMA user_version = 1')
    old.exec(`INSERT INTO sync_meta (key, value) VALUES ('deviceId', 'd1')`)
    const snapshot = old.export()
    old.close()

    const db = await openTestDatabase(snapshot)
    expect(db.selectValue('PRAGMA user_version')).toBe(7)
    expect(db.selectValue(`SELECT value FROM sync_meta WHERE key = 'deviceId'`)).toBe('d1')
    expect(db.selectValue('SELECT count(*) FROM outbox')).toBe(0)
    expect(db.selectValue('SELECT count(*) FROM profiles')).toBe(0)
    expect(db.selectValue('SELECT count(*) FROM wallets')).toBe(0)
    expect(db.selectValue('SELECT count(*) FROM categories')).toBe(0)
    db.close()
  })

  it('drops the dev-only sync_probes with its ops and notices (step 5), keeping the rest', async () => {
    const old = await openTestDatabase()
    old.exec(`DROP TABLE categories;
      ALTER TABLE wallets DROP COLUMN hidden_category_ids;
      CREATE TABLE sync_probes (id TEXT PRIMARY KEY, title TEXT NOT NULL) STRICT;
      INSERT INTO sync_probes VALUES ('p1', 'Tea');
      INSERT INTO outbox (op_id, tbl, row_id, op, row, created_at)
        VALUES ('o1', 'sync_probes', 'p1', 'upsert', '{}', 1), ('o2', 'profiles', 'x', 'upsert', '{}', 1);
      INSERT INTO sync_notices (id, tbl, row_id, previous, created_at)
        VALUES ('n1', 'sync_probes', 'p1', '{}', 1), ('n2', 'profiles', 'x', '{}', 1);
      PRAGMA user_version = 4`)
    const snapshot = old.export()
    old.close()

    const db = await openTestDatabase(snapshot)
    expect(db.selectValue(`SELECT count(*) FROM sqlite_master WHERE name = 'sync_probes'`)).toBe(0)
    expect(db.selectObjects('SELECT op_id FROM outbox')).toEqual([{ op_id: 'o2' }])
    expect(db.selectObjects('SELECT id FROM sync_notices')).toEqual([{ id: 'n2' }])
    db.close()
  })

  it('adds categories (step 6) to a 6.2 snapshot', async () => {
    const old = await openTestDatabase()
    old.exec(`DROP TABLE categories;
      ALTER TABLE wallets DROP COLUMN hidden_category_ids;
      INSERT INTO sync_meta (key, value) VALUES ('deviceId', 'd1');
      PRAGMA user_version = 5`)
    const snapshot = old.export()
    old.close()

    const db = await openTestDatabase(snapshot)
    expect(db.selectValue('PRAGMA user_version')).toBe(7)
    expect(db.selectValue('SELECT count(*) FROM categories')).toBe(0)
    expect(db.selectValue(`SELECT value FROM sync_meta WHERE key = 'deviceId'`)).toBe('d1')
    db.close()
  })

  it('rolls a transaction back when the work throws', async () => {
    const db = await openTestDatabase()
    expect(() =>
      db.transaction((tx) => {
        tx.exec(`INSERT INTO sync_meta (key, value) VALUES ('cursor', '5')`)
        throw new Error('boom')
      })
    ).toThrow('boom')
    expect(db.selectValue(`SELECT count(*) FROM sync_meta`)).toBe(0)
    db.close()
  })
})
