import { TestBed } from '@angular/core/testing'
import { RouterTestingHarness } from '@angular/router/testing'
import { toastState } from '@spartan-ng/brain/sonner'
import { EventService } from '@/core/event'
import { setUpEvents } from '@/core/event/event-testing'
import th from '@/core/i18n/th.json'
import { getRow, listOps } from '@/core/offline'
import type { LocalDatabase } from '@/core/offline'
import { TransactionService } from '@/core/transaction'
import eventsRoutes from './events.routes'

describe('Events pages and sheet', () => {
  let db: LocalDatabase
  let setup: Awaited<ReturnType<typeof setUpEvents>>
  let harness: RouterTestingHarness
  let events: EventService

  const body = () => document.body
  const text = () => body().textContent.replace(/\s+/g, ' ')
  const button = (label: string) =>
    [...body().querySelectorAll('button')]
      .filter((b) => b.textContent.trim() === label || b.getAttribute('aria-label') === label)
      .at(-1)
  const settle = async () => {
    harness.detectChanges()
    await harness.fixture.whenStable()
    harness.detectChanges()
  }
  const click = async (label: string) => {
    const found = button(label)
    expect(found, label).toBeDefined()
    found?.click()
    await settle()
  }
  const submit = async () => {
    body().querySelector('hlm-drawer-content form')?.dispatchEvent(new Event('submit'))
    await settle()
  }

  beforeEach(async () => {
    toastState.dismiss()
    localStorage.clear()
    setup = await setUpEvents('2026-11-09', [
      { path: 'transactions/events', children: eventsRoutes },
    ])
    db = setup.db
    events = TestBed.inject(EventService)
    setup.event('cm', { name: 'เชียงใหม่' })
    setup.event('wed', { name: 'งานแต่ง', startOn: '2026-10-01', endOn: null })
    setup.event('ky', {
      name: 'เขาใหญ่',
      startOn: '2026-08-14',
      endOn: '2026-08-16',
      isClosed: true,
    })
    setup.transaction('t1', { eventId: 'cm', amount: 840000, occurredOn: '2026-11-07' })
    setup.transaction('t2', {
      eventId: 'cm',
      amount: 24000,
      walletId: 'cash',
      occurredOn: '2026-11-09',
    })
    setup.transaction('t3', {
      eventId: 'cm',
      amount: 50000,
      categoryId: 'gift',
      occurredOn: '2026-11-08',
    })
    harness = await RouterTestingHarness.create()
  })

  afterEach(() => {
    toastState.dismiss()
    db.close()
  })

  it('lists open events with their expense, the current ones tagged, finished ones folded', async () => {
    await harness.navigateByUrl('/transactions/events')
    await settle()
    expect(text()).toContain('ยังไม่จบ (2)')
    expect(text()).toContain('เชียงใหม่')
    expect(text()).toContain('7–12 พ.ย. 2026')
    expect(text()).toContain('฿8,640.00')
    expect(text()).toContain('3 รายการ')
    expect(text()).toContain('ตั้งแต่ 1 ต.ค. 2026')
    expect(text().match(new RegExp(th.events.current, 'g'))).toHaveLength(2)
    expect(text()).not.toContain('เขาใหญ่')
    await click('จบแล้ว (1)')
    expect(text()).toContain('เขาใหญ่')
    await click(th.events.add)
    expect(events.sheet()).toEqual({ mode: 'create' })
  })

  it('shows an event’s totals, its categories and its rows by day (rule 4)', async () => {
    await harness.navigateByUrl('/transactions/events/cm')
    await settle()
    expect(text()).toContain('฿8,640.00')
    expect(text()).toContain('+500.00')
    expect(text()).toContain('-8,140.00')
    expect(text()).toContain('3 รายการ · 2 กระเป๋า')
    expect(text()).toContain(th.events.byCategory)
    expect(text()).toContain('100%')
    expect(
      [...body().querySelectorAll('section span.text-2xl')].map((el) => el.textContent)
    ).toEqual(['09', '08', '07'])
  })

  it('finishes and reopens the trip, and adds a row tagged to it (rules 5, 6)', async () => {
    await harness.navigateByUrl('/transactions/events/cm')
    await settle()
    await click(th.events.close)
    expect(events.item('cm')?.event.isClosed).toBe(true)
    expect(text()).toContain(th.events.closedTag)
    await click(th.events.reopen)
    expect(events.item('cm')?.event.isClosed).toBe(false)
    await click(th.events.addRow)
    expect(TestBed.inject(TransactionService).sheet()).toEqual({ mode: 'create', eventId: 'cm' })
  })

  it('creates an event from the sheet: today’s start, an optional end not before it', async () => {
    await harness.navigateByUrl('/transactions/events')
    await settle()
    await click(th.events.add)
    const name = body().querySelector<HTMLInputElement>(
      'hlm-drawer-content input[type="text"], hlm-drawer-content input:not([type])'
    )
    name!.value = 'ภูเก็ต'
    name!.dispatchEvent(new Event('input'))
    ;[...body().querySelectorAll('button')]
      .find((b) => b.textContent.includes(th.events.noEnd))
      ?.click()
    await settle()
    const end = [
      ...body().querySelectorAll<HTMLInputElement>('hlm-drawer-content input[type="date"]'),
    ].at(-1)
    end!.value = '2026-11-01'
    end!.dispatchEvent(new Event('input'))
    await settle()
    expect(text()).toContain(th.events.endBeforeStart)
    end!.value = '2026-11-15'
    end!.dispatchEvent(new Event('input'))
    await submit()
    const created = events.items().find((item) => item.event.name === 'ภูเก็ต')
    expect(created?.event).toMatchObject({
      startOn: '2026-11-09',
      endOn: '2026-11-15',
      isClosed: false,
    })
    expect(events.sheet()).toBeNull()
  })

  it('deletes an event after asking: its rows stay (rule 7)', async () => {
    await harness.navigateByUrl('/transactions/events/cm')
    await settle()
    await click(th.events.edit)
    await click(th.events.delete)
    expect(text()).toContain('ธุรกรรม 3 รายการจะยังอยู่')
    await click(th.events.delete)
    expect(events.item('cm')).toBeNull()
    expect(getRow(db, 'transactions', 't1')).toMatchObject({ deletedAt: null })
    expect(listOps(db, 'pending').map((op) => op.table)).toEqual(['events'])
  })
})
