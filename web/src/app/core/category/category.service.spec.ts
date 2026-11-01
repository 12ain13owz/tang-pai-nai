import { signal } from '@angular/core'
import { TestBed } from '@angular/core/testing'
import { TranslocoTestingModule } from '@jsverse/transloco'
import { AuthStore } from '@/core/auth'
import type { AuthUser } from '@/core/auth'
import th from '@/core/i18n/th.json'
import { NetworkStatusService } from '@/core/network'
import { findOp, listOps, OfflineService, putRow, queueWrite, SyncService } from '@/core/offline'
import type { LocalDatabase } from '@/core/offline'
import { openTestDatabase } from '@/core/offline/testing-db'
import { CategoryService } from './category.service'
import type { CategoryValues } from './category.type'

describe('CategoryService', () => {
  let db: LocalDatabase
  let service: CategoryService
  const changes = signal(0)

  const offline = {
    isOpen: signal(true),
    isTrusted: signal(true),
    meta: signal(null),
    changes,
    db: () => db,
    write: <T>(work: (database: LocalDatabase) => T): T => {
      const result = db.transaction(work)
      changes.update((n) => n + 1)
      return result
    },
  }
  const sync = {
    canSync: signal(false),
    isSyncing: signal(false),
    lastSyncedAt: signal<number | null>(1),
    rejectedOp: (opId: string) => findOp(db, opId),
  }

  const profile = (id: string, sortOrder: number) =>
    putRow(db, 'profiles', {
      id,
      name: id,
      icon: 'lucideHouse',
      color: '#15803d',
      sortOrder,
      createdAt: 1,
      updatedAt: 1,
      deletedAt: null,
      changeSeq: 1,
      updatedBy: 'u1',
    })
  const category = (id: string, extra: object = {}) => ({
    id,
    profileId: 'p1',
    type: 'expense',
    parentId: null,
    name: id,
    icon: 'lucideShapes',
    color: '#475569',
    isArchived: false,
    sortOrder: 0,
    createdAt: 1000,
    updatedAt: 1000,
    deletedAt: null,
    changeSeq: 10,
    updatedBy: 'u1',
    ...extra,
  })
  /** A row as a pull would write it, outside the outbox. */
  const pulled = (value: ReturnType<typeof category>) => {
    putRow(db, 'categories', value)
    changes.update((n) => n + 1)
  }
  const tree = (type: 'expense' | 'income' = 'expense', archived = false) =>
    service
      .tree(type, archived)
      .map((node) => [node.category.name, node.children.map((child) => child.name)])
  const ops = () => listOps(db, 'pending')
  const values: CategoryValues = {
    name: ' Tea ',
    icon: 'tpnBubbleTea',
    color: '#a16207',
    type: 'expense',
    parentId: null,
  }

  beforeEach(async () => {
    db = await openTestDatabase()
    localStorage.clear()
    profile('p1', 0)
    profile('p2', 1)
    TestBed.configureTestingModule({
      imports: [
        TranslocoTestingModule.forRoot({
          langs: { th },
          translocoConfig: { availableLangs: ['th'], defaultLang: 'th' },
          preloadLangs: true,
        }),
      ],
      providers: [
        { provide: OfflineService, useValue: offline },
        { provide: SyncService, useValue: sync },
        { provide: NetworkStatusService, useValue: { isOnline: signal(true) } },
      ],
    })
    TestBed.inject(AuthStore).user.set({ id: 'u1' } as AuthUser)
    service = TestBed.inject(CategoryService)
    changes.update((n) => n + 1)
  })

  afterEach(() => db.close())

  it("builds the current profile's tree per type, in order, archived apart (rule 10)", () => {
    pulled(category('Food', { sortOrder: 1 }))
    pulled(category('Home', { sortOrder: 0 }))
    pulled(category('Tea', { parentId: 'Food', sortOrder: 1 }))
    pulled(category('Coffee', { parentId: 'Food', sortOrder: 0 }))
    pulled(category('Old', { parentId: 'Food', isArchived: true }))
    pulled(category('Salary', { type: 'income' }))
    pulled(category('Gone', { deletedAt: 5 }))
    pulled(category('Elsewhere', { profileId: 'p2' }))
    expect(tree()).toEqual([
      ['Home', []],
      ['Food', ['Coffee', 'Tea']],
    ])
    expect(tree('income')).toEqual([['Salary', []]])
    expect(service.archivedChildren('expense').map((c) => c.name)).toEqual(['Old'])
    expect(service.openCount('expense')).toBe(4)
    expect(service.parents('expense', 'Home').map((c) => c.name)).toEqual(['Food'])
  })

  it('creates a category last among its siblings and queues it', () => {
    pulled(category('Food'))
    pulled(category('Coffee', { parentId: 'Food', sortOrder: 4 }))
    const id = service.save(null, { ...values, parentId: 'Food' })
    expect(service.byId(id)).toMatchObject({
      name: 'Tea',
      profileId: 'p1',
      parentId: 'Food',
      sortOrder: 5,
      isArchived: false,
    })
    expect(ops()).toMatchObject([{ table: 'categories', rowId: id, op: 'upsert', baseSeq: null }])
  })

  it('moves a category to the end of its new siblings, keeping its place otherwise', () => {
    pulled(category('Food'))
    pulled(category('Home', { sortOrder: 1 }))
    pulled(category('Coffee', { parentId: 'Food', sortOrder: 0 }))
    pulled(category('Tea', { parentId: 'Home', sortOrder: 3 }))
    service.save('Tea', { ...values, name: 'Tea', parentId: 'Home' })
    expect(service.byId('Tea')?.sortOrder).toBe(3)
    service.save('Tea', { ...values, name: 'Tea', parentId: 'Food' })
    expect(service.byId('Tea')?.sortOrder).toBe(1)
    expect(ops()[0]).toMatchObject({ rowId: 'Tea', baseSeq: 10 })
  })

  it('pushes a category after a parent that was made after it', () => {
    const tea = service.save(null, values)
    const drinks = service.save(null, { ...values, name: 'Drinks' })
    service.save(tea, { ...values, parentId: drinks })
    expect(ops().map((op) => op.rowId)).toEqual([drinks, tea])
  })

  it('knows a taken name among open siblings only, in any case (rule 2)', () => {
    pulled(category('Food'))
    pulled(category('Other', { parentId: 'Food' }))
    pulled(category('Old', { isArchived: true }))
    expect(service.nameTaken(' food ', 'expense', null, null)).toBe(true)
    expect(service.nameTaken('Food', 'expense', null, 'Food')).toBe(false)
    expect(service.nameTaken('Food', 'income', null, null)).toBe(false)
    expect(service.nameTaken('Other', 'expense', null, null)).toBe(false)
    expect(service.nameTaken('other', 'expense', 'Food', null)).toBe(true)
    expect(service.nameTaken('Old', 'expense', null, null)).toBe(false)
    expect(service.nameTaken('Food', 'expense', null, null, 'p2')).toBe(false)
  })

  it('archives a parent with its open children, and brings them back with it (rule 7)', () => {
    pulled(category('Home'))
    pulled(category('Rent', { parentId: 'Home' }))
    pulled(category('Water', { parentId: 'Home' }))
    expect(service.setArchived('Home', true)).toBeNull()
    expect(tree()).toEqual([])
    expect(tree('expense', true)).toEqual([['Home', ['Rent', 'Water']]])
    // A child can't come back while its parent is archived.
    expect(service.setArchived('Rent', false)).toBe('parentArchived')
    // Another open "Water" took the name meanwhile: that child stays archived.
    pulled(category('Water2', { name: 'Water', parentId: null }))
    pulled(category('Water3', { name: 'Water', parentId: 'Home', isArchived: true }))
    expect(service.setArchived('Home', false)).toBeNull()
    expect(tree()).toEqual([
      ['Home', ['Rent', 'Water']],
      ['Water', []],
    ])
    expect(service.byId('Water3')?.isArchived).toBe(true)
    // The parent's op goes before its children's, so the server sees an open parent first.
    expect(ops().map((op) => op.rowId)).toEqual(['Home', 'Rent', 'Water'])
  })

  it('refuses to bring back a category into a taken name or past 200 open', () => {
    pulled(category('Food'))
    pulled(category('Food2', { name: 'Food', isArchived: true }))
    expect(service.setArchived('Food2', false)).toBe('nameTaken')
    for (let i = 0; i < 199; i++) {
      pulled(category(`c${i}`))
    }
    pulled(category('Late', { isArchived: true }))
    expect(service.atLimit()).toBe(true)
    expect(service.setArchived('Late', false)).toBe('limit')
  })

  it('deletes a category without children as a tombstone, never one with children', () => {
    pulled(category('Food'))
    pulled(category('Coffee', { parentId: 'Food' }))
    service.remove('Food')
    expect(service.byId('Food')).not.toBeNull()
    service.remove('Coffee')
    expect(service.byId('Coffee')).toBeNull()
    expect(ops()).toMatchObject([{ rowId: 'Coffee', op: 'delete', baseSeq: 10 }])
  })

  it('moves a category among its open siblings only, rewriting sortOrder where it changed', () => {
    pulled(category('A', { sortOrder: 0 }))
    pulled(category('B', { sortOrder: 1 }))
    pulled(category('C', { sortOrder: 2 }))
    pulled(category('X', { sortOrder: 3, isArchived: true }))
    pulled(category('A1', { parentId: 'A', sortOrder: 0 }))
    service.moveTo('C', 0)
    expect(tree().map(([name]) => name)).toEqual(['C', 'A', 'B'])
    expect(ops().map((op) => op.rowId)).toEqual(['C', 'A', 'B']) // X keeps its place
    service.moveTo('A1', 1) // its only sibling: nothing to do
    expect(ops()).toHaveLength(3)
  })

  it('tombstones the live children of a parent deleted on another device (rule 6)', () => {
    pulled(category('Food'))
    pulled(category('Coffee', { parentId: 'Food' }))
    TestBed.tick()
    expect(ops()).toHaveLength(0)
    pulled(category('Food', { deletedAt: 5, changeSeq: 11 }))
    TestBed.tick()
    expect(service.byId('Coffee')).toBeNull()
    expect(ops()).toMatchObject([{ rowId: 'Coffee', op: 'delete' }])
  })

  it("opens a fix with the refused values, dropping a parent that isn't open here", () => {
    pulled(category('Food'))
    pulled(category('Old', { isArchived: true }))
    offline.write((tx) =>
      queueWrite(tx, 'categories', 'upsert', { ...category('Tea'), parentId: 'Food' })
    )
    const [op] = ops()
    tx(() => db.exec(`UPDATE outbox SET status = 'rejected' WHERE op_id = ?`, [op.opId]))
    service.openFix(op.opId)
    expect(service.sheet()).toEqual({
      mode: 'fix',
      opId: op.opId,
      id: 'Tea',
      profileId: 'p1',
      values: {
        name: 'Tea',
        icon: 'lucideShapes',
        color: '#475569',
        type: 'expense',
        parentId: 'Food',
      },
    })
    tx(() =>
      db.exec(`UPDATE outbox SET row = json_set(row, '$.parentId', 'Old') WHERE op_id = ?`, [
        op.opId,
      ])
    )
    service.openFix(op.opId)
    expect(service.sheet()).toMatchObject({ values: { parentId: null } })
    service.save('Tea', { ...values, name: 'Tea 2' }, op.opId, 'p1')
    expect(findOp(db, op.opId)).toBeNull()
    expect(service.byId('Tea')?.name).toBe('Tea 2')
  })

  /** A change made outside the service, seen like a pull. */
  const tx = (work: () => void) => {
    work()
    changes.update((n) => n + 1)
  }
})
