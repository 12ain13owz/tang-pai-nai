import { queueWrite } from './outbox'
import { clearSyncTables, deleteRow, getRow, putRow } from './sync-tables'
import { openTestDatabase } from './testing-db'
import type { LocalDatabase } from './local-database'

const THB = {
  id: 'THB',
  code: 'THB',
  minorUnit: 2,
  isActive: true,
  sortOrder: 0,
  createdAt: 1,
  updatedAt: 1,
  changeSeq: 1,
}

describe('sync tables', () => {
  let db: LocalDatabase
  beforeEach(async () => {
    db = await openTestDatabase()
  })
  afterEach(() => db.close())

  it('stores a row snake_case and reads it back camelCase, booleans included', () => {
    putRow(db, 'currencies', THB)
    expect(db.selectObjects('SELECT is_active, minor_unit FROM currencies')).toEqual([
      { is_active: 1, minor_unit: 2 },
    ])
    const { id: _id, ...stored } = THB
    expect(getRow(db, 'currencies', 'THB')).toEqual(stored)
  })

  it('stores a JSON column as text and parses it back, [] when the row has none', () => {
    const wallet = {
      id: 'w1',
      profileId: 'p1',
      name: 'Cash',
      currencyCode: 'THB',
      initialBalance: 0,
      icon: 'lucideWallet',
      color: '#16a34a',
      excludeFromTotal: false,
      isArchived: false,
      sortOrder: 0,
      createdAt: 1,
      updatedAt: 1,
      deletedAt: null,
      changeSeq: 1,
      updatedBy: 'u1',
    }
    putRow(db, 'wallets', { ...wallet, hiddenCategoryIds: ['c1', 'c2'] })
    expect(db.selectValue('SELECT hidden_category_ids FROM wallets')).toBe('["c1","c2"]')
    expect(getRow(db, 'wallets', 'w1')?.['hiddenCategoryIds']).toEqual(['c1', 'c2'])
    putRow(db, 'wallets', wallet)
    expect(getRow(db, 'wallets', 'w1')?.['hiddenCategoryIds']).toEqual([])
    db.exec(`UPDATE wallets SET hidden_category_ids = 'not json'`)
    expect(getRow(db, 'wallets', 'w1')?.['hiddenCategoryIds']).toBeNull()
  })

  it('replaces a row with the same key and deletes by key', () => {
    putRow(db, 'currencies', THB)
    putRow(db, 'currencies', { ...THB, isActive: false, changeSeq: 2 })
    expect(getRow(db, 'currencies', 'THB')).toMatchObject({ isActive: false, changeSeq: 2 })
    deleteRow(db, 'currencies', 'THB')
    expect(getRow(db, 'currencies', 'THB')).toBeNull()
  })

  it('clears the synced tables for a full resync, but keeps the outbox', () => {
    putRow(db, 'currencies', THB)
    queueWrite(db, 'profiles', 'upsert', {
      id: 'p1',
      name: 'A',
      icon: 'lucideHouse',
      color: '#16a34a',
      sortOrder: 0,
      createdAt: 1,
      updatedAt: 1,
      deletedAt: null,
    })
    clearSyncTables(db)
    expect(getRow(db, 'currencies', 'THB')).toBeNull()
    expect(getRow(db, 'profiles', 'p1')).toBeNull()
    expect(db.selectValue('SELECT count(*) FROM outbox')).toBe(1)
  })
})
