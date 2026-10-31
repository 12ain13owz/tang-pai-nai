import { openTestDatabase } from './testing-db'

describe('LocalDatabase', () => {
  it('creates every table of the current schema', async () => {
    const db = await openTestDatabase()
    const tables = db
      .selectObjects(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`)
      .map((row) => row['name'])
    expect(tables).toEqual(
      expect.arrayContaining(['currencies', 'outbox', 'sync_meta', 'sync_notices', 'sync_probes'])
    )
    expect(db.selectValue('PRAGMA user_version')).toBe(2)
    db.close()
  })

  it('brings a 4a.1 snapshot (schema step 1) up to date and keeps its data', async () => {
    const old = await openTestDatabase()
    old.exec(
      'DROP TABLE currencies; DROP TABLE sync_probes; DROP TABLE outbox; DROP TABLE sync_notices'
    )
    old.exec('PRAGMA user_version = 1')
    old.exec(`INSERT INTO sync_meta (key, value) VALUES ('deviceId', 'd1')`)
    const snapshot = old.export()
    old.close()

    const db = await openTestDatabase(snapshot)
    expect(db.selectValue('PRAGMA user_version')).toBe(2)
    expect(db.selectValue(`SELECT value FROM sync_meta WHERE key = 'deviceId'`)).toBe('d1')
    expect(db.selectValue('SELECT count(*) FROM outbox')).toBe(0)
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
