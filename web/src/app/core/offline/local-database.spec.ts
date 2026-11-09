import { openTestDatabase } from './testing-db'

/** Back to before schema step 12 (#13): an older snapshot has no debts. */
const UNDO_STEP_12 = `DROP TABLE debts; DROP TABLE debt_entries;
  DROP INDEX transactions_debt; ALTER TABLE transactions DROP COLUMN debt_id;
  DROP INDEX recurring_rules_debt; ALTER TABLE recurring_rules DROP COLUMN debt_id`

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
        'recurring_rules',
        'debts',
        'debt_entries',
        'transactions',
        'transfers',
        'wallets',
      ])
    )
    expect(tables).not.toContain('sync_probes')
    expect(db.selectValue('PRAGMA user_version')).toBe(12)
    db.close()
  })

  it('brings a 4a.1 snapshot (schema step 1) up to date and keeps its data', async () => {
    const old = await openTestDatabase()
    old.exec(UNDO_STEP_12)
    old.exec('DROP TABLE recurring_rules')
    old.exec('DROP TABLE transfers')
    old.exec(
      'DROP TABLE currencies; DROP TABLE outbox; DROP TABLE sync_notices; DROP TABLE profiles; DROP TABLE wallets; DROP TABLE categories; DROP TABLE transactions'
    )
    old.exec('PRAGMA user_version = 1')
    old.exec(`INSERT INTO sync_meta (key, value) VALUES ('deviceId', 'd1')`)
    const snapshot = old.export()
    old.close()

    const db = await openTestDatabase(snapshot)
    expect(db.selectValue('PRAGMA user_version')).toBe(12)
    expect(db.selectValue(`SELECT value FROM sync_meta WHERE key = 'deviceId'`)).toBe('d1')
    expect(db.selectValue('SELECT count(*) FROM outbox')).toBe(0)
    expect(db.selectValue('SELECT count(*) FROM profiles')).toBe(0)
    expect(db.selectValue('SELECT count(*) FROM wallets')).toBe(0)
    expect(db.selectValue('SELECT count(*) FROM categories')).toBe(0)
    expect(db.selectValue('SELECT count(*) FROM transactions')).toBe(0)
    db.close()
  })

  it('drops the dev-only sync_probes with its ops and notices (step 5), keeping the rest', async () => {
    const old = await openTestDatabase()
    old.exec(UNDO_STEP_12)
    old.exec('DROP TABLE recurring_rules')
    old.exec('DROP TABLE transfers')
    old.exec(`DROP TABLE transactions;
      DROP TABLE categories;
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
    old.exec(UNDO_STEP_12)
    old.exec('DROP TABLE recurring_rules')
    old.exec('DROP TABLE transfers')
    old.exec(`DROP TABLE transactions;
      DROP TABLE categories;
      ALTER TABLE wallets DROP COLUMN hidden_category_ids;
      INSERT INTO sync_meta (key, value) VALUES ('deviceId', 'd1');
      PRAGMA user_version = 5`)
    const snapshot = old.export()
    old.close()

    const db = await openTestDatabase(snapshot)
    expect(db.selectValue('PRAGMA user_version')).toBe(12)
    expect(db.selectValue('SELECT count(*) FROM categories')).toBe(0)
    expect(db.selectValue(`SELECT value FROM sync_meta WHERE key = 'deviceId'`)).toBe('d1')
    db.close()
  })

  it('adds wallets.hidden_category_ids (step 7) to a 7.1 snapshot, [] for its wallets', async () => {
    const old = await openTestDatabase()
    old.exec(UNDO_STEP_12)
    old.exec('DROP TABLE recurring_rules')
    old.exec('DROP TABLE transfers')
    old.exec(`DROP TABLE transactions;
      ALTER TABLE categories DROP COLUMN merged_into_id;
      ALTER TABLE wallets DROP COLUMN hidden_category_ids;
      INSERT INTO wallets (id, profile_id, name, currency_code, initial_balance, icon, color,
        exclude_from_total, is_archived, sort_order, created_at, updated_at)
        VALUES ('w1', 'p1', 'Cash', 'THB', 0, 'lucideWallet', '#16a34a', 0, 0, 0, 1, 1);
      PRAGMA user_version = 6`)
    const snapshot = old.export()
    old.close()

    const db = await openTestDatabase(snapshot)
    expect(db.selectValue('PRAGMA user_version')).toBe(12)
    expect(db.selectValue('SELECT hidden_category_ids FROM wallets')).toBe('[]')
    db.close()
  })

  it('adds transactions (step 8) with its indexes to a 7.2 snapshot', async () => {
    const old = await openTestDatabase()
    old.exec(UNDO_STEP_12)
    old.exec('DROP TABLE recurring_rules')
    old.exec('DROP TABLE transfers')
    old.exec(`DROP TABLE transactions;
      ALTER TABLE categories DROP COLUMN merged_into_id;
      INSERT INTO sync_meta (key, value) VALUES ('deviceId', 'd1');
      PRAGMA user_version = 7`)
    const snapshot = old.export()
    old.close()

    const db = await openTestDatabase(snapshot)
    expect(db.selectValue('PRAGMA user_version')).toBe(12)
    expect(db.selectValue('SELECT count(*) FROM transactions')).toBe(0)
    expect(
      db
        .selectObjects(
          `SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'transactions'
            AND name NOT LIKE 'sqlite_%' ORDER BY name`
        )
        .map((row) => row['name'])
    ).toEqual([
      'transactions_category',
      'transactions_debt',
      'transactions_profile_day',
      'transactions_wallet',
    ])
    db.close()
  })

  it('adds categories.merged_into_id (step 10) to a #9 snapshot, null for its categories', async () => {
    const old = await openTestDatabase()
    old.exec(UNDO_STEP_12)
    old.exec(`DROP TABLE recurring_rules;
      ALTER TABLE transactions DROP COLUMN recurring_id;
      ALTER TABLE transfers DROP COLUMN recurring_id;
      ALTER TABLE categories DROP COLUMN merged_into_id;
      INSERT INTO categories (id, profile_id, type, parent_id, name, icon, color, is_archived,
        sort_order, created_at, updated_at)
        VALUES ('c1', 'p1', 'expense', NULL, 'Food', 'lucideShapes', '#475569', 0, 0, 1, 1);
      PRAGMA user_version = 9`)
    const snapshot = old.export()
    old.close()

    const db = await openTestDatabase(snapshot)
    expect(db.selectValue('PRAGMA user_version')).toBe(12)
    expect(db.selectValue('SELECT merged_into_id FROM categories')).toBeNull()
    db.close()
  })

  it('adds recurring_rules and recurring_id (step 11) to a 7.3 snapshot, null for its rows', async () => {
    const old = await openTestDatabase()
    old.exec(UNDO_STEP_12)
    old.exec(`DROP TABLE recurring_rules;
      ALTER TABLE transactions DROP COLUMN recurring_id;
      ALTER TABLE transfers DROP COLUMN recurring_id;
      INSERT INTO transactions (id, profile_id, wallet_id, category_id, amount, occurred_on, note,
        exclude_from_report, created_at, updated_at)
        VALUES ('t1', 'p1', 'w1', 'c1', 100, '2026-11-01', '', 0, 1, 1);
      PRAGMA user_version = 10`)
    const snapshot = old.export()
    old.close()

    const db = await openTestDatabase(snapshot)
    expect(db.selectValue('PRAGMA user_version')).toBe(12)
    expect(db.selectValue('SELECT recurring_id FROM transactions')).toBeNull()
    expect(db.selectValue('SELECT count(*) FROM recurring_rules')).toBe(0)
    db.close()
  })

  it('adds debts, debt_entries and debt_id (step 12) to a #12 snapshot, null for its rows', async () => {
    const old = await openTestDatabase()
    old.exec(UNDO_STEP_12)
    old.exec(`INSERT INTO transactions (id, profile_id, wallet_id, category_id, amount, occurred_on,
        note, exclude_from_report, created_at, updated_at)
        VALUES ('t1', 'p1', 'w1', 'c1', 100, '2026-11-01', '', 0, 1, 1);
      PRAGMA user_version = 11`)
    const snapshot = old.export()
    old.close()

    const db = await openTestDatabase(snapshot)
    expect(db.selectValue('PRAGMA user_version')).toBe(12)
    expect(db.selectValue('SELECT debt_id FROM transactions')).toBeNull()
    expect(db.selectValue('SELECT count(*) FROM debts')).toBe(0)
    expect(db.selectValue('SELECT count(*) FROM debt_entries')).toBe(0)
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
