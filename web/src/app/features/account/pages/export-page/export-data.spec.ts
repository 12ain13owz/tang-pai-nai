import { setUpDebts } from '@/core/debt/debt-testing'
import th from '@/core/i18n/th.json'
import type { LocalDatabase } from '@/core/offline'
import {
  categoryChoices,
  dataSpan,
  exportCount,
  exportCsv,
  exportRows,
  walletChoices,
} from './export-data'
import type { ExportQuery } from './export-data'

const translate = (key: string): string => {
  let value: unknown = th
  for (const part of key.split('.')) {
    value = (value as Record<string, unknown>)[part]
  }
  return typeof value === 'string' ? value : key
}

describe('export data (docs/features/export.md rules 2–6)', () => {
  let db: LocalDatabase
  let setup: Awaited<ReturnType<typeof setUpDebts>>
  const all: ExportQuery = {
    profileId: 'p1',
    from: null,
    to: null,
    walletIds: null,
    categoryIds: null,
    others: true,
  }

  beforeEach(async () => {
    setup = await setUpDebts()
    db = setup.db
    setup.pulled('categories', {
      id: 'food',
      profileId: 'p1',
      type: 'expense',
      parentId: 'shop',
      name: 'อาหาร',
      icon: 'lucideUtensils',
      color: '#c2410c',
      isArchived: false,
      sortOrder: 0,
    })
    setup.pulled('events', {
      id: 'cm',
      profileId: 'p1',
      name: 'เชียงใหม่',
      icon: 'lucidePlane',
      color: '#7c3aed',
      startOn: '2026-10-01',
      endOn: null,
      isClosed: false,
    })
    setup.transaction('t1', { occurredOn: '2026-10-05', createdAt: 2, note: 'ข้าว, ไข่' })
    setup.transaction('t2', {
      occurredOn: '2026-10-01',
      categoryId: 'food',
      walletId: 'cash',
      amount: 6500,
      eventId: 'cm',
      excludeFromReport: true,
    })
    setup.transaction('t3', {
      occurredOn: '2026-10-05',
      createdAt: 1,
      categoryId: 'gift',
      note: '=1+1',
    })
    setup.transaction('gone', { deletedAt: 5 })
    setup.pulled('transfers', {
      id: 'r1',
      profileId: 'p1',
      fromWalletId: 'bank',
      toWalletId: 'cash',
      amount: 100000,
      occurredOn: '2026-10-03',
      note: '',
      recurringId: null,
    })
    setup.debt('d1', { person: 'เอ' })
    setup.entry('d1', 'principal', 200000, { occurredOn: '2026-10-02' })
  })

  afterEach(() => db.close())

  it('counts transactions, both transfer sides and wallet debt entries (rule 4)', () => {
    expect(exportCount(db, all)).toBe(3 + 2 + 1)
    expect(exportCount(db, { ...all, others: false })).toBe(3)
    expect(exportCount(db, { ...all, walletIds: ['cash'] })).toBe(1 + 1 + 1)
    expect(exportCount(db, { ...all, from: '2026-10-03', to: '2026-10-05' })).toBe(2 + 2)
    expect(exportCount(db, { ...all, walletIds: [] })).toBe(0)
  })

  it('leaves transfers and debts out once some categories are chosen (rule 2)', () => {
    expect(exportCount(db, { ...all, categoryIds: ['food', 'gift'] })).toBe(2)
    expect(exportRows(db, { ...all, categoryIds: ['food'] }).map((row) => row.id)).toEqual(['t2'])
  })

  it('orders the rows oldest day first, then as recorded, the outgoing side first (rule 4)', () => {
    const rows = exportRows(db, all)
    expect(rows.map((row) => `${row.id}:${row.kind}`)).toEqual([
      't2:expense',
      'd1-e1:debt',
      'r1:out',
      'r1:in',
      't3:income',
      't1:expense',
    ])
    expect(rows.find((row) => row.kind === 'out')?.amount).toBe(-100000)
    expect(rows.find((row) => row.kind === 'debt')?.amount).toBe(200000)
  })

  it('writes the columns in the UI language with signed amounts (rules 5–6)', () => {
    const csv = exportCsv(exportRows(db, all), translate, () => 2)
    const lines = csv.slice(1).split('\r\n')
    expect(lines[0]).toBe(
      'วันที่,ประเภท,หมวดหลัก,หมวด,กระเป๋า,จำนวนเงิน,สกุลเงิน,หมายเหตุ,อีเวนต์,ไม่รวมในรายงาน'
    )
    expect(lines[1]).toBe('2026-10-01,รายจ่าย,shop,อาหาร,cash,-65.00,THB,,เชียงใหม่,ใช่')
    expect(lines[2]).toBe('2026-10-02,ยืม · เอ,,,cash,2000.00,THB,,,')
    expect(lines[3]).toBe('2026-10-03,โอนออก,,,bank,-1000.00,THB,,,')
    expect(lines[5]).toBe("2026-10-05,รายรับ,,gift,bank,3000.00,THB,'=1+1,,")
    expect(lines[6]).toBe('2026-10-05,รายจ่าย,,shop,bank,-3000.00,THB,"ข้าว, ไข่",,')
    expect(lines.at(-1)).toBe('')
  })

  it('offers wallets and a category tree with their counts, and the data span', () => {
    expect(walletChoices(db, 'p1').map((w) => `${w.id}:${w.count}`)).toEqual(['cash:3', 'bank:3'])
    const tree = categoryChoices(db, 'p1', 'expense')
    // Same order and time: by id, as the categories list sorts them.
    expect(tree.map((row) => row.id)).toEqual(['interest', 'shop'])
    expect(tree[1].children.map((child) => `${child.id}:${child.count}`)).toEqual(['food:1'])
    expect(tree[1].count).toBe(1)
    expect(dataSpan(db, 'p1')).toEqual({ from: '2026-10-01', to: '2026-10-05' })
  })
})
