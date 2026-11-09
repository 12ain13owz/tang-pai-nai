import { TestBed } from '@angular/core/testing'
import { getRow, listOps } from '@/core/offline'
import { TransactionService } from '@/core/transaction'
import { setUpEvents } from './event-testing'
import { EventService } from './event.service'

describe('EventService', () => {
  let setup: Awaited<ReturnType<typeof setUpEvents>>
  let events: EventService
  let transactions: TransactionService

  beforeEach(async () => {
    localStorage.clear()
    setup = await setUpEvents()
    events = TestBed.inject(EventService)
    transactions = TestBed.inject(TransactionService)
    setup.event('cm', { name: 'เชียงใหม่' })
    setup.event('wed', { name: 'งานแต่ง', startOn: '2026-10-01', endOn: null })
    setup.event('ky', {
      name: 'เขาใหญ่',
      startOn: '2026-08-14',
      endOn: '2026-08-16',
      isClosed: true,
    })
    setup.transaction('t1', { eventId: 'cm', amount: 840000, walletId: 'bank' })
    setup.transaction('t2', { eventId: 'cm', amount: 24000, walletId: 'cash' })
    // Rule 4: a row left out of reports still counts for the event.
    setup.transaction('t3', { eventId: 'cm', amount: 10000, excludeFromReport: true })
    setup.transaction('t4', { eventId: 'cm', amount: 50000, categoryId: 'gift' })
    setup.transaction('t5', { eventId: 'cm', amount: 99900, deletedAt: 5 })
    setup.transaction('t6', { amount: 777 })
  })

  afterEach(() => setup.db.close())

  it('computes each event’s totals from its live rows, by start date, closed ones too (rules 4, 6)', () => {
    expect(events.items().map((item) => item.event.id)).toEqual(['cm', 'wed', 'ky'])
    const cm = events.item('cm')
    expect(cm?.money).toEqual([
      { currencyCode: 'THB', minorUnit: 2, income: 50000, expense: 874000, net: -824000 },
    ])
    expect(cm?.count).toBe(4)
    expect(cm?.walletCount).toBe(2)
    expect(events.item('wed')?.money).toEqual([])
    expect(events.openItems().map((item) => item.event.id)).toEqual(['cm', 'wed'])
    expect(events.closedItems().map((item) => item.event.id)).toEqual(['ky'])
  })

  it('marks open events whose dates hold today as current (rule 5)', () => {
    expect(events.items().map((item) => [item.event.id, item.current])).toEqual([
      ['cm', true],
      ['wed', true],
      ['ky', false],
    ])
  })

  it('splits the expense by category, the biggest first', () => {
    setup.transaction('t7', { eventId: 'cm', amount: 5000, categoryId: 'interest' })
    expect(
      events.byCategory('cm').map((share) => [share.categoryId, share.amount, share.currencyCode])
    ).toEqual([
      ['shop', 874000, 'THB'],
      ['interest', 5000, 'THB'],
    ])
  })

  it('creates and edits an event through the outbox, keeping its closed state', () => {
    const id = events.save(null, {
      name: '  ภูเก็ต ',
      icon: 'lucideHotel',
      color: '#16a34a',
      startOn: '2026-12-01',
      endOn: null,
    })
    expect(getRow(setup.db, 'events', id)).toMatchObject({
      profileId: 'p1',
      name: 'ภูเก็ต',
      startOn: '2026-12-01',
      endOn: null,
      isClosed: false,
    })
    events.save('ky', {
      name: 'เขาใหญ่ 2',
      icon: 'lucideCar',
      color: '#4d7c0f',
      startOn: '2026-08-14',
      endOn: '2026-08-17',
    })
    expect(getRow(setup.db, 'events', 'ky')).toMatchObject({ name: 'เขาใหญ่ 2', isClosed: true })
    expect(listOps(setup.db, 'pending').map((op) => op.table)).toEqual(['events', 'events'])
  })

  it('closes and reopens, and refuses to reopen past 50 open events (rules 1, 6)', () => {
    expect(events.setClosed('cm', true)).toBe(true)
    expect(events.item('cm')?.event.isClosed).toBe(true)
    expect(events.item('cm')?.current).toBe(false)
    for (let i = 0; i < 49; i++) {
      setup.event(`e${i}`)
    }
    expect(events.atLimit()).toBe(true)
    expect(events.setClosed('cm', false)).toBe(false)
    expect(events.item('cm')?.event.isClosed).toBe(true)
  })

  it('deletes only the event: its rows stay, keep the id and lose the tag (rule 7)', () => {
    expect(events.rowCount('cm')).toBe(4)
    events.remove('cm')
    expect(listOps(setup.db, 'pending').map((op) => [op.table, op.op])).toEqual([
      ['events', 'delete'],
    ])
    expect(events.item('cm')).toBeNull()
    expect(getRow(setup.db, 'transactions', 't1')).toMatchObject({ eventId: 'cm', deletedAt: null })
    const row = transactions.list({ from: null, to: null }).find((item) => item.id === 't1')
    expect(row?.eventName).toBeNull()
    expect(transactions.liveEventId('cm')).toBeNull()
  })

  it('opens a refused create for a fix and sends it again with the op dropped', () => {
    const values = {
      name: 'x',
      icon: 'lucidePlane',
      color: '#0e7490',
      startOn: '2026-11-09',
      endOn: null,
    }
    const id = events.save(null, values)
    setup.db.exec(
      `UPDATE outbox SET status = 'rejected', code = 'CONFLICT'; DELETE FROM events WHERE id = ?`,
      [id]
    )
    const opId = listOps(setup.db, 'rejected')[0].opId
    expect(events.openFix('nope')).toBe(false)
    expect(events.openFix(opId)).toBe(true)
    expect(events.sheet()).toEqual({ mode: 'fix', opId, id })
    expect(events.refused(opId)).toMatchObject({ id, name: 'x', profileId: 'p1' })
    events.save(id, { ...values, name: 'ภูเก็ต' }, opId)
    expect(listOps(setup.db, 'rejected')).toEqual([])
    expect(getRow(setup.db, 'events', id)).toMatchObject({ name: 'ภูเก็ต', profileId: 'p1' })
  })
})

describe('TransactionService and events', () => {
  let setup: Awaited<ReturnType<typeof setUpEvents>>
  let transactions: TransactionService

  beforeEach(async () => {
    localStorage.clear()
    setup = await setUpEvents()
    transactions = TestBed.inject(TransactionService)
    setup.event('cm', { name: 'เชียงใหม่', createdAt: 2 })
    setup.event('wed', { name: 'งานแต่ง', startOn: '2026-10-01', endOn: null })
    setup.event('ky', { startOn: '2026-08-14', endOn: '2026-08-16', isClosed: true })
  })

  afterEach(() => setup.db.close())

  it('offers open events by start date, plus the row’s closed one (rule 3)', () => {
    expect(transactions.eventOptions('p1').map((event) => event.id)).toEqual(['cm', 'wed'])
    expect(transactions.eventOptions('p1', 'ky').map((event) => event.id)).toEqual([
      'cm',
      'wed',
      'ky',
    ])
  })

  it('picks the open event whose dates hold the day, the latest start first (rule 5)', () => {
    expect(transactions.defaultEventId('p1', '2026-11-09')).toBe('cm')
    expect(transactions.defaultEventId('p1', '2026-11-13')).toBe('wed')
    expect(transactions.defaultEventId('p1', '2026-08-15')).toBeNull()
    expect(transactions.defaultEventId('p1', '2026-09-30')).toBeNull()
  })

  it('saves, keeps and filters a row’s event, and names it in the list', () => {
    const values = {
      walletId: 'cash',
      categoryId: 'shop',
      amount: 100,
      occurredOn: '2026-11-09',
      note: '',
      excludeFromReport: false,
    }
    const id = transactions.save(null, { ...values, eventId: 'cm' })
    transactions.save(id, { ...values, amount: 200 })
    expect(getRow(setup.db, 'transactions', id)).toMatchObject({ amount: 200, eventId: 'cm' })
    setup.transaction('other', { occurredOn: '2026-11-09' })
    const tagged = transactions.list({ from: null, to: null }, null, { eventId: 'cm' })
    expect(tagged.map((item) => [item.id, item.eventName])).toEqual([[id, 'เชียงใหม่']])
  })
})
